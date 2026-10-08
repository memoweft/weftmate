import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { durableWrite } from '../personal-access/store.mjs';
import { healthDate, healthFailure, healthSummary, summaryCloudAllowed, observedHealthEvidence, summaryHash } from './summary.mjs';

const OWNER = /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OBSERVED_PENDING = 'MEMORY_OBSERVED_UNSUPPORTED';
const empty = (ownerId) => ({ version: 1, ownerId, revision: 0, summaries: [],
  preferences: { cloudModelAllowed: false, selfAssessmentFrequency: 'low', summarizedAt: null },
  pendingRetractions: [], deletedThrough: { all: null, dates: {} } });

/** Summary + observed outbox share one atomic file and one owner transaction. */
export function createPersonalHealthStore({ root, clock = Date.now, onChange = null }) {
  const queues = new Map();
  function file(ownerId) {
    if (typeof ownerId !== 'string' || !OWNER.test(ownerId)) throw healthFailure('UNAUTHORIZED', 401);
    return path.join(root, 'accounts', ownerId, 'health', 'daily-summaries.json');
  }
  function serial(ownerId, work) {
    file(ownerId);
    const pending = (queues.get(ownerId) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(ownerId, pending.catch(() => {}));
    return pending;
  }
  async function read(ownerId) {
    const target = file(ownerId);
    try {
      await ensurePrivateFile(target);
      const state = JSON.parse(await readFile(target, 'utf8'));
      if (state.version !== 1 || state.ownerId !== ownerId || !Number.isSafeInteger(state.revision) ||
          state.revision < 0 || !Array.isArray(state.summaries) ||
          typeof state.preferences?.cloudModelAllowed !== 'boolean' ||
          !['off', 'low', 'moderate'].includes(state.preferences?.selfAssessmentFrequency) ||
          !state.deletedThrough || typeof state.deletedThrough.dates !== 'object' ||
          state.summaries.some((row) => !row || row.evidence?.subject_id !== ownerId ||
            row.evidence?.source_kind !== 'observed' || row.requestHash?.length !== 64 ||
            row.summary?.cloudModelAllowed !== summaryCloudAllowed(row.summary, state.preferences.cloudModelAllowed) ||
            row.summary?.selfAssessmentFrequency !== state.preferences.selfAssessmentFrequency ||
            summaryHash(row.evidence) !== summaryHash(observedHealthEvidence(ownerId, healthSummary(row.summary))))) {
        throw healthFailure('STORAGE_UNAVAILABLE', 503);
      }
      state.pendingRetractions ??= [];
      if (!Array.isArray(state.pendingRetractions) || state.pendingRetractions.some((item) =>
        typeof item.source_key !== 'string' || typeof item.withdrawn_through !== 'string')) throw healthFailure('STORAGE_UNAVAILABLE', 503);
      return state;
    } catch (cause) {
      if (cause?.code === 'ENOENT') return empty(ownerId);
      throw healthFailure('STORAGE_UNAVAILABLE', 503);
    }
  }
  async function write(ownerId, state) {
    try {
      await ensurePrivateDirectory(path.join(root, 'accounts', ownerId));
      await ensurePrivateDirectory(path.dirname(file(ownerId)));
      state.revision++;
      await durableWrite(file(ownerId), state);
    } catch { throw healthFailure('STORAGE_UNAVAILABLE', 503); }
  }
  const contentHash = (row) => summaryHash([row.evidence.content, row.evidence.source]);
  const permissionsHash = (row) => summaryHash(row.evidence.permissions);
  const pending = (row) => row.delivery?.contentHash !== contentHash(row) ||
    row.delivery?.permissionsHash !== permissionsHash(row);
  const memoryStatus = (state) => {
    const count = state.summaries.filter(pending).length + state.pendingRetractions.length;
    return { state: count ? 'queued' : state.summaries.length ? 'delivered' : 'empty',
      pendingObservedCount: count, ...(count ? { reasonCode: OBSERVED_PENDING } : {}) };
  };
  async function changed(ownerId, result) {
    if (typeof onChange === 'function') {
      try { result.memory = await onChange(ownerId); }
      catch { result.memory = { ...await api.memoryStatus(ownerId), reasonCode: 'MEMORY_OBSERVED_PENDING' }; }
    }
    return result;
  }

  const api = {
    async upsert(ownerId, input, authorize = () => {}) {
      const summary = healthSummary(input);
      const requestHash = summaryHash(summary);
      const result = await serial(ownerId, async () => {
        await authorize(summary.sourceDeviceId);
        const state = await read(ownerId);
        const cutoff = [state.deletedThrough.all, state.deletedThrough.dates[summary.date]]
          .filter(Boolean).map(Date.parse);
        if (cutoff.some((time) => Date.parse(summary.summarizedAt) <= time)) {
          throw healthFailure('STALE_HEALTH_SUMMARY', 409);
        }
        const previous = state.summaries.find((row) => row.summary.sourceDeviceId === summary.sourceDeviceId &&
          row.summary.date === summary.date);
        if (previous) {
          const elapsed = Date.parse(summary.summarizedAt) - Date.parse(previous.summary.summarizedAt);
          if (elapsed < 0 || elapsed === 0 && previous.requestHash !== requestHash) {
            throw healthFailure('STALE_HEALTH_SUMMARY', 409);
          }
          if (elapsed === 0) return { summary: previous.summary, duplicate: true, memory: memoryStatus(state) };
        }
        const preferenceTime = state.preferences.summarizedAt && Date.parse(state.preferences.summarizedAt);
        const newTime = Date.parse(summary.summarizedAt);
        // Older backfills must not relax a newer account choice. At the same instant,
        // privacy wins; an explicit later true can enable cloud use again.
        if (preferenceTime === null || newTime > preferenceTime ||
            newTime === preferenceTime && summary.cloudModelAllowed === false) {
          state.preferences = { cloudModelAllowed: summary.cloudModelAllowed,
            selfAssessmentFrequency: summary.selfAssessmentFrequency, summarizedAt: summary.summarizedAt };
        }
        state.summaries = state.summaries.filter((row) => row !== previous);
        state.summaries.push({ summary, requestHash, delivery: previous?.delivery });
        for (const row of state.summaries) {
          row.summary.cloudModelAllowed = summaryCloudAllowed(row.summary, state.preferences.cloudModelAllowed);
          row.summary.selfAssessmentFrequency = state.preferences.selfAssessmentFrequency;
          row.evidence = observedHealthEvidence(ownerId, row.summary);
        }
        await write(ownerId, state);
        return { summary: state.summaries.find((row) => row.summary.sourceDeviceId === summary.sourceDeviceId &&
          row.summary.date === summary.date).summary, duplicate: false, memory: memoryStatus(state) };
      });
      return changed(ownerId, result);
    },
    async list(ownerId, { days = 14, timeZone = 'UTC' } = {}) {
      if (!Number.isInteger(days) || days < 1 || days > 365) throw healthFailure('INVALID_REQUEST');
      let today;
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
          .formatToParts(new Date(clock()));
        const part = (kind) => parts.find((item) => item.type === kind).value;
        today = `${part('year')}-${part('month')}-${part('day')}`;
      } catch { throw healthFailure('INVALID_REQUEST'); }
      const start = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
      return serial(ownerId, async () => {
        const state = await read(ownerId);
        return { summaries: state.summaries.map((row) => row.summary)
          .filter((summary) => summary.date >= start && summary.date <= today)
          .sort((a, b) => b.date.localeCompare(a.date) || a.sourceDeviceId.localeCompare(b.sourceDeviceId)),
        days, timeZone, preferences: state.preferences, memory: memoryStatus(state) };
      });
    },
    async delete(ownerId, date = null, authorize = () => {}) {
      if (date !== null) healthDate(date);
      const result = await serial(ownerId, async () => {
        await authorize();
        const state = await read(ownerId);
        const removed = state.summaries.filter((row) => date === null || row.summary.date === date);
        const cutoff = new Date(Math.max(clock(), ...removed.map((row) => Date.parse(row.summary.summarizedAt)),
          Date.parse(state.deletedThrough.all ?? '') || 0,
          ...(date === null ? Object.values(state.deletedThrough.dates).map(Date.parse)
            : [Date.parse(state.deletedThrough.dates[date] ?? '') || 0]))).toISOString();
        for (const row of removed) {
          const entry = { source_key: row.evidence.source_id, withdrawn_through: cutoff };
          state.pendingRetractions = state.pendingRetractions.filter((item) => item.source_key !== entry.source_key);
          state.pendingRetractions.push(entry);
        }
        state.summaries = state.summaries.filter((row) => !removed.includes(row));
        if (date === null) state.deletedThrough = { all: cutoff, dates: {} };
        else state.deletedThrough.dates[date] = cutoff;
        // Content is removed; source hashes and time fences alone remain pending Core cleanup.
        await write(ownerId, state);
        return { deleted: true, ...(date === null ? { scope: 'all' } : { date }), deletedCount: removed.length };
      });
      return changed(ownerId, result);
    },
    // Holds the same owner lock across RPC + acknowledgement: DELETE and consent
    // cannot race a late write, and crashes replay through Core's durable identities.
    flushObserved(ownerId, dispatch) {
      return serial(ownerId, async () => {
        const state = await read(ownerId);
        while (state.pendingRetractions.length) {
          const item = state.pendingRetractions[0];
          const receipt = await dispatch('retract_observed', item);
          if (!['applied', 'no_change'].includes(receipt?.result_state) ||
              receipt?.storage_cleanup?.state !== 'complete') throw healthFailure('MEMORY_OBSERVED_PENDING', 503);
          state.pendingRetractions.shift();
          await write(ownerId, state);
        }
        for (const row of state.summaries) {
          if (!pending(row)) continue;
          const evidence = row.evidence;
          if (row.delivery?.contentHash !== contentHash(row)) {
            const receipt = await dispatch('upsert_observed', { evidence: {
              source_key: evidence.source_id, version: evidence.source.summarized_at,
              content: evidence.content, occurred_at: `${evidence.source.date}T00:00:00.000Z`,
              valid_at: `${evidence.source.date}T00:00:00.000Z`, permissions: evidence.permissions,
            } });
            if (!['applied', 'no_change'].includes(receipt?.result_state) ||
                receipt.storage_cleanup && receipt.storage_cleanup.state !== 'complete') {
              throw healthFailure('MEMORY_OBSERVED_PENDING', 503);
            }
            row.delivery = { contentHash: contentHash(row), evidenceId: receipt.evidence_id };
            await write(ownerId, state);
          }
          const permissionVersion = new Date(Math.max(Date.parse(state.preferences.summarizedAt),
            Date.parse(evidence.source.summarized_at))).toISOString();
          const receipt = await dispatch('update_observed_permissions', { source_key: evidence.source_id,
            permission_version: permissionVersion, permissions: evidence.permissions });
          if (!['applied', 'no_change'].includes(receipt?.result_state)) throw healthFailure('MEMORY_OBSERVED_PENDING', 503);
          row.delivery.permissionsHash = permissionsHash(row);
          row.delivery.permissionVersion = permissionVersion;
          row.delivery.worldRevision = receipt.world_revision;
          await write(ownerId, state);
        }
        return memoryStatus(state);
      });
    },
    memoryStatus(ownerId) { return serial(ownerId, async () => memoryStatus(await read(ownerId))); },
    // Conversation boundaries never consume this observed queue.
    pendingObserved(ownerId) {
      return serial(ownerId, async () => (await read(ownerId)).summaries.filter(pending).map((row) => ({
        operation: 'upsert', idempotencyKey: `${row.evidence.source_id}:${row.evidence.payload_hash}`,
        evidence: row.evidence,
      })));
    },
  };
  return api;
}

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { durableWrite } from '../personal-access/store.mjs';
import { healthDate, healthFailure, healthSummary, observedHealthEvidence, summaryHash } from './summary.mjs';

const OWNER = /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OBSERVED_PENDING = 'MEMORY_OBSERVED_UNSUPPORTED';
const empty = (ownerId) => ({ version: 1, ownerId, revision: 0, summaries: [],
  preferences: { cloudModelAllowed: false, selfAssessmentFrequency: 'low', summarizedAt: null },
  deletedThrough: { all: null, dates: {} } });

/** Summary + observed outbox share one atomic file and one owner transaction. */
export function createPersonalHealthStore({ root, clock = Date.now }) {
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
            row.summary?.cloudModelAllowed !== state.preferences.cloudModelAllowed ||
            row.summary?.selfAssessmentFrequency !== state.preferences.selfAssessmentFrequency ||
            summaryHash(row.evidence) !== summaryHash(observedHealthEvidence(ownerId, healthSummary(row.summary))))) {
        throw healthFailure('STORAGE_UNAVAILABLE', 503);
      }
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
  const memoryStatus = (state) => ({ state: state.summaries.length ? 'queued' : 'empty',
    pendingObservedCount: state.summaries.length,
    ...(state.summaries.length ? { reasonCode: OBSERVED_PENDING } : {}) });

  return {
    async upsert(ownerId, input, authorize = () => {}) {
      const summary = healthSummary(input);
      const requestHash = summaryHash(summary);
      return serial(ownerId, async () => {
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
        state.summaries.push({ summary, requestHash });
        for (const row of state.summaries) {
          row.summary.cloudModelAllowed = state.preferences.cloudModelAllowed;
          row.summary.selfAssessmentFrequency = state.preferences.selfAssessmentFrequency;
          row.evidence = observedHealthEvidence(ownerId, row.summary);
        }
        await write(ownerId, state);
        return { summary: state.summaries.find((row) => row.summary.sourceDeviceId === summary.sourceDeviceId &&
          row.summary.date === summary.date).summary, duplicate: false, memory: memoryStatus(state) };
      });
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
      return serial(ownerId, async () => {
        await authorize();
        const state = await read(ownerId);
        const removed = state.summaries.filter((row) => date === null || row.summary.date === date);
        const cutoff = new Date(Math.max(clock(), ...removed.map((row) => Date.parse(row.summary.summarizedAt)),
          Date.parse(state.deletedThrough.all ?? '') || 0,
          ...(date === null ? Object.values(state.deletedThrough.dates).map(Date.parse)
            : [Date.parse(state.deletedThrough.dates[date] ?? '') || 0]))).toISOString();
        state.summaries = state.summaries.filter((row) => !removed.includes(row));
        if (date === null) state.deletedThrough = { all: cutoff, dates: {} };
        else state.deletedThrough.dates[date] = cutoff;
        // Actual removal also removes queued content, devices and metrics; only a time fence remains.
        await write(ownerId, state);
        return { deleted: true, ...(date === null ? { scope: 'all' } : { date }), deletedCount: removed.length };
      });
    },
    // Replay input for a future typed observed writer in personal-memory, not ingest_boundary.
    pendingObserved(ownerId) {
      return serial(ownerId, async () => (await read(ownerId)).summaries.map((row) => ({
        operation: 'upsert', idempotencyKey: `${row.evidence.source_id}:${row.evidence.payload_hash}`,
        evidence: row.evidence,
      })));
    },
    withRecallPolicy(ownerId, modelTier, work) {
      return serial(ownerId, async () => {
        const state = await read(ownerId);
        if (modelTier !== 'local' && state.summaries.length && !state.preferences.cloudModelAllowed) {
          return { state: 'withheld', reasonCode: 'MEMORY_HEALTH_CLOUD_BLOCKED' };
        }
        return work();
      });
    },
  };
}

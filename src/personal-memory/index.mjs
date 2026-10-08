import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { MemoWeftRpc } from './rpc.mjs';
import { createMemoryCommandJournal } from './journal.mjs';
import { createPersonalHealthStore, OBSERVED_PENDING } from '../personal-health/index.mjs';
import { normalizeApiBaseUrl } from '../stage2-config.ts';
import { modelTierFor } from '../model-tier.ts';

const OWNER = /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED_METHODS = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary',
  'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance',
  'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
const MAX_ACTIVE_OWNERS = 4;
const MAX_OUTBOX_ITEMS = 200;
const MAX_OUTBOX_BYTES = 8 * 1024 * 1024;

const error = (code) => Object.assign(new Error(code), { code });
const owner = (value) => {
  if (typeof value !== 'string' || !OWNER.test(value)) throw error('MEMORY_OWNER_UNAVAILABLE');
  return value;
};

/** Lazily owns one MemoWeft RPC v2 process and private data root per account. */
export function createPersonalMemoryManager({ root, enabled = false, python, pythonPath,
  baseUrl, model, credential = () => null, rpcFactory = (options) => new MemoWeftRpc(options),
  processingRoute = null, defaultProcessingRoute = null, maxActiveOwners = MAX_ACTIVE_OWNERS }) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof enabled !== 'boolean' ||
      typeof credential !== 'function' || typeof rpcFactory !== 'function' ||
      processingRoute !== null && typeof processingRoute !== 'function' ||
      defaultProcessingRoute !== null && typeof defaultProcessingRoute !== 'function' ||
      !Number.isInteger(maxActiveOwners) || maxActiveOwners < 1 || maxActiveOwners > 16 ||
      (enabled && (typeof python !== 'string' || !path.isAbsolute(python) ||
        typeof pythonPath !== 'string' || !path.isAbsolute(pythonPath) ||
        typeof baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/(?:[A-Za-z0-9._/-]+\/)?v1$/.test(baseUrl) ||
        model !== '@current'))) {
    throw error('MEMORY_CONFIGURATION_INVALID');
  }
  const healthStore = createPersonalHealthStore({ root, onChange: flushObserved });
  const entries = new Map();
  const failures = new Map();
  const boundaryFailures = new Map();
  const boundaryFlights = new Set();
  const outboxQueues = new Map();
  const homePromises = new Map();
  const journal = createMemoryCommandJournal({ root });
  const commandFlights = new Map();
  let closing = false;
  let startQueue = Promise.resolve();
  let sourceVersion;
  const readSourceVersion = () => sourceVersion ??= readFile(path.join(path.dirname(pythonPath), 'pyproject.toml'), 'utf8')
    .then(text => text.match(/\[project\]([^]*?)(?=\n\[|$)/)?.[1]
      .match(/^version\s*=\s*"([0-9A-Za-z.+-]+)"/m)?.[1] ?? null).catch(() => null);

  async function resolveProcessingRoute(ownerId, sessionId = null) {
    let selected;
    try {
      selected = sessionId !== null && typeof processingRoute === 'function'
        ? await processingRoute(ownerId, sessionId)
        : typeof defaultProcessingRoute === 'function' ? await defaultProcessingRoute(ownerId)
        : { profileId: 'formal-local-memory-route', baseUrl, model,
          credential: await credential(ownerId), routeFingerprint: null, modelTier: 'local' };
    } catch { throw error('MEMORY_MODEL_UNAVAILABLE'); }
    if (!selected || typeof selected !== 'object' || Array.isArray(selected) ||
        typeof selected.profileId !== 'string' || !selected.profileId || selected.profileId.length > 160 ||
        typeof selected.baseUrl !== 'string' || selected.baseUrl.length > 2048 ||
        typeof selected.model !== 'string' || !/^[A-Za-z0-9._:/@-]{1,128}$/.test(selected.model) ||
        typeof selected.credential !== 'string' || !selected.credential || selected.credential.length > 4096 ||
        selected.routeFingerprint !== null &&
          (typeof selected.routeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(selected.routeFingerprint))) {
      throw error('MEMORY_MODEL_UNAVAILABLE');
    }
    const normalizedBaseUrl = normalizeApiBaseUrl(selected.baseUrl);
    if (!normalizedBaseUrl) throw error('MEMORY_MODEL_UNAVAILABLE');
    const modelTier = modelTierFor(selected);
    return { profileId: selected.profileId, baseUrl: normalizedBaseUrl, model: selected.model,
      credential: selected.credential, routeFingerprint: selected.routeFingerprint,
      modelTier,
      key: JSON.stringify([selected.profileId, normalizedBaseUrl, selected.model,
        selected.routeFingerprint, modelTier]) };
  }

  async function preparePrivateHome(ownerId) {
    const accountRoot = await ensurePrivateDirectory(path.join(root, 'accounts', ownerId));
    const home = await ensurePrivateDirectory(path.join(accountRoot, 'memory-home'));
    const data = await ensurePrivateDirectory(path.join(home, 'memoweft'));
    for (const name of ['memoweft.sqlite3', 'memoweft.sqlite3-wal', 'memoweft.sqlite3-shm']) {
      const file = path.join(data, name);
      const info = await lstat(file).catch((cause) => {
        if (cause?.code === 'ENOENT') return null;
        throw cause;
      });
      if (info) await ensurePrivateFile(file);
    }
    return home;
  }
  function privateHome(ownerId) {
    if (!homePromises.has(ownerId)) {
      const work = preparePrivateHome(ownerId).catch((cause) => {
        homePromises.delete(ownerId);
        throw cause;
      });
      homePromises.set(ownerId, work);
    }
    return homePromises.get(ownerId);
  }

  const outboxFile = (ownerId) => path.join(root, 'accounts', ownerId, 'memory-home', 'boundary-outbox.json');
  function queueOutbox(ownerId, task) {
    const prior = outboxQueues.get(ownerId) ?? Promise.resolve();
    const work = prior.catch(() => {}).then(task);
    outboxQueues.set(ownerId, work.catch(() => {}));
    return work;
  }
  async function readOutbox(ownerId) {
    const file = outboxFile(ownerId);
    const info = await lstat(file).catch((cause) => cause?.code === 'ENOENT' ? null : Promise.reject(cause));
    if (!info) return { version: 2, ownerId, items: [],
      discardedBoundaryCount: 0, lastFailureCode: null };
    await ensurePrivateFile(file);
    if (!info.isFile() || info.size > MAX_OUTBOX_BYTES) throw error('MEMORY_OUTBOX_CORRUPT');
    let state;
    try { state = JSON.parse(await readFile(file, 'utf8')); }
    catch { throw error('MEMORY_OUTBOX_CORRUPT'); }
    if (![1, 2].includes(state?.version) || state?.ownerId !== ownerId || !Array.isArray(state.items) ||
        state.items.length > MAX_OUTBOX_ITEMS) {
      throw error('MEMORY_OUTBOX_CORRUPT');
    }
    const items = state.items.map((item) => state.version === 1
      ? { boundary: item, blocked: false, lastFailureCode: null } : item);
    if (items.some((item) => !item || typeof item !== 'object' ||
        !item.boundary || typeof item.boundary !== 'object' ||
        typeof item.boundary.event_id !== 'string' ||
        typeof item.blocked !== 'boolean' ||
        (item.lastFailureCode !== null &&
          (typeof item.lastFailureCode !== 'string' || item.lastFailureCode.length > 80)))) {
      throw error('MEMORY_OUTBOX_CORRUPT');
    }
    if (state.version === 2 &&
        (!Number.isSafeInteger(state.discardedBoundaryCount) || state.discardedBoundaryCount < 0 ||
          (state.lastFailureCode !== null &&
            (typeof state.lastFailureCode !== 'string' || state.lastFailureCode.length > 80)))) {
      throw error('MEMORY_OUTBOX_CORRUPT');
    }
    return { version: 2, ownerId, items,
      discardedBoundaryCount: state.version === 2 ? state.discardedBoundaryCount : 0,
      lastFailureCode: state.version === 2 ? state.lastFailureCode : null };
  }
  async function writeOutbox(ownerId, state) {
    const file = outboxFile(ownerId);
    const body = JSON.stringify(state);
    if (Buffer.byteLength(body, 'utf8') > MAX_OUTBOX_BYTES) throw error('MEMORY_OUTBOX_FULL');
    const tmp = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(tmp, 'wx', 0o600);
      await handle.writeFile(body, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await ensurePrivateFile(tmp);
      await rename(tmp, file);
      await ensurePrivateFile(file);
    } finally {
      await handle?.close().catch(() => {});
      await rm(tmp, { force: true }).catch(() => {});
    }
  }

  const boundaryFailureCode = (cause) => {
    if (cause?.code === 'hard_deleted_source') return 'MEMORY_SOURCE_DELETED';
    if (cause?.code === 'internal_error') return 'MEMORY_BOUNDARY_BLOCKED';
    if (['MEMORY_PROCESS_UNAVAILABLE', 'MEMORY_TIMEOUT', 'MEMORY_BUSY', 'MEMORY_CLOSING',
      'MEMORY_MODEL_UNAVAILABLE'].includes(cause?.code)) {
      return cause.code;
    }
    return 'MEMORY_BOUNDARY_FAILED';
  };
  async function noteBoundaryFailure(ownerId, eventId, cause) {
    const code = boundaryFailureCode(cause);
    boundaryFailures.set(ownerId, code);
    await queueOutbox(ownerId, async () => {
      const latest = await readOutbox(ownerId);
      const row = latest.items.find((item) => item.boundary.event_id === eventId);
      if (!row) return;
      if (code === 'MEMORY_SOURCE_DELETED') {
        latest.items = latest.items.filter((item) => item !== row);
        latest.discardedBoundaryCount++;
        latest.lastFailureCode = code;
        await writeOutbox(ownerId, latest);
        return;
      }
      row.lastFailureCode = code;
      // Core currently reports both hard-deleted origins and ordinary evidence conflicts as
      // internal_error. Keep the original privately for review; never silently replay it.
      row.blocked = code === 'MEMORY_BOUNDARY_BLOCKED';
      await writeOutbox(ownerId, latest);
    });
    const backlog = await outboxStatus(ownerId);
    const entry = entries.get(ownerId);
    if (entry) entry.backlogCount = backlog.pendingBoundaryCount;
    if (code === 'MEMORY_SOURCE_DELETED' && backlog.pendingBoundaryCount === 0) {
      boundaryFailures.delete(ownerId);
    }
    return code;
  }
  async function outboxStatus(ownerId) {
    const state = await queueOutbox(ownerId, () => readOutbox(ownerId));
    const blockedBoundaryCount = state.items.filter((item) => item.blocked).length;
    return { pendingBoundaryCount: state.items.length, blockedBoundaryCount,
      discardedBoundaryCount: state.discardedBoundaryCount,
      lastFailureCode: state.items.findLast((item) => item.lastFailureCode)?.lastFailureCode ??
        state.lastFailureCode };
  }
  async function flushPending(ownerId) {
    if (closing) return;
    let pending;
    try { pending = await queueOutbox(ownerId, () => readOutbox(ownerId)); }
    catch { failures.set(ownerId, 'MEMORY_OUTBOX_CORRUPT'); return; }
    for (const row of pending.items) {
      if (closing) return;
      if (row.blocked) continue;
      const boundary = row.boundary;
      if (boundaryFlights.has(`${ownerId}\0${boundary.event_id}`)) continue;
      try {
        await withOwner(ownerId, (entry) => entry.rpc.request('ingest_boundary', { boundary }),
          boundary.parent_session_id);
        await queueOutbox(ownerId, async () => {
          const latest = await readOutbox(ownerId);
          latest.items = latest.items.filter((item) => item.boundary.event_id !== boundary.event_id);
          await writeOutbox(ownerId, latest);
        });
        const backlog = await outboxStatus(ownerId);
        const entry = entries.get(ownerId);
        if (entry) entry.backlogCount = backlog.pendingBoundaryCount;
        if (backlog.pendingBoundaryCount === 0) boundaryFailures.delete(ownerId);
      } catch (cause) {
        let code;
        try { code = await noteBoundaryFailure(ownerId, boundary.event_id, cause); }
        catch { failures.set(ownerId, 'MEMORY_OUTBOX_CORRUPT'); }
        if (code === 'MEMORY_SOURCE_DELETED') continue;
        return;
      }
    }
  }

  async function prepare(ownerId, sessionId = null) {
    if (closing) throw error('MEMORY_CLOSING');
    const existing = entries.get(ownerId);
    let selected = null;
    if (sessionId !== null || !existing?.ready || !existing.rpc.child) {
      try { selected = await resolveProcessingRoute(ownerId, sessionId); }
      catch (cause) {
        if (sessionId !== null && existing && existing.active === 0) {
          entries.delete(ownerId); await existing.rpc.close().catch(() => {});
        }
        throw cause;
      }
    }
    if (existing?.ready && existing.rpc.child &&
        (selected === null || existing.routeKey === selected.key)) return existing;
    if (existing?.initializing) return existing.initializing;
    if (existing?.active > 0) throw error('MEMORY_BUSY');
    if (existing) { entries.delete(ownerId); await existing.rpc.close().catch(() => {}); }
    if (entries.size >= maxActiveOwners) {
      const idle = [...entries.entries()].filter(([, entry]) => entry.active === 0 && !entry.initializing)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!idle) throw error('MEMORY_BUSY');
      entries.delete(idle[0]);
      await idle[1].rpc.close();
    }
    const home = await privateHome(ownerId);
    const rpc = rpcFactory({ python, pythonPath,
      env: { MEMOWEFT_BASE_URL: selected.baseUrl, MEMOWEFT_WORLD_MODEL: selected.model } });
    const entry = { rpc, ready: false, active: 0, lastUsed: Date.now(),
      capabilities: null, routeReady: false, backlogCount: null, initializing: null,
      routeKey: selected.key, modelTier: selected.modelTier };
    entries.set(ownerId, entry);
    entry.initializing = (async () => {
      const before = await rpc.request('capabilities');
      if (before?.protocol !== 'memoweft.dsh_rpc' || before?.protocol_version !== 2 ||
          before?.schema_version !== 1 || !Array.isArray(before?.methods) ||
          REQUIRED_METHODS.some((name) => !before.methods.includes(name))) {
        throw error('MEMORY_PROTOCOL_INCOMPATIBLE');
      }
      const initialized = await rpc.request('initialize', {
        session_id: 'weftmate-personal-host', dsh_home: home, subject_id: ownerId,
        platform: 'dsh', model_tier: selected.modelTier, lang: 'zh', auto_route: true,
        model_api_key: selected.credential,
      });
      if (initialized?.runtime?.subject_id !== ownerId ||
          path.resolve(initialized.runtime.db_path ?? '') !== path.join(home, 'memoweft', 'memoweft.sqlite3')) {
        throw error('MEMORY_IDENTITY_MISMATCH');
      }
      const capabilities = initialized.capabilities;
      if (!capabilities || capabilities.subject_id !== ownerId ||
          !Array.isArray(capabilities?.services?.command?.operations)) {
        throw error('MEMORY_PROTOCOL_INCOMPATIBLE');
      }
      entry.capabilities = capabilities;
      const health = await rpc.request('health');
      if (health?.runtime?.subject_id !== ownerId) throw error('MEMORY_IDENTITY_MISMATCH');
      entry.routeReady = health.runtime.route_ready === true;
      const backlog = await outboxStatus(ownerId);
      entry.backlogCount = backlog.pendingBoundaryCount;
      if (backlog.pendingBoundaryCount > 0) boundaryFailures.set(ownerId,
        backlog.lastFailureCode === 'MEMORY_SOURCE_DELETED' ? 'MEMORY_BOUNDARY_PENDING'
          : backlog.lastFailureCode ?? 'MEMORY_BOUNDARY_PENDING');
      entry.ready = true;
      entry.initializing = null;
      failures.delete(ownerId);
      queueMicrotask(() => { void flushPending(ownerId); });
      return entry;
    })().catch(async (cause) => {
      entry.initializing = null;
      entry.ready = false;
      entries.delete(ownerId);
      failures.set(ownerId, cause?.code ?? 'MEMORY_UNAVAILABLE');
      await rpc.close().catch(() => {});
      throw cause;
    });
    return entry.initializing;
  }

  function acquire(ownerId, sessionId = null) {
    owner(ownerId);
    if (!enabled) throw error('MEMORY_DISABLED');
    if (closing) throw error('MEMORY_CLOSING');
    const work = startQueue.then(() => prepare(ownerId, sessionId));
    startQueue = work.catch(() => {});
    return work;
  }

  async function withOwner(ownerId, work, sessionId = null) {
    const entry = await acquire(ownerId, sessionId);
    entry.active++;
    entry.lastUsed = Date.now();
    try { return await work(entry); }
    catch (cause) {
      if (cause?.code === 'MEMORY_PROCESS_UNAVAILABLE' || cause?.code === 'MEMORY_TIMEOUT' ||
          cause?.code === 'MEMORY_PROTOCOL_ERROR') {
        entry.ready = false;
        failures.set(ownerId, cause.code);
      }
      throw cause;
    } finally { entry.active--; entry.lastUsed = Date.now(); }
  }

  async function flushObserved(ownerId) {
    if (!enabled) return healthStore.memoryStatus(ownerId);
    return withOwner(ownerId, (entry) => flushObservedEntry(ownerId, entry));
  }
  async function flushObservedEntry(ownerId, entry) {
    if (entry.capabilities?.observed_evidence !== 1 || entry.capabilities?.recall_model_tier !== true) {
      return healthStore.memoryStatus(ownerId);
    }
    return healthStore.flushObserved(ownerId, (method, params) => entry.rpc.request(method, params));
  }

  const commandOperations = (entry) => new Set(entry?.capabilities?.services?.command?.operations ?? []);
  const capabilities = (entry) => ({ list: Boolean(entry?.ready), source: Boolean(entry?.ready),
    inject: Boolean(entry?.ready && entry.routeReady),
    correct: Boolean(entry?.ready && commandOperations(entry).has('correct_world_item')),
    mute: Boolean(entry?.ready && commandOperations(entry).has('mute_world_item')),
    deleteEvidence: Boolean(entry?.ready && commandOperations(entry).has('delete_evidence')),
    deleteWorldItem: Boolean(entry?.ready && commandOperations(entry).has('delete_world_item')) });

  async function cleanupAfterDelete(ownerId, command, result) {
    if (!['delete_evidence', 'delete_world_item'].includes(command.operation)) return result;
    const receipt = result?.receipt ?? result;
    if (!['applied', 'no_change'].includes(receipt?.result_state)) return result;
    const ids = [command.target_id, ...(Array.isArray(receipt.affected_ids)
      ? receipt.affected_ids.filter((id) => typeof id === 'string' && id.length <= 512) : [])];
    try { await journal.redactTargets(ownerId, ids); return result; }
    catch {
      const pending = { ...receipt,
        storage_cleanup: { state: 'pending', detail_code: 'host_journal_cleanup_pending' } };
      return result?.receipt ? { ...result, receipt: pending } : pending;
    }
  }

  return {
    enabled,
    healthStore,
    flushObserved,
    // Expose remaining replay inputs; delivered revisions are acknowledged durably.
    async observedOutbox(ownerId) {
      const items = await healthStore.pendingObserved(ownerId);
      return { state: items.length ? 'queued' : 'empty',
        ...(items.length ? { reasonCode: OBSERVED_PENDING } : {}), items };
    },
    peek(ownerId) {
      owner(ownerId);
      if (!enabled) return 'disabled';
      const entry = entries.get(ownerId);
      return entry?.ready && entry.routeReady && entry.backlogCount === 0 && entry.rpc?.child &&
        !boundaryFailures.has(ownerId)
        ? 'connected' : 'unknown';
    },
    async status(ownerId) {
      owner(ownerId);
      if (!enabled) return { state: 'disabled', worldRevision: null, capabilities: capabilities(null),
        pendingBoundaryCount: 0, blockedBoundaryCount: 0, discardedBoundaryCount: 0,
        lastFailureCode: null };
      try {
        return await withOwner(ownerId, async (entry) => {
          await flushObservedEntry(ownerId, entry);
          const health = await entry.rpc.request('health');
          const revisionResult = await entry.rpc.request('query_world', { operation: 'revision' });
          const backlog = await outboxStatus(ownerId);
          entry.backlogCount = backlog.pendingBoundaryCount;
          const revision = revisionResult?.world_revision ?? revisionResult?.revision;
          entry.routeReady = health?.runtime?.route_ready === true;
          const ready = entry.routeReady && backlog.pendingBoundaryCount === 0;
          if (backlog.pendingBoundaryCount === 0) boundaryFailures.delete(ownerId);
          else boundaryFailures.set(ownerId, backlog.lastFailureCode === 'MEMORY_SOURCE_DELETED'
            ? 'MEMORY_BOUNDARY_PENDING' : backlog.lastFailureCode ?? 'MEMORY_BOUNDARY_PENDING');
          return { state: ready ? 'ready' : 'degraded',
            version: health?.version ?? health?.runtime?.version ?? await readSourceVersion(),
            worldRevision: Number.isSafeInteger(revision) ? revision : null,
            capabilities: { ...capabilities(entry), inject: ready }, ...backlog,
            ...(!entry.routeReady ? { reasonCode: 'MEMORY_MODEL_UNAVAILABLE' }
              : backlog.pendingBoundaryCount ? { reasonCode: backlog.lastFailureCode === 'MEMORY_SOURCE_DELETED'
                ? 'MEMORY_BOUNDARY_PENDING' : backlog.lastFailureCode ?? 'MEMORY_BOUNDARY_PENDING' } : {}) };
        });
      } catch (cause) {
        const code = cause?.code === 'MEMORY_OUTBOX_CORRUPT' ? cause.code
          : failures.get(ownerId) ?? 'MEMORY_UNAVAILABLE';
        return { state: 'unavailable', worldRevision: null, capabilities: capabilities(null),
          pendingBoundaryCount: null, blockedBoundaryCount: null,
          discardedBoundaryCount: null,
          lastFailureCode: code, reasonCode: code };
      }
    },
    query(ownerId, method, params) { return withOwner(ownerId, async (entry) => {
      const observed = await flushObservedEntry(ownerId, entry);
      if (observed.state === 'queued' && entry.capabilities?.observed_evidence === 1) {
        throw error('MEMORY_OBSERVED_PENDING');
      }
      return entry.rpc.request(method, params);
    }); },
    async recall(ownerId, { query, sessionId, modelTier }) {
      owner(ownerId);
      if (!enabled) throw error('MEMORY_DISABLED');
      if (typeof query !== 'string' || !query.trim() || query.length > 500 ||
          typeof sessionId !== 'string' || sessionId.length > 128 ||
          modelTier !== undefined && !['local', 'cloud'].includes(modelTier)) throw error('MEMORY_REQUEST_INVALID');
      const route = await resolveProcessingRoute(ownerId, sessionId);
      const destinationTier = modelTier ?? route.modelTier;
      // Formation uses the background route; recall permissions belong to the
      // foreground model that will receive this context.
      return withOwner(ownerId, async (entry) => {
        // Recheck the worker route too: a host route may have changed during acquire.
        if (entry.modelTier !== route.modelTier) return { state: 'withheld', reasonCode: 'MEMORY_DESTINATION_BLOCKED' };
        if (!entry.routeReady) return { state: 'withheld', reasonCode: 'MEMORY_MODEL_UNAVAILABLE' };
        const backlog = await outboxStatus(ownerId);
        if (backlog.pendingBoundaryCount > 0) return { state: 'withheld',
          reasonCode: backlog.lastFailureCode === 'MEMORY_SOURCE_DELETED'
            ? 'MEMORY_BOUNDARY_PENDING' : backlog.lastFailureCode ?? 'MEMORY_BOUNDARY_PENDING' };
        const observed = await flushObservedEntry(ownerId, entry);
        if (observed.state === 'queued' && entry.capabilities?.observed_evidence === 1) {
          return { state: 'withheld', reasonCode: 'MEMORY_OBSERVED_PENDING' };
        }
        // Core owns the durable jobs and worker. A new turn can arrive before its
        // previous boundary's background model request finishes (local kick: 20s).
        // Wait only for already accepted work; ordinary chat still degrades on failure.
        if (entry.capabilities?.methods?.includes('query_jobs')) {
          const deadline = Date.now() + 330_000;
          while (true) {
            const result = await entry.rpc.request('query_jobs', { operation: 'list' });
            const pending = result.jobs?.some(job => ['pending', 'processing', 'retry'].includes(job.worker?.state));
            if (!pending) break;
            if (Date.now() >= deadline) return { state: 'withheld', reasonCode: 'MEMORY_FORMATION_PENDING' };
            await new Promise(resolve => setTimeout(resolve, 250));
          }
        }
        const [world, style, identity, interaction] = await Promise.all([
          entry.rpc.request('preview_recall', { query, model_tier: destinationTier }),
          // Standing conversational preferences apply even when today's topic
          // shares no words with the earlier preference (e.g. a new concept).
          entry.rpc.request('preview_recall', { query: '用户希望我如何称呼和讲解？', model_tier: destinationTier }),
          entry.rpc.request('preview_recall', { query: '我叫什么？', model_tier: destinationTier }),
          entry.rpc.request('query_interactions', { query, session_id: sessionId, projection: 'model', model_tier: destinationTier }),
        ]);
        // Summaries come from permission-filtered rendered snapshots, never
        // unrestricted query_world values on a cloud destination.
        const memories = [], fragments = [], seen = new Set();
        for (const snapshot of [world, style, identity]) {
          const rendered = snapshot?.preview?.rendered_recall ?? '';
          const pairs = snapshot?.preview?.selected_item_ids ?? [];
          const claims = rendered.split(/\n(?=记忆(?:（过往）)?：)/);
          if (!pairs.length && rendered.trim()) fragments.push(rendered.trim());
          for (const [index, pair] of pairs.entries()) {
            const [kind, id] = Array.isArray(pair) ? pair : [];
            const claim = claims[index]?.trim();
            const summary = claim?.replace(/^记忆(?:（过往）)?：/, '').trim().slice(0, 240);
            if (!['cognition', 'entity', 'relationship', 'event'].includes(kind) ||
                typeof id !== 'string' || !summary || seen.has(`${kind}:${id}`)) continue;
            seen.add(`${kind}:${id}`);
            memories.push({ id, kind, summary }); fragments.push(claim);
          }
        }
        if (typeof interaction?.rendered_context === 'string' && interaction.rendered_context.trim()) {
          fragments.push(interaction.rendered_context.trim());
        }
        const contextText = fragments.join('\n\n').slice(0, 16_384);
        return { state: 'ready', contextText, memories, worldRevision: Number.isSafeInteger(world?.world_revision)
          ? world.world_revision : null, sourceCount: memories.length };
      }, sessionId);
    },
    async ingest(ownerId, boundary) {
      owner(ownerId);
      if (!enabled) throw error('MEMORY_DISABLED');
      if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary) ||
          typeof boundary.event_id !== 'string' || !/^[A-Za-z0-9._:-]{1,180}$/.test(boundary.event_id) ||
          Buffer.byteLength(JSON.stringify(boundary), 'utf8') > 128 * 1024) throw error('MEMORY_REQUEST_INVALID');
      await privateHome(ownerId);
      await queueOutbox(ownerId, async () => {
        const state = await readOutbox(ownerId);
        const prior = state.items.find((item) => item.boundary.event_id === boundary.event_id);
        if (prior) {
          if (JSON.stringify(prior.boundary) !== JSON.stringify(boundary)) throw error('MEMORY_EVENT_CONFLICT');
          return;
        }
        if (state.items.length >= MAX_OUTBOX_ITEMS) throw error('MEMORY_OUTBOX_FULL');
        state.items.push({ boundary, blocked: false, lastFailureCode: null });
        await writeOutbox(ownerId, state);
      });
      const blocked = await queueOutbox(ownerId, async () => (await readOutbox(ownerId))
        .items.some((item) => item.boundary.event_id === boundary.event_id && item.blocked));
      if (blocked) {
        return { state: 'blocked', reasonCode: 'MEMORY_BOUNDARY_BLOCKED' };
      }
      const flight = `${ownerId}\0${boundary.event_id}`;
      boundaryFlights.add(flight);
      try {
        const result = await withOwner(ownerId, (entry) => entry.rpc.request('ingest_boundary', { boundary }),
          boundary.parent_session_id);
        await queueOutbox(ownerId, async () => {
          const state = await readOutbox(ownerId);
          state.items = state.items.filter((item) => item.boundary.event_id !== boundary.event_id);
          await writeOutbox(ownerId, state);
        });
        const backlog = await outboxStatus(ownerId);
        const entry = entries.get(ownerId);
        if (entry) entry.backlogCount = backlog.pendingBoundaryCount;
        if (backlog.pendingBoundaryCount === 0) boundaryFailures.delete(ownerId);
        else boundaryFailures.set(ownerId, backlog.lastFailureCode === 'MEMORY_SOURCE_DELETED'
          ? 'MEMORY_BOUNDARY_PENDING' : backlog.lastFailureCode ?? 'MEMORY_BOUNDARY_PENDING');
        return { state: 'accepted', jobState: result?.job_state ?? 'unknown' };
      } catch (cause) {
        let code;
        try { code = await noteBoundaryFailure(ownerId, boundary.event_id, cause); }
        catch { failures.set(ownerId, 'MEMORY_OUTBOX_CORRUPT'); return { state: 'blocked', reasonCode: 'MEMORY_OUTBOX_CORRUPT' }; }
        return { state: code === 'MEMORY_SOURCE_DELETED' ? 'discarded'
          : code === 'MEMORY_BOUNDARY_BLOCKED' ? 'blocked' : 'queued', reasonCode: code };
      } finally { boundaryFlights.delete(flight); }
    },
    submit(ownerId, command) { return withOwner(ownerId, (entry) => entry.rpc.request('submit_command', { command })); },
    receipt(ownerId, commandId) { return withOwner(ownerId, (entry) => entry.rpc.request('query_command_receipt',
      { command_id: commandId })); },
    async submitCommand(ownerId, proposal) {
      owner(ownerId);
      await privateHome(ownerId);
      const marker = await journal.reserve({ ownerId, ...proposal });
      const command = marker.command;
      const key = `${ownerId}\0${proposal.requestId}`;
      if (commandFlights.has(key)) return commandFlights.get(key);
      const work = (async () => {
        let result;
        try { result = await withOwner(ownerId, (entry) => entry.rpc.request('query_command_receipt',
          { command_id: command.command_id })); }
        catch (cause) { if (cause?.code !== 'command_receipt_not_found') throw cause; }
        if (!result) {
          if (marker.redacted === true) throw error('MEMORY_REPLAY_REDACTED');
          result = await withOwner(ownerId, (entry) => entry.rpc.request('submit_command', { command }));
        }
        return { ...await cleanupAfterDelete(ownerId, command, result), operation: command.operation };
      })();
      commandFlights.set(key, work);
      try { return await work; } finally { commandFlights.delete(key); }
    },
    async receiptByRequest(ownerId, requestId) {
      owner(ownerId);
      const marker = await journal.get(ownerId, requestId);
      if (!marker) throw error('command_receipt_not_found');
      const result = await withOwner(ownerId, (entry) => entry.rpc.request('query_command_receipt',
        { command_id: marker.command.command_id }));
      return { ...await cleanupAfterDelete(ownerId, marker.command, result),
        operation: marker.command.operation };
    },
    async retryCleanupByRequest(ownerId, requestId) {
      owner(ownerId);
      const marker = await journal.get(ownerId, requestId);
      if (!marker) throw error('command_receipt_not_found');
      if (!['delete_evidence', 'delete_world_item'].includes(marker.command.operation)) {
        throw error('MEMORY_ACTION_UNSUPPORTED');
      }
      const key = `${ownerId}\0${requestId}`;
      if (commandFlights.has(key)) await commandFlights.get(key);
      const work = (async () => {
        const query = () => withOwner(ownerId, (entry) => entry.rpc.request('query_command_receipt',
          { command_id: marker.command.command_id }));
        let result = await query();
        const receipt = result?.receipt ?? result;
        if (['applied', 'no_change'].includes(receipt?.result_state) &&
            receipt?.storage_cleanup?.state === 'pending') {
          try {
            result = await withOwner(ownerId, (entry) => entry.rpc.request('retry_delete_storage_cleanup',
              { command_id: marker.command.command_id }));
          } catch { result = await query().catch(() => result); }
        }
        return { ...await cleanupAfterDelete(ownerId, marker.command, result),
          operation: marker.command.operation };
      })();
      commandFlights.set(key, work);
      try { return await work; } finally { commandFlights.delete(key); }
    },
    hasOperation(ownerId, operation) {
      owner(ownerId);
      return commandOperations(entries.get(ownerId)).has(operation);
    },
    async invalidateOwnerRoute(ownerId) {
      owner(ownerId);
      const work = startQueue.then(async () => {
        const entry = entries.get(ownerId);
        if (!entry) return;
        entries.delete(ownerId);
        await entry.rpc.close().catch(() => {});
      });
      startQueue = work.catch(() => {});
      await work;
    },
    async close() {
      if (closing) return;
      closing = true;
      await startQueue.catch(() => {});
      await Promise.all([...outboxQueues.values()].map((pending) => pending.catch(() => {})));
      await Promise.all([...commandFlights.values()].map((pending) => pending.catch(() => {})));
      await journal.close();
      await Promise.all([...entries.values()].map((entry) => entry.rpc.close().catch(() => {})));
      entries.clear();
    },
  };
}

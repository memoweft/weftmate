import { randomUUID, createHash } from 'node:crypto';
import { failure } from './common.mjs';

/** The native DSH log is the recovery source; only delivery receipts and job refs
 * live in the account store. Historical ingestion always requires confirmation. */
export function createMemoryIngestion(context) {
  const captures = new Map();
  const scanCursors = new Map();
  let timer, flight;
  const keyFor = (sessionId, turn) => `${sessionId}:${turn}`;
  function permitted(session, row, historical = false) {
    if (!session || session.deleting || !['personal-remote', 'shared-chat'].includes(session.origin)) return false;
    if (historical && (session.temporary || session.memoryMode === 'off')) return false;
    const policy = session.memoryTurns?.[row.turn];
    if (policy ? !policy.ingest : session.temporary || session.memoryMode === 'off' || session.hasTemporaryContent) return false;
    return !(row.sourceSeqs ?? []).some(seq => session.forgottenSeqs?.includes(seq));
  }
  async function capture(ownerId, sessionId, turn, boundary, row = {}) {
    const previous = captures.get(ownerId) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      if (context.dataControls?.isLocked(ownerId)) return { state: 'skipped', reasonCode: 'MEMORY_SOURCE_EXCLUDED' };
      const account = context.accountState(ownerId), key = keyFor(sessionId, turn);
      if (account.memoryCleanupPending) throw failure('MEMORY_BUSY', 503);
      if (!permitted(account.sessions[sessionId], { ...row, turn })) return { state: 'skipped', reasonCode: 'MEMORY_SOURCE_EXCLUDED' };
      if (account.memoryDeliveredTurns?.[key]) return { state: 'accepted', duplicate: true };
      const result = await context.memoryManager.ingest(ownerId, boundary, { defer: true });
      if (!['accepted', 'queued', 'discarded'].includes(result.state)) throw failure(result.reasonCode ?? 'MEMORY_UNAVAILABLE', 503);
      await context.serial(() => context.mutate(ownerId, next => {
        next.memoryDeliveredTurns ??= {};
        next.memoryDeliveredTurns[key] = boundary.event_id;
      }));
      return result;
    });
    captures.set(ownerId, work);
    return work;
  }
  async function candidates(ownerId, historical, cursors = new Map()) {
    const account = context.accountState(ownerId), rows = [];
    for (const [sessionId, session] of Object.entries(account.sessions)) {
      if (!['personal-remote', 'shared-chat'].includes(session.origin) || session.deleting ||
          historical && (session.temporary || session.memoryMode === 'off')) continue;
      let afterSeq = historical ? -1 : scanCursors.get(`${ownerId}:${sessionId}`) ?? -1;
      while (true) {
        const result = await context.backend.readMemoryBoundaries({ ownerId, sessionId, afterSeq });
        for (const row of result.items ?? []) {
          if (!permitted(session, row, historical) || account.memoryDeliveredTurns?.[keyFor(sessionId, row.turn)] ||
              !historical && (!row.at || Date.parse(row.at) < Date.parse(account.memoryCaptureSince))) continue;
          rows.push({ ...row, sessionId });
        }
        if (!historical && Number.isSafeInteger(result.nextSeq)) cursors.set(`${ownerId}:${sessionId}`, result.nextSeq);
        if (!result.hasMore) break;
        if (!Number.isSafeInteger(result.nextSeq) || result.nextSeq <= afterSeq) throw failure('MEMORY_RESPONSE_INVALID', 503);
        afterSeq = result.nextSeq;
      }
    }
    return rows.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.sessionId.localeCompare(b.sessionId) || a.turn - b.turn);
  }
  const publicJob = job => job ? { id: job.id, state: job.state, totalTurns: job.items.length,
    submittedTurns: job.cursor, skippedTurns: job.skipped ?? 0, lastError: job.lastError ?? null,
    createdAt: job.createdAt } : null;
  async function preview(ownerId) {
    if (!context.backend.readMemoryBoundaries) throw failure('MEMORY_UNAVAILABLE', 503);
    const accepted = new Set(await context.memoryManager.acceptedBoundaryIds(ownerId));
    const rows = (await candidates(ownerId, true)).filter(row => !accepted.has(row.boundary.event_id));
    const items = rows.map(row => ({ sessionId: row.sessionId, turn: row.turn, eventId: row.boundary.event_id, at: row.at }));
    const id = createHash('sha256').update(JSON.stringify(items)).digest('hex');
    const characters = rows.reduce((sum, row) => sum + row.boundary.source_messages.reduce((n, m) => n + m.content.length, 0), 0);
    const estimate = { inputTokens: Math.ceil(characters * 1.5) + rows.length * 6000,
      outputTokens: rows.length * 1000, approximate: true };
    await context.serial(() => context.mutate(ownerId, next => { next.memoryBackfillPreview = { id, items, estimate }; }));
    return { previewId: id, sessionCount: new Set(rows.map(row => row.sessionId)).size,
      turnCount: rows.length, estimatedUsage: estimate, job: publicJob(context.accountState(ownerId).memoryBackfillJob) };
  }
  async function action(ownerId, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        !['start', 'pause', 'resume', 'cancel'].includes(input.action) ||
        Object.keys(input).some(key => !['action', 'previewId', 'confirm', 'jobId'].includes(key))) throw failure('INVALID_REQUEST');
    await context.serial(() => context.mutate(ownerId, next => {
      const job = next.memoryBackfillJob;
      if (input.action === 'start') {
        if (job && (job.previewId === input.previewId || ['running', 'paused'].includes(job.state))) return;
        const preview = next.memoryBackfillPreview;
        if (!preview || input.previewId !== preview.id || input.confirm !== true) throw failure('MEMORY_PREVIEW_REQUIRED', 409);
        next.memoryBackfillJob = { id: randomUUID(), previewId: preview.id, state: preview.items.length ? 'running' : 'completed',
          items: preview.items, cursor: 0, skipped: 0, createdAt: new Date(context.timestamp()).toISOString() };
        delete next.memoryBackfillPreview;
      } else {
        if (!job || input.jobId !== job.id) throw failure('MEMORY_JOB_NOT_FOUND', 404);
        if (!['running', 'paused'].includes(job.state)) return;
        if (input.action === 'pause') job.state = 'paused';
        else if (input.action === 'resume') job.state = 'running';
        else if (input.action === 'cancel') job.state = 'cancelled';
        else throw failure('INVALID_REQUEST');
      }
    }));
    void sweep().catch(() => {});
    return { job: publicJob(context.accountState(ownerId).memoryBackfillJob) };
  }
  async function step(ownerId) {
    const account = context.accountState(ownerId), job = account.memoryBackfillJob;
    if (job?.state !== 'running' || account.memoryCleanupPending) return;
    // Do not enqueue the whole archive: pause/cancel leaves at most the already
    // submitted turn running, while normal new turns retain delivery priority.
    const pending = await context.memoryManager.pendingStatus(ownerId);
    if (pending.pendingBoundaryCount > 0) return;
    const ref = job.items[job.cursor];
    if (!ref) return;
    let row, afterSeq = -1;
    while (true) {
      const result = await context.backend.readMemoryBoundaries({ ownerId, sessionId: ref.sessionId, afterSeq }).catch(error => {
        if (error.code === 'SESSION_UNAVAILABLE') return { items: [] };
        throw error;
      });
      row = result.items.find(row => row.turn === ref.turn && row.boundary.event_id === ref.eventId);
      if (row || !result.hasMore) break;
      if (!Number.isSafeInteger(result.nextSeq) || result.nextSeq <= afterSeq) throw failure('MEMORY_RESPONSE_INVALID', 503);
      afterSeq = result.nextSeq;
    }
    const current = context.accountState(ownerId);
    if (current.memoryBackfillJob?.state !== 'running' || current.memoryBackfillJob.id !== job.id) return;
    const skip = !row || !permitted(current.sessions[ref.sessionId], row, true);
    if (!skip) await capture(ownerId, ref.sessionId, ref.turn, row.boundary, row);
    await context.serial(() => context.mutate(ownerId, next => {
      const updated = next.memoryBackfillJob;
      if (updated?.id !== job.id) return;
      updated.cursor++; updated.skipped += Number(skip); updated.lastError = null;
      if (updated.cursor === updated.items.length && updated.state === 'running') updated.state = 'completed';
    }));
  }
  async function sweep() {
    if (flight || context.closing || !context.memoryManager?.enabled || !context.backend.readMemoryBoundaries) return flight;
    flight = (async () => {
      for (const ownerId of Object.keys(context.rootState.accounts)) {
        if (context.closing) break;
        try {
          if (context.accountState(ownerId).memoryCleanupPending) continue;
          const cursors = new Map();
          for (const row of await candidates(ownerId, false, cursors)) await capture(ownerId, row.sessionId, row.turn, row.boundary, row);
          for (const [key, cursor] of cursors) scanCursors.set(key, cursor);
          await step(ownerId);
          if (context.accountState(ownerId).memoryIngestionError) await context.serial(() => context.mutate(ownerId, next => { delete next.memoryIngestionError; }));
        } catch (error) {
          await context.serial(() => context.mutate(ownerId, next => {
            next.memoryIngestionError = /^[A-Z_]{2,80}$/.test(error.code ?? '') ? error.code : 'MEMORY_UNAVAILABLE';
            if (next.memoryBackfillJob?.state === 'running') next.memoryBackfillJob.lastError = next.memoryIngestionError;
          }));
        }
      }
    })().finally(() => { flight = null; });
    return flight;
  }
  return { capture, preview, action, sweep,
    status: ownerId => ({ backfill: publicJob(context.accountState(ownerId).memoryBackfillJob),
      captureError: context.accountState(ownerId).memoryIngestionError ?? null }),
    async start() {
      if (!context.memoryManager?.enabled || !context.backend.readMemoryBoundaries) return;
      for (const ownerId of Object.keys(context.rootState.accounts)) await context.serial(() => context.mutate(ownerId, next => {
        next.memoryCaptureSince ??= new Date(context.timestamp()).toISOString();
      }));
      timer = setInterval(() => { void sweep().catch(() => {}); }, 2000); timer.unref?.();
      void sweep().catch(() => {});
    },
    async close() { clearInterval(timer); await flight; await Promise.allSettled([...captures.values()]); },
  };
}

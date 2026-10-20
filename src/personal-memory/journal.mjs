import { enterProfileWrite } from '../personal-backup/write-barrier.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';

const MAX_ITEMS = 5_000;
const MAX_BYTES = 8 * 1024 * 1024;
const OWNER = /^owner-[0-9a-f-]{36}$/i;
const REQUEST = /^[A-Za-z0-9_.:-]{1,128}$/;
const failure = (code) => Object.assign(new Error(code), { code });
const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Host-owned durable command identity; MemoWeft remains the receipt and mutation authority. */
export function createMemoryCommandJournal({ root, prepareCleanup = null, eraseSnippets = null }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw failure('MEMORY_CONFIGURATION_INVALID');
  const queues = new Map();
  const fileFor = (ownerId) => path.join(root, 'accounts', ownerId, 'memory-home', 'command-journal.json');
  function check(ownerId, requestId) {
    if (typeof ownerId !== 'string' || !OWNER.test(ownerId) ||
        typeof requestId !== 'string' || !REQUEST.test(requestId) ||
        Object.hasOwn(Object.prototype, requestId)) throw failure('MEMORY_REQUEST_INVALID');
  }
  const queue = (ownerId, task) => {
    const prior = queues.get(ownerId) ?? Promise.resolve();
    const work = prior.catch(() => {}).then(task);
    queues.set(ownerId, work.catch(() => {}));
    return work;
  };
  async function read(ownerId) {
    const file = fileFor(ownerId);
    const info = await lstat(file).catch((cause) => cause?.code === 'ENOENT' ? null : Promise.reject(cause));
    if (!info) return { version: 1, ownerId, records: {} };
    await ensurePrivateFile(file);
    if (!info.isFile() || info.size > MAX_BYTES) throw failure('MEMORY_JOURNAL_CORRUPT');
    let value;
    try { value = JSON.parse(await readFile(file, 'utf8')); } catch { throw failure('MEMORY_JOURNAL_CORRUPT'); }
    if (value?.version !== 1 || value.ownerId !== ownerId ||
        !value.records || typeof value.records !== 'object' || Array.isArray(value.records) ||
        Object.keys(value.records).length > MAX_ITEMS || Object.entries(value.records).some(([id, row]) =>
          !REQUEST.test(id) || Object.hasOwn(Object.prototype, id) ||
          !row || typeof row !== 'object' || row.requestId !== id ||
          !/^[a-f0-9]{64}$/.test(row.payloadHash ?? '') ||
          row.command?.subject_id !== ownerId || row.command?.command_id !==
            `memory-${digest(`${ownerId}\0${id}`).slice(0, 48)}` ||
          row.command?.schema_version !== 1 || row.command?.actor !== `weftmate:${ownerId}` ||
          typeof row.command?.submitted_at !== 'string' ||
          (row.redacted === true
            ? JSON.stringify(row.command.payload) !== '{}'
            : row.redacted !== undefined && row.redacted !== false ||
              row.payloadHash !== digest(JSON.stringify({ operation: row.command.operation,
                targetKind: row.command.target_kind, targetId: row.command.target_id,
                payload: row.command.payload, expectedWorldRevision: row.command.expected_world_revision,
                ...(row.deleteConversationSnippets !== undefined ? { deleteConversationSnippets: row.deleteConversationSnippets } : {}) }))))) {
      throw failure('MEMORY_JOURNAL_CORRUPT');
    }
    return value;
  }
  async function write(ownerId, value, assertActive = () => {}) {
    const file = fileFor(ownerId);
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw failure('MEMORY_JOURNAL_FULL');
    const releaseWrite = await enterProfileWrite(file);
    const tmp = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(tmp, 'wx', 0o600);
      assertActive();
      await handle.writeFile(body, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await ensurePrivateFile(tmp);
      assertActive();
      await rename(tmp, file);
      await ensurePrivateFile(file);
    } finally {
      await handle?.close().catch(() => {});
      await rm(tmp, { force: true }).catch(() => {});
      releaseWrite();
    }
  }
  async function prepare(ownerId, state, record) {
    const cleanup = record.cleanup;
    if (!cleanup?.deleteConversationSnippets || Array.isArray(cleanup.conversationTargets)) return;
    // A legacy marker already stripped of every locator cannot prove erasure.
    // Keep it pending instead of turning an empty scan into a success receipt.
    if (!cleanup.sourceTexts?.length || !prepareCleanup) throw failure('MEMORY_CLEANUP_PENDING');
    const plan = await prepareCleanup(ownerId, record);
    if (!Array.isArray(plan?.conversationTargets)) throw failure('MEMORY_CLEANUP_PENDING');
    Object.assign(cleanup, plan);
    await write(ownerId, state); // durable text-free locators precede any erase
  }
  return {
    async reserve({ ownerId, requestId, operation, targetKind, targetId, payload, expectedWorldRevision, deleteConversationSnippets, cleanup }, assertActive = () => {}) {
      check(ownerId, requestId);
      const proposal = { operation, targetKind, targetId, payload, expectedWorldRevision,
        ...(deleteConversationSnippets === true ? { deleteConversationSnippets: true } : {}) };
      const payloadHash = digest(JSON.stringify(proposal));
      await ensurePrivateDirectory(path.dirname(fileFor(ownerId)));
      return queue(ownerId, async () => {
        const state = await read(ownerId);
        assertActive();
        const prior = state.records[requestId];
        if (prior) {
          if (prior.payloadHash !== payloadHash) throw failure('MEMORY_REQUEST_CONFLICT');
          return prior;
        }
        if (Object.keys(state.records).length >= MAX_ITEMS) throw failure('MEMORY_JOURNAL_FULL');
        const command = { schema_version: 1,
          command_id: `memory-${digest(`${ownerId}\0${requestId}`).slice(0, 48)}`,
          subject_id: ownerId, actor: `weftmate:${ownerId}`, expected_world_revision: expectedWorldRevision,
          submitted_at: new Date().toISOString(), operation, target_kind: targetKind,
          target_id: targetId, payload };
        state.records[requestId] = { requestId, payloadHash, command,
          ...(deleteConversationSnippets === true ? { deleteConversationSnippets: true } : {}), ...(cleanup ? { cleanup } : {}) };
        await write(ownerId, state, assertActive);
        return state.records[requestId];
      });
    },
    async get(ownerId, requestId) {
      check(ownerId, requestId);
      return queue(ownerId, async () => (await read(ownerId)).records[requestId] ?? null);
    },
    async deletionRequestIds(ownerId) {
      check(ownerId,'account-erase');
      return queue(ownerId,async()=>Object.values((await read(ownerId)).records).filter(row=>['delete_evidence','delete_world_item'].includes(row.command.operation)).map(row=>row.requestId));
    },
    async pendingCleanup(ownerId) {
      check(ownerId, 'pending-cleanup');
      return queue(ownerId, async () => Object.values((await read(ownerId)).records)
        .filter(record => record.cleanup?.snippetsPending === true)
        .map(record => ({ requestId: record.requestId, kind: record.command.target_kind, id: record.command.target_id })));
    },
    async finishCleanup(ownerId, requestId, clean) {
      check(ownerId, requestId);
      return queue(ownerId, async () => {
        const state = await read(ownerId), record = state.records[requestId];
        if (!record) throw failure('MEMORY_REQUEST_INVALID');
        // Receipt inspection and Core storage retries must not reopen the host
        // send gate after its copies have already been erased. Legacy records
        // without proof still run cleanup; a retained pending marker wins.
        if (record.cleanupCompleted === true && !record.cleanup) return;
        try {
          await prepare(ownerId, state, record);
          const result = await clean(record);
          if (record.cleanup?.deleteConversationSnippets && result?.snippetsVerified !== true) throw failure('MEMORY_CLEANUP_PENDING');
        } catch (cause) {
          if (record.cleanup) { record.cleanup.snippetsPending = true; await write(ownerId, state); }
          throw cause;
        }
        delete record.cleanup;
        record.cleanupCompleted = true;
        await write(ownerId, state);
      });
    },
    async redactTargets(ownerId, ids, { sourceTexts = [], sessionId = null } = {}) {
      if (typeof ownerId !== 'string' || !OWNER.test(ownerId) || !Array.isArray(ids) ||
          ids.some((value) => typeof value !== 'string' || value.length > 512)) {
        throw failure('MEMORY_REQUEST_INVALID');
      }
      const targets = new Set(ids);
      return queue(ownerId, async () => {
        const state = await read(ownerId);
        const matchesText = value => typeof value === 'string' && value && sourceTexts.some(text =>
          text && (value.includes(text) || text.includes(value)));
        let count = 0;
        for (const record of Object.values(state.records)) {
          let changed = false;
          const wholeTarget = targets.has(record.command.target_id);
          if (record.redacted !== true && record.command.operation === 'correct_world_item') {
            const payload = record.command.payload;
            // Scope belongs to this command, never to another correction of
            // the same target. Missing legacy session provenance is uncertain.
            if (wholeTarget || sessionId && (!payload.source?.session_id || payload.source.session_id === sessionId) ||
                [payload.correction_text, payload.source?.content].some(matchesText)) {
              record.command.payload = {}; record.redacted = true; changed = true;
            }
          }
          if (['delete_evidence', 'delete_world_item'].includes(record.command.operation) && record.cleanup?.sourceTexts?.length) {
            const refs = record.cleanup.sourceRefs ?? [];
            const retainedRefs = refs.filter(ref => !wholeTarget && !(sessionId &&
              (!ref.sessionIds?.length || ref.sessionIds.includes(sessionId))));
            const retained = record.cleanup.sourceTexts.filter(text => !wholeTarget && !matchesText(text) &&
              (!sessionId || retainedRefs.some(ref => ref.textHash === digest(text))));
            // Old markers have no per-source session IDs: redact uncertain
            // text, preserving the receipt identity and pending cleanup flags.
            if (retained.length !== record.cleanup.sourceTexts.length || retainedRefs.length !== refs.length) {
              if (record.cleanup.deleteConversationSnippets && prepareCleanup) {
                try {
                  await prepare(ownerId, state, record);
                  const erased = await eraseSnippets(ownerId, record);
                  if (erased?.snippetsVerified !== true) throw failure('MEMORY_CLEANUP_PENDING');
                  delete record.cleanup.snippetsPending;
                } catch {
                  record.cleanup.snippetsPending = true;
                  // When even locating the old text failed, keep the last
                  // usable locator until retry can durably replace it by IDs.
                  if (!Array.isArray(record.cleanup.conversationTargets)) { count++; continue; }
                }
              }
              record.cleanup.sourceTexts = retained;
              if (record.cleanup.sourceRefs) record.cleanup.sourceRefs = retainedRefs.filter(ref => retained.some(text => digest(text) === ref.textHash));
              changed = true;
            }
          }
          // Keep command identity and cleanup flags: this removes plaintext,
          // not the pending cleanup or the ability to query its original receipt.
          if (changed) count++;
        }
        if (count) await write(ownerId, state);
        return count;
      });
    },
    async close() { await Promise.all([...queues.values()].map((value) => value.catch(() => {}))); },
  };
}

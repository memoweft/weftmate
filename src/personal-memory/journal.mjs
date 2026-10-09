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
export function createMemoryCommandJournal({ root }) {
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
  async function write(ownerId, value) {
    const file = fileFor(ownerId);
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw failure('MEMORY_JOURNAL_FULL');
    const releaseWrite = await enterProfileWrite(file);
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
      releaseWrite();
    }
  }
  return {
    async reserve({ ownerId, requestId, operation, targetKind, targetId, payload, expectedWorldRevision, deleteConversationSnippets, cleanup }) {
      check(ownerId, requestId);
      const proposal = { operation, targetKind, targetId, payload, expectedWorldRevision,
        ...(deleteConversationSnippets === true ? { deleteConversationSnippets: true } : {}) };
      const payloadHash = digest(JSON.stringify(proposal));
      await ensurePrivateDirectory(path.dirname(fileFor(ownerId)));
      return queue(ownerId, async () => {
        const state = await read(ownerId);
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
        await write(ownerId, state);
        return state.records[requestId];
      });
    },
    async get(ownerId, requestId) {
      check(ownerId, requestId);
      return queue(ownerId, async () => (await read(ownerId)).records[requestId] ?? null);
    },
    async clearCleanup(ownerId, requestId) {
      check(ownerId, requestId);
      return queue(ownerId, async () => { const state = await read(ownerId);
        if (state.records[requestId]?.cleanup) { delete state.records[requestId].cleanup; await write(ownerId, state); }
      });
    },
    async redactTargets(ownerId, ids) {
      if (typeof ownerId !== 'string' || !OWNER.test(ownerId) || !Array.isArray(ids) ||
          ids.some((value) => typeof value !== 'string' || value.length > 512)) {
        throw failure('MEMORY_REQUEST_INVALID');
      }
      const targets = new Set(ids);
      return queue(ownerId, async () => {
        const state = await read(ownerId);
        let count = 0;
        for (const record of Object.values(state.records)) {
          if (!targets.has(record.command.target_id) || record.redacted === true ||
              record.command.operation !== 'correct_world_item') continue;
          record.command.payload = {};
          record.redacted = true;
          count++;
        }
        if (count) await write(ownerId, state);
        return count;
      });
    },
    async close() { await Promise.all([...queues.values()].map((value) => value.catch(() => {}))); },
  };
}

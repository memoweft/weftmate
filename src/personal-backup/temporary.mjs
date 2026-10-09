import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { hasPrivateContent } from '../personal-access/temporary-chats.mjs';
import { reconcileChatIdentity } from '../personal-access/chat-identity.mjs';

/** Operate only on the captured staging tree, never on the live profile. */
export async function omitTemporaryChats(stage) {
  const file = path.join(stage, 'personal-access/store.json');
  let store;
  try { store = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const identifiers = new Set();
  for (const account of Object.values(store.accounts ?? {})) {
    const sessions = new Set(Object.entries(account.sessions ?? {}).filter(([, row]) => hasPrivateContent(row)).map(([id]) => id));
    if (!sessions.size) continue;
    for (const id of sessions) identifiers.add(id);
    const chats = new Set(Object.values(account.chatIdentity?.segments ?? {}).filter(row => sessions.has(row.sessionId)).map(row => row.chatId));
    for (const id of chats) identifiers.add(id);
    for (const field of ['commands', 'toolApprovals', 'userQuestions', 'projectSources', 'browserSources', 'conversationBindings']) {
      for (const [id, row] of Object.entries(account[field] ?? {})) if (sessions.has(row.sessionId)) {
        identifiers.add(id); if (row.taskId) identifiers.add(row.taskId); delete account[field][id];
      }
    }
    for (const id of sessions) delete account.sessions[id];
    for (const [id, row] of Object.entries(account.chatResults ?? {})) if (chats.has(row.sourceChatId)) {
      delete account.chatResults[id];
      for (const [key, op] of Object.entries(account.sideOperations ?? {})) if (op.resultId === id) delete account.sideOperations[key];
    }
    for (const [id, op] of Object.entries(account.chatOperations ?? {})) if (chats.has(op.chatId ?? op.response?.chat?.chatId)) delete account.chatOperations[id];
    if (account.chatIdentity) reconcileChatIdentity(account, account.hostId, new Date().toISOString());
  }
  if (!identifiers.size) return;
  await writeFile(file, JSON.stringify(store), { mode: 0o600 });
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name), relative = path.relative(stage, target).replaceAll('\\', '/');
      // DSH paths use session IDs even when their parent is an encoded project.
      // Projection caches are disposable and may contain titles/full history.
      if ([...identifiers].some(id => entry.name.includes(id)) || /(?:weftmate-history\.sqlite|session_projcache)/.test(relative)) {
        await rm(target, { recursive: entry.isDirectory(), force: true });
      } else if (entry.isDirectory()) await walk(target);
    }
  }
  await walk(stage);
}

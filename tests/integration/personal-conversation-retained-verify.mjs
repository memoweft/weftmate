/** Read-only verification of an already retained Stage12 synthetic profile. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';

const path = process.env.WEFTMATE_STAGE12_RETAINED_PROFILE;
if (process.platform !== 'win32' || process.env.WEFTMATE_STAGE12_RETAINED_VERIFY !== '1' ||
    typeof path !== 'string' || !isAbsolute(path)) throw new Error('Explicit Stage12 retained-profile opt-in required.');
const profile = await realpath(path), temporary = await realpath(tmpdir());
if (!profile.startsWith(temporary + sep) || basename(profile) !== 'profile' ||
    !/^weftmate-synthetic-stop-stage12-[A-Za-z0-9_-]+$/.test(basename(dirname(profile)))) {
  throw new Error('Only a canonical owned Stage12 Temp profile can be inspected.');
}
const marker = JSON.parse(await readFile(join(profile, '.weftmate-personal-host-profile.json'), 'utf8'));
assert.equal(marker.purpose, 'isolated-personal-host');
const ledger = JSON.parse(await readFile(join(profile, 'personal-access', 'store.json'), 'utf8'));
const accounts = Object.values(ledger.accounts ?? {});
const targetId = process.env.WEFTMATE_STAGE12_RETAINED_CONVERSATION_ID;
if (targetId !== undefined && !/^conversation-[0-9a-f-]{36}$/.test(targetId))
  throw new Error('Invalid conversation selector.');
const matches = accounts.flatMap((account) => Object.values(account.conversationBindings ?? {})
  .filter((binding) => binding.status === 'active' && (!targetId || binding.conversationId === targetId))
  .map((binding) => ({ account, binding })));
assert.equal(matches.length, 1, 'Expected exactly one retained active binding.');
const { account, binding } = matches[0];
assert.equal(account.sessions[binding.sessionId]?.conversationId, binding.conversationId);
assert.equal(Object.values(account.sessions).filter((row) => row.conversationId === binding.conversationId).length, 1);
const roots = Object.values(account.commands).filter((row) => row.kind === 'session.message' &&
  row.sessionId === binding.sessionId && row.payload?.conversationId === binding.conversationId &&
  row.state === 'accepted_by_dsh' && row.receiptId);
const withArtifact = roots.map((root) => ({ root, artifact: Object.values(account.commands).find((row) =>
  row.kind === 'desktop.write_artifact' && row.taskId === root.commandId &&
  row.state === 'observed' && row.verification?.status === 'observed') }))
  .filter((item) => item.artifact);
assert.equal(withArtifact.length, 1, 'Expected one verified retained Stage12 task/artifact.');
const { root, artifact } = withArtifact[0];
const artifactPath = join(profile, 'personal-access', 'artifacts', binding.ownerId,
  root.commandId, `${artifact.artifactId}.artifact`);
const resolvedArtifact = await realpath(artifactPath);
assert.ok(resolvedArtifact.startsWith(profile + sep));
const bytes = await readFile(resolvedArtifact);
assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
const fact = /the violet lantern is numbered [0-9a-f]{8}/.exec(binding.contextText)?.[0];
assert.ok(fact, 'The retained owner-bound context omitted the synthetic fact.');
assert.ok(bytes.toString('utf8').includes(fact), 'The verified artifact omitted the exact phone fact.');

const repository = new URL('../../', import.meta.url);
const modulePath = new URL('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js', repository);
const { JsonlSessionPersistence } = await import(modulePath.href);
const projectRoots = await readdir(join(profile, 'dsh-home', 'sessions'), { withFileTypes: true });
const nativePaths = [];
for (const project of projectRoots.filter((entry) => entry.isDirectory()).slice(0, 64)) {
  const candidate = join(profile, 'dsh-home', 'sessions', project.name, binding.sessionId, 'session.jsonl.zstd');
  try { nativePaths.push(await realpath(candidate)); } catch { /* Other workspace. */ }
}
assert.equal(nativePaths.length, 1, 'Expected exactly one physical DSH session log.');
const physical = await JsonlSessionPersistence.prototype.readRaw.call({
  compression: 'zstd', ensureRootEncoding: async () => {},
  findLog: async () => nativePaths[0],
  readStableFile: async () => ({ buffer: await readFile(nativePaths[0]) }),
}, binding.sessionId);
assert.ok(physical?.content && physical.meta?.id === binding.sessionId);
const rows = physical.content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const events = rows.map((row) => row.event ?? row).filter((row) => typeof row?.type === 'string');
const textOf = (parts) => Array.isArray(parts) ? parts.filter((part) => part?.type === 'text')
  .map((part) => part.text).filter((text) => typeof text === 'string').join('\n') : '';
const user = events.find((event) => event.type === 'user/message' && event.data?.source?.kind === 'user' &&
  event.data.source.rpcId === root.receiptId);
assert.ok(user, 'Exact target receipt absent from physical DSH history.');
const start = events.findLast((event) => event.type === 'turn/start' && event.seq < user.seq);
const end = events.find((event) => event.type === 'turn/end' && event.data?.turn === start?.data?.turn &&
  event.seq > user.seq);
assert.equal(end?.data?.reason?.kind, 'completed', 'The retained native turn did not complete.');
const answers = events.filter((event) => event.type === 'assistant/message' &&
  event.seq > user.seq && event.seq < end.seq).map((event) => textOf(event.data?.message?.content));
const factCode = fact.split(' ').at(-1);
assert.ok(answers.some((answer) => answer.includes(factCode) &&
  /violet lantern|紫罗兰灯笼/i.test(answer)), 'Native answer omitted the distinctive fact semantics.');
console.log(JSON.stringify({ verification: 'read_only_retained_passed',
  conversationId: binding.conversationId, sessionId: binding.sessionId,
  taskId: root.commandId, artifactId: artifact.artifactId, artifactSha256: artifact.sha256,
  contextHash: binding.contextHash, nativeTurn: start.data.turn,
  nativeReason: end.data.reason.kind, exactFactInArtifact: true,
  semanticFactInAnswer: true, nativeEventCount: events.length }));

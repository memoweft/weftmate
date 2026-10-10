// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** IA-2.1: isolated Electron host, pinned DSH, synthetic MiMo conversation. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, cp, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../..'), base = await mkdtemp(join(tmpdir(), 'weftmate-ia-2a-'));
const profile = join(base, 'profile'), evidence = join(repository, 'tests/evidence/ia-2a');
await mkdir(profile); await mkdir(evidence, { recursive: true });
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"], { windowsHide: true });
const key = stdout.trim(); assert.ok(key, 'MiMo credential absent');
const username = `ia-${randomUUID()}`, password = `synthetic-${randomUUID()}`;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => ({})]));
const accessRoot = join(profile, 'personal-access');
const prep = await createPersonalAccessService({ root: accessRoot, port: 0, backend });
try {
  const { origin } = await prep.start(), grant = await prep.issueSetupGrant();
  assert.equal((await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username, password, deviceName: 'IA synthetic' }) })).status, 201);
} finally { await prep.close(); }
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || ['ELECTRON_RUN_AS_NODE', 'MIMO_API_KEY', 'MODEL_SWITCH_UNIFIED_KEY'].includes(name)) delete env[name];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
env.WEFTMATE_BASELINE_TRACE = join(base, 'requests.jsonl');
let app, page, launched = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(250); }
  throw new Error('IA-2a isolated host timeout');
}
async function api(path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function launch(root = profile) {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [join(repository, 'tests/integration/personal-baseline-bootstrap.mjs'),
    `--user-data-dir=${root}`, '--personal-host', '--access-port=0'], cwd: repository, env, timeout: 90000 });
  launched++;
  page = await app.firstWindow({ timeout: 90000 }); await page.waitForURL('**/personal/v1/ui');
  await page.evaluate(async credentials => {
    const response = await fetch('/personal/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
    if (!response.ok) throw new Error('Synthetic login failed');
  }, { username, password, deviceName: 'IA migration test' });
  assert.equal((await api('/backups/settings', { enabled: false, directory: join(base, 'Backups') }, 'PATCH')).status, 200);
}
async function command(body) {
  const result = await api('/commands', body); assert.equal(result.status, 202, JSON.stringify(result.body));
  return until(async () => {
    const current = (await api(`/commands/by-request/${body.requestId}`)).body.command;
    if (['rejected', 'uncertain'].includes(current.state)) throw new Error(`Command ${current.state}: ${current.errorCode}`);
    return current.state === 'accepted_by_dsh' && current;
  });
}
async function hashes(directory, prefix = '') {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + item.name, file = join(directory, item.name);
    if (item.isDirectory()) entries.push(...await hashes(file, `${relative}/`));
    else if (item.isFile()) entries.push([relative, createHash('sha256').update(await readFile(file)).digest('hex')]);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}
try {
  await launch();
  const modelRequest = randomUUID();
  assert.equal((await api('/account/models', { requestId: modelRequest, name: 'IA synthetic MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash', apiKey: key })).status, 202);
  const configured = await until(async () => { const operation = (await api(`/account/models/by-request/${modelRequest}`)).body.operation; return !['pending', 'applying'].includes(operation.status) && operation; });
  assert.equal(configured.status, 'succeeded');
  const modelProfileId = (await api('/models')).body.models.find(model => model.name === 'IA synthetic MiMo').id;
  const hostId = (await api('/status')).body.hostId;
  const created = await command({ requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId });
  const sessionId = created.sessionId;
  const sent = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId,
    text: '这是迁移验证用的合成对话。请只回复：蓝色纸船已经就绪。不要使用工具。' });
  const history = await until(async () => {
    const events = (await api(`/sessions/${sessionId}/events?afterSeq=-1&limit=200`)).body.events;
    return events.some(event => event.type === 'turn.ended') && events.some(event => event.type === 'assistant.message') && events;
  }, 180000);
  const group = (await api('/session-groups', { name: '合成分组' })).body.group;
  assert.equal((await api(`/sessions/${sessionId}/metadata`, { title: '迁移样本', groupId: group.id, pinned: true }, 'PATCH')).status, 200);
  await api(`/sessions/${sessionId}/archive`, {});
  await app.close(); app = null;
  const file = join(accessRoot, 'store.json'), old = JSON.parse(await readFile(file, 'utf8'));
  for (const account of Object.values(old.accounts)) delete account.chatIdentity;
  await writeFile(file, JSON.stringify(old));
  await rm(join(accessRoot, 'chat-identity-v1.before.json'));
  // Full stopped pre-upgrade profile for independent rollback rehearsal.
  const rollback = join(base, 'rollback'); await cp(profile, rollback, { recursive: true,
    filter: async source => !source.split(/[\\/]/).includes('node_modules') && !(await lstat(source)).isSymbolicLink() });
  const nativeBefore = await hashes(join(profile, 'dsh-home'));
  const migrate = await createPersonalAccessService({ root: accessRoot, port: 0, backend }); await migrate.close();
  const migrated = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(await hashes(join(profile, 'dsh-home')), nativeBefore);
  const owner = old.legacyOwnerId;
  assert.deepEqual(migrated.accounts[owner].sessions, old.accounts[owner].sessions);
  assert.deepEqual(migrated.accounts[owner].commands, old.accounts[owner].commands);
  assert.deepEqual(migrated.accounts[owner].sessionGroups, old.accounts[owner].sessionGroups);
  const mainId = migrated.accounts[owner].chatIdentity.mainChatId;
  await launch();
  assert.equal((await api('/chats/main')).body.chat.chatId, mainId);
  const link = (await api(`/sessions/${sessionId}/chat`)).body;
  const side = (await api(`/chats/${link.chatId}`)).body.chat;
  assert.equal(side.title, '迁移样本'); assert.equal(side.groupId, group.id); assert.equal(side.archived, true);
  const timelineStart = performance.now();
  const logical = await api(`/chats/${link.chatId}/events`);
  const timelineMs = performance.now() - timelineStart;
  assert.equal(logical.status, 200);
  assert.ok(logical.body.items.some(event => event.type === 'assistant.message'));
  const logicalUser = logical.body.items.find(event => event.type === 'user.message');
  assert.equal(logicalUser.sourceRef.sessionId, sessionId);
  assert.equal((await api(`/chats/${link.chatId}/changes?cursor=${encodeURIComponent(logical.body.syncCursor)}`)).status, 200);
  const search = await until(async () => {
    const value = await api(`/chats/${link.chatId}/search?q=${encodeURIComponent('蓝色纸船')}`);
    return value.body.indexState === 'ready' && value;
  });
  assert.equal(search.status, 200); assert.ok(search.body.hits.length > 0);
  const nativeDate = new Intl.DateTimeFormat('en-CA', { timeZone: logical.body.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(logicalUser.at));
  assert.ok((await api(`/chats/${link.chatId}/locate?date=${nativeDate}`)).body.eventId);
  await writeFile(join(evidence, 'history-native.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
    fixedDsh: true, realElectronHost: true, syntheticAccount: true, randomPorts: true, coldLogicalTimelineMs: timelineMs,
    publicMessagesAndOriginalSources: true, chineseSearch: true, dateLocate: true, independentChanges: true,
    note: 'Small native migration fixture; native cold 10k/100k recovery is measured separately, not inferred from this time.' }, null, 2) + '\n');
  const after = (await api(`/sessions/${sessionId}/events?afterSeq=-1&limit=200`)).body.events;
  for (const event of history.filter(event => ['user.message', 'assistant.message'].includes(event.type))) {
    assert.deepEqual(after.find(row => row.seq === event.seq), event);
  }
  assert.equal((await api(`/commands/by-request/${sent.requestId}`)).body.command.receiptId, sent.receiptId);
  if (process.argv.includes('--side')) {
    const sideModelRequest = randomUUID();
    assert.equal((await api('/account/models', { requestId: sideModelRequest, name: 'IA side MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash', apiKey: key })).status, 202);
    const sideModelOperation = await until(async () => { const row = (await api(`/account/models/by-request/${sideModelRequest}`)).body.operation; return !['pending','applying'].includes(row.status) && row; });
    assert.equal(sideModelOperation.status, 'succeeded');
    const sideModelId = (await api('/models')).body.models.find(model => model.name === 'IA side MiMo').id;
    const createBody = { requestId: randomUUID(), kind: 'session.side.create', targetDeviceId: hostId,
      parent: { kind: 'main', id: mainId }, modelProfileId: sideModelId, title: '独立纸船任务',
      originChatId: link.chatId, originEventId: logicalUser.eventId, entry: 'message' };
    const child = await command(createBody);
    assert.equal(child.kind, 'session.side.create'); assert.ok(child.chatId);
    assert.equal((await api('/commands', createBody)).body.command.chatId, child.chatId);
    const initialChild = (await api(`/chats/${child.chatId}/events`)).body;
    assert.equal(initialChild.items.filter(row => ['user.message','assistant.message'].includes(row.type)).length, 0);
    const childChat = (await api(`/chats/${child.chatId}`)).body.chat;
    assert.equal(childChat.originRefs[0].eventId, logicalUser.eventId);
    assert.equal(childChat.contextTransfer.state, 'references_only');
    const task = await command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: child.sessionId,
      text: '这是隔离测试。请使用 shell 在当前工作目录创建 ia-side-result.txt，内容只写 synthetic paper boat，然后读取确认。只回复“纸船文件已写好”。' });
    const completed = await until(async () => {
      const result = await api(`/tasks/${task.commandId}`);
      if (result.status !== 200) throw new Error(JSON.stringify(result.body));
      const status = result.body.task?.replyEvidence?.status ?? result.body.replyEvidence?.status;
      if (['failed','aborted'].includes(status)) throw new Error(`Synthetic task ${status}`);
      return status === 'completed' && result.body;
    }, 180000);
    const mainEvents = await until(async () => {
      const value = await api(`/chats/${mainId}/events`);
      if (value.status !== 200) throw new Error(JSON.stringify(value.body));
      return value.body.items.some(row => row.type === 'side.result' && row.data.taskId === task.commandId) && value.body;
    });
    const card = mainEvents.items.find(row => row.data.taskId === task.commandId);
    assert.equal(card.sourceRef.kind, 'result'); assert.equal(card.seq, undefined); assert.equal(card.data.state, 'completed');
    assert.equal((await api(`/chats/${mainId}/events`)).body.items.filter(row => row.eventId === card.eventId).length, 1);
    const shareBody = { requestId: randomUUID(), taskId: task.commandId, sourceEventId: card.data.sourceEventId,
      expectedRevision: (await api(`/chats/${child.chatId}`)).body.chat.revision };
    const shared = await api(`/chats/${child.chatId}/results`, shareBody);
    assert.equal(shared.status, 201, JSON.stringify(shared.body)); assert.equal(shared.body.mainEventId, card.eventId);
    assert.equal(shared.body.activityId, card.data.activityId);
    const nativeMain = (await api('/chats/main')).body.chat;
    assert.equal(nativeMain.activeSessionId, null); // No invented main model turn.
    await writeFile(join(evidence, 'side-native.json'), JSON.stringify({ checkedAt: new Date().toISOString(), fixedDsh: true,
      realElectronHost: true, syntheticAccount: true, randomPorts: true, createIdempotent: true, noCopiedOrExecutedSourceMessage: true,
      contextTransfer: 'references_only', independentNativeSession: child.sessionId !== sessionId,
      actualToolTaskCompleted: true, resultState: card.data.state, mainCardHasNoNativeSeq: true,
      explicitAndAutomaticShareSameIdentity: true, sharedActivityIdentity: true, mainHasNoModelSession: true,
      summaryDisplayCharacters: Array.from(card.data.summary).length,
      modelUsageRecordedIn: 'identity-native.json', note: 'No renderer changes, no relay or D33 multi-segment cleanup enabled.' }, null, 2)+'\n');
  }
  await app.close(); app = null;
  await launch(rollback);
  assert.ok((await api(`/sessions/${sessionId}/events?afterSeq=-1&limit=200`)).body.events.some(event => event.type === 'assistant.message'));
  assert.equal((await api(`/commands/by-request/${sent.requestId}`)).body.command.receiptId, sent.receiptId);
  await app.close(); app = null;
  const trace = (await readFile(env.WEFTMATE_BASELINE_TRACE, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const usage = trace.filter(row => row.phase === 'end' && row.usage).map(row => row.usage);
  const summary = { step: '2.1', checkedAt: new Date().toISOString(), pinnedDsh: JSON.parse(await readFile(join(repository, 'tests/contract/dsh-pin.json'), 'utf8')),
    syntheticAccount: true, randomPorts: true, model: 'mimo-v2.6-flash', usage,
    nativeFilesUnchangedByMigration: nativeBefore.length, oldMessagesAndDeepLinksReadable: true,
    originalCommandAndReceiptPreserved: true, groupAndArchivePreserved: true, mainIdentityStableAcrossRestart: true,
    fullStoppedProfileRollbackInSeparateDirectory: true, electronLaunchesClosed: launched,
    limitations: ['First main-chat send and relay belong to IA-2b; no relay enabled.', 'Project/fork/shared mapping is covered by unit fixtures; this native run uses an ordinary session.'] };
  assert.ok(!JSON.stringify(summary).includes(key));
  await writeFile(join(evidence, 'identity-native.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} finally {
  await app?.close().catch(() => {});
  console.log(`Owned isolated profile: ${base}`);
}

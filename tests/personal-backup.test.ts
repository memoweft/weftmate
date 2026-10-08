import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { snapshot, verify, retainedBackups, sqliteSnapshot } from '../src/personal-backup/archive.mjs';
import { beginRestore, rollbackRestore, commitRestore } from '../src/personal-backup/restore.mjs';
import { createBackupManager } from '../src/personal-backup/index.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { validateStore } from '../src/personal-access/store.mjs';
import { copySnapshotTree } from '../src/runtime/dsh-adapter/snapshot-files.mjs';
import { createGatewayV1 } from '../src/runtime/gateway/routes/v1.mjs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { enterProfileWrite } from '../src/personal-backup/write-barrier.mjs';
import { durableWrite } from '../src/personal-access/store.mjs';
import { rehomeSessions } from '../src/personal-backup/rehome.mjs';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'weftmate-backup-')), root = path.join(base, 'profile'), directory = path.join(base, 'Backups');
  await mkdir(path.join(root, 'personal-access'), { recursive: true }); await mkdir(directory);
  t.after(() => rm(base, { recursive: true, force: true }));
  const store = { version: 3, hostId: 'fixture-host', legacyOwnerId: 'fixture-owner', accounts: { 'fixture-owner': { devices: { secret: { token: 'device-secret' } }, setupGrant: null, sessions: {}, commands: {}, setting: 'before' } } };
  await writeFile(path.join(root, 'personal-access/store.json'), JSON.stringify(store));
  return { base, root, directory, control: path.join(root, 'personal-backup'), store };
}
test('BK-1 online SQLite snapshot remains consistent while another connection writes WAL', async t => {
  const f = await fixture(t), file = path.join(f.root, 'memory.sqlite3'), out = path.join(f.base, 'online.sqlite3');
  const db = new DatabaseSync(file); db.exec('PRAGMA journal_mode=WAL; CREATE TABLE rows (id INTEGER PRIMARY KEY, value TEXT);');
  const statement = db.prepare('INSERT INTO rows VALUES (?, ?)');
  for (let i = 0; i < 1500; i++) statement.run(i, 'x'.repeat(10000));
  let writes = 0; const timer = setInterval(() => { if (writes >= 5) return; db.exec('BEGIN'); statement.run(2000 + writes, 'concurrent'); db.exec('COMMIT'); writes++; }, 1);
  try { await sqliteSnapshot(file, out); } finally { clearInterval(timer); db.close(); }
  const copy = new DatabaseSync(out);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.ok(copy.prepare('SELECT count(*) AS n FROM rows').get().n >= 1500); copy.close();
  assert.ok(writes > 0, 'writes overlap the online backup');
});
test('BK-1 snapshot covers content and removes host-managed credentials and device sessions', async t => {
  const f = await fixture(t);
  for (const [file, content] of Object.entries({ 'weftmate-model.enc': 'model-secret', 'desktop-auth.enc': 'cloud-secret', 'dsh-home/.credentials.yaml': 'dsh-secret', 'personal-access/relay/frpc.toml': 'relay-secret', 'personal-access/relay-tls/acme-account.json': 'acme-secret',
    'personal-access/cloud-identity/identity.json': JSON.stringify({ installation: { privateJwk: { d: 'private-secret' } }, bindings: { local: { issuer: 'https://accounts.example.invalid', sub: 'cloud-subject', ownerId: 'fixture-owner', desktop: true, status: 'active' } } }), 'conversations/owner/session/experience.md': '经验', 'conversations/owner/session/Cache/credentials.md': 'user-auth-guide', 'dsh-home/sessions/a/events.jsonl': 'history', 'personal-access/usage.json': 'ledger', 'personal-access/artifacts/result.txt': 'result' })) {
    await mkdir(path.dirname(path.join(f.root, file)), { recursive: true }); await writeFile(path.join(f.root, file), content);
  }
  const row = await snapshot(f), manifest = await verify(path.join(f.directory, row.id));
  for (const name of ['experience.md', 'events.jsonl', 'usage.json', 'result.txt']) assert.ok(manifest.files.some(file => file.path.endsWith(name)));
  assert.ok(manifest.files.some(file => file.path.endsWith('backup-cloud-owners.json')));
  assert.ok(manifest.files.some(file => file.path.endsWith('Cache/credentials.md')), 'user content names are not mistaken for framework caches or vaults');
  const bytes = gunzipSync(await readFile(path.join(f.directory, row.id))).toString();
  for (const secret of ['model-secret', 'cloud-secret', 'dsh-secret', 'private-secret', 'device-secret', 'relay-secret', 'acme-secret']) assert.ok(!bytes.includes(secret));
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp') || name.endsWith('.stage')));
});
test('BK-1 retention keeps recent seven days and one newest copy in each of four weeks', () => {
  const now = Date.UTC(2026, 9, 8), rows = Array.from({ length: 60 }, (_, day) => ({ id: String(day), createdAt: new Date(now - day * 86400000).toISOString() }));
  const keep = retainedBackups(rows, { dailyDays: 7, weeklyCopies: 4 }, now);
  for (let day = 0; day < 7; day++) assert.ok(keep.has(String(day)));
  assert.ok(keep.size >= 9 && keep.size <= 11); assert.ok(!keep.has('59'));
  const custom = retainedBackups(rows, { dailyDays: 2, weeklyCopies: 1 }, now); assert.equal(custom.size, 2);
});
test('BK-1 corrupted archive is rejected before replacing current data', async t => {
  const f = await fixture(t), row = await snapshot(f), file = path.join(f.directory, row.id);
  const bytes = await readFile(file); bytes[Math.floor(bytes.length / 2)] ^= 255; await writeFile(file, bytes);
  await assert.rejects(beginRestore({ ...f, file }), { code: 'BACKUP_CORRUPT' });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'personal-access/store.json'), 'utf8')), f.store);
});
test('BK-1 restore failure rolls all replaced directories back, keeping original credentials', async t => {
  const f = await fixture(t); await mkdir(f.control); await writeFile(path.join(f.root, 'setting.json'), '"before"');
  const row = await snapshot(f); await writeFile(path.join(f.root, 'setting.json'), '"current"'); await writeFile(path.join(f.root, 'weftmate-model.enc'), 'current-key');
  await assert.rejects(beginRestore({ ...f, file: path.join(f.directory, row.id), afterMove: async () => { throw new Error('injected disk failure'); } }), /injected disk failure/);
  assert.equal(await readFile(path.join(f.root, 'setting.json'), 'utf8'), '"current"'); assert.equal(await readFile(path.join(f.root, 'weftmate-model.enc'), 'utf8'), 'current-key');
});
test('BK-1 portable restore installs content into another profile and keeps target host identity', async t => {
  const f = await fixture(t); const row = await snapshot(f), target = path.join(f.base, 'other');
  await mkdir(path.join(target, 'personal-access/cloud-identity'), { recursive: true });
  await writeFile(path.join(target, 'personal-access/cloud-identity/identity.json'), JSON.stringify({ installation: { privateJwk: { d: 'target-private' } }, bindings: {}, claims: {} }));
  await writeFile(path.join(target, 'personal-access/store.json'), JSON.stringify({ hostId: 'other-host' }));
  const control = path.join(target, 'personal-backup'); await mkdir(control);
  await beginRestore({ root: target, control, file: path.join(f.directory, row.id) });
  const state = JSON.parse(await readFile(path.join(target, 'personal-access/store.json'), 'utf8'));
  assert.equal(state.hostId, 'other-host'); assert.equal(state.accounts['fixture-owner'].setting, 'before'); assert.equal(state.accounts['fixture-owner'].devices.secret.revoked, true); assert.equal(state.accounts['fixture-owner'].devices.secret.token, undefined);
  assert.equal(JSON.parse(await readFile(path.join(target, 'personal-access/cloud-identity/identity.json'), 'utf8')).installation.privateJwk.d, 'target-private'); await commitRestore({ root: target, control });
});
test('BK-1 failed startup automatically rolls back durable restore transaction', async t => {
  const f = await fixture(t); await mkdir(f.control); await writeFile(path.join(f.root, 'setting.json'), '"before"');
  const row = await snapshot(f); await writeFile(path.join(f.root, 'setting.json'), '"current"');
  await beginRestore({ ...f, file: path.join(f.directory, row.id) });
  const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => {} });
  assert.equal(await manager.startupFailed(), true); assert.equal(await readFile(path.join(f.root, 'setting.json'), 'utf8'), '"current"');
});
test('BK-1 busy host defers online snapshot; manual backup never restarts', async t => {
  const f = await fixture(t); let idle = false, restarts = 0;
  const manager = await createBackupManager({ root: f.root, isIdle: async () => idle, requestRestart: () => restarts++ });
  await manager.configure({ directory: f.directory, enabled: false });
  await assert.rejects(manager.request(), { code: 'SESSION_BUSY' }); assert.equal(restarts, 0);
  idle = true; const result = await manager.request(); assert.equal(result.restartsHost, false); assert.equal(restarts, 0);
  const view = await manager.view(); assert.equal(view.status.state, 'succeeded'); assert.equal(view.backups.length, 1);
  await manager.finishShutdown();
});

test('BK-1 restores only after producing a verified backup of current state', async t => {
  const f = await fixture(t); const row = await snapshot(f); const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => {}, validate: async () => {} });
  await manager.configure({ directory: f.directory, enabled: false }); await writeFile(path.join(f.root, 'setting.json'), '"current"');
  await manager.restore(row.id); await manager.finishShutdown();
  assert.equal((await manager.view()).status.state, 'pending');
  const restarted = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => {}, validate: async () => {} });
  const view = await restarted.view(); assert.equal(view.status.state, 'succeeded'); assert.equal(view.status.backup.reason, 'before-restore');
  await rollbackRestore(f);
});
test('BK-1 HTTP uses host-owner authorization and CSRF, and fences writes once backup is pending', async t => {
  const f = await fixture(t); await rm(path.join(f.root, 'personal-access/store.json'));
  let pending = false, requests = 0;
  const backend = Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name => [name, async () => ({})]));
  const service = await createPersonalAccessService({ root: path.join(f.root, 'personal-access'), port: 0, backend,
    backupManager: { isPending: () => pending, view: async () => ({ backups: [] }), request: async () => { pending = true; requests++; return { state: 'pending' }; } } });
  t.after(() => service.close()); const { origin } = await service.start();
  async function api(method, route, body, auth = {}) {
    const response = await fetch(`${origin}/personal/v1${route}`, { method, headers: { origin, 'content-type': 'application/json', ...auth }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await api('GET', '/backups')).status, 401);
  const owner = await api('POST', '/auth/setup', { grant: (await service.issueSetupGrant()).grant, username: 'bk-owner', password: 'synthetic long password', deviceName: 'backup test' });
  const other = await api('POST', '/auth/register', { username: 'bk-other', password: 'synthetic long password', deviceName: 'other test' });
  const auth = { cookie: owner.cookie, 'x-weftmate-csrf': owner.body.csrfToken };
  assert.equal((await api('GET', '/backups', undefined, { cookie: other.cookie })).status, 403);
  assert.equal((await api('POST', '/backups', {}, { cookie: owner.cookie })).status, 403);
  assert.equal((await api('POST', '/backups', {}, auth)).status, 202); assert.equal(requests, 1);
  assert.equal((await api('PATCH', '/settings/approvals', { mode: 'ask' }, auth)).status, 503);
  assert.equal((await api('GET', '/backups', undefined, auth)).status, 200);
});
test('BK-1 changed application version snapshots before startup migrations', async t => {
  const f = await fixture(t); await mkdir(f.control); await writeFile(path.join(f.control, 'settings.json'), JSON.stringify({ enabled: false, directory: f.directory, dailyDays: 7, weeklyCopies: 4 }));
  await writeFile(path.join(f.control, 'version.json'), JSON.stringify({ appVersion: 'old' }));
  const manager = await createBackupManager({ root: f.root, appVersion: 'new', isIdle: async () => false, requestRestart: () => {} });
  const view = await manager.view(); assert.equal(view.backups[0].reason, 'before-upgrade');
});
test('BK-1 daily scheduler waits for idle and creates only one successful package per day', async t => {
  const f = await fixture(t); let idle = false, now = Date.UTC(2026, 9, 8), restarts = 0;
  const manager = await createBackupManager({ root: f.root, clock: () => now, isIdle: async () => idle, requestRestart: () => restarts++ });
  await manager.configure({ directory: f.directory }); await manager.checkDaily(); assert.equal(restarts, 0);
  idle = true; await manager.checkDaily(); await manager.checkDaily(); assert.equal((await manager.view()).backups.length, 1); assert.equal(restarts, 0);
  now += 86400000; idle = false; await manager.checkDaily(); assert.equal(restarts, 0);
  idle = true; await manager.checkDaily(); assert.equal((await manager.view()).backups.length, 2); await manager.finishShutdown(); assert.equal(restarts, 0);
});
test('BK-1 account deletion completes a verified online snapshot without another confirmation before returning ready', async t => {
  const f = await fixture(t); const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => {} });
  await manager.configure({ directory: f.directory }); assert.equal((await manager.prepareAccountDeletion()).ready, true);
  await manager.finishShutdown();
  assert.equal((await manager.view()).status.backup.reason, 'before-account-deletion');
});
test('BK-1 portable restore keeps valid command receipts under the new installation ID', async t => {
  const f = await fixture(t); await rm(path.join(f.root, 'personal-access/store.json'));
  const backend = { getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [{ id: 'synthetic', model: 'synthetic', name: 'Synthetic', configured: true }],
    preflight: async () => ({ ok: true }), createSession: async ({ sessionId }) => ({ sessionId }), sendMessage: async () => ({}), cancelSession: async () => ({}),
    readEvents: async ({ afterSeq }) => ({ events: [], nextSeq: afterSeq, hasMore: false }), describeSession: async id => ({ sessionId: id, running: false }) };
  const source = await createPersonalAccessService({ root: path.join(f.root, 'personal-access'), port: 0, backend });
  t.after(() => source.close()); const started = await source.start();
  const setup = await fetch(`${started.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: (await source.issueSetupGrant()).grant, username: 'portable-owner', password: 'synthetic portable password', deviceName: 'source' }) });
  const auth = await setup.json(), headers = { origin: started.origin, 'content-type': 'application/json', cookie: setup.headers.get('set-cookie').split(';')[0], 'x-weftmate-csrf': auth.csrfToken };
  const created = await fetch(`${started.origin}/personal/v1/commands`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'portable-command', kind: 'session.create', targetDeviceId: started.hostId, modelProfileId: 'synthetic' }) });
  assert.equal(created.status, 202); const command = (await created.json()).command;
  for (let i = 0; i < 50; i++) { const row = await (await fetch(`${started.origin}/personal/v1/commands/${command.commandId}`, { headers })).json(); if (row.command.state === 'accepted_by_dsh') break; await new Promise(resolve => setTimeout(resolve, 20)); }
  await source.close(); const row = await snapshot(f), targetRoot = path.join(f.base, 'new-machine'); await mkdir(targetRoot);
  const target = await createPersonalAccessService({ root: path.join(targetRoot, 'personal-access'), port: 0, backend }); const targetHost = (await target.start()).hostId; await target.close();
  const control = path.join(targetRoot, 'personal-backup'); await mkdir(control);
  await beginRestore({ root: targetRoot, control, file: path.join(f.directory, row.id), validate: async stage => validateStore(JSON.parse(await readFile(path.join(stage, 'personal-access/store.json'), 'utf8'))) });
  await commitRestore({ root: targetRoot, control });
  const reopened = await createPersonalAccessService({ root: path.join(targetRoot, 'personal-access'), port: 0, backend }); t.after(() => reopened.close()); const current = await reopened.start();
  const login = await fetch(`${current.origin}/personal/v1/auth/login`, { method: 'POST', headers: { origin: current.origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'portable-owner', password: 'synthetic portable password', deviceName: 'target' }) });
  assert.equal(login.status, 200); const found = await (await fetch(`${current.origin}/personal/v1/commands/${command.commandId}`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } })).json();
  assert.equal(found.command.targetDeviceId, targetHost); assert.equal(found.command.state, 'accepted_by_dsh');
});
test('BK-1 rehoming preserves every compressed event frame after the native header', async t => {
  const f = await fixture(t), stage = path.join(f.base, 'stage'), file = path.join(stage, 'dsh-home/sessions/project/session/log.jsonl.zstd');
  await mkdir(path.dirname(file), { recursive: true });
  const header = zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', id: 'session', cwd: path.join(f.root, 'conversations/owner/session') }) + '\n'));
  const tail = Buffer.concat([zstdCompressSync(Buffer.from('{"type":"user/message"}\n')), zstdCompressSync(Buffer.from('{"type":"turn/end"}\n'))]);
  await writeFile(file, Buffer.concat([header, tail])); const targetRoot = path.join(f.base, 'other');
  await rehomeSessions(stage, targetRoot, { sourceRoot: f.root, files: [{ path: 'dsh-home/sessions/project/session/log.jsonl.zstd' }] }, () => file);
  const result = await readFile(file), first = zstdDecompressSync(result, { info: true });
  assert.equal(JSON.parse(first.buffer.toString()).cwd, path.join(targetRoot, 'conversations/owner/session'));
  assert.deepEqual(result.subarray(first.engine.bytesWritten), tail);
});
test('BK-1 portable restore rebinds an already claimed target to the restored owner, keeping its private key', async t => {
  const f = await fixture(t), issuer = 'https://accounts.example.invalid', sub = 'same-cloud-subject';
  await mkdir(path.join(f.root, 'personal-access/cloud-identity'));
  await writeFile(path.join(f.root, 'personal-access/cloud-identity/identity.json'), JSON.stringify({ installation: { privateJwk: { d: 'source-private' } }, bindings: { bound: { issuer, sub, ownerId: 'fixture-owner', desktop: true, status: 'active' } } }));
  const row = await snapshot(f), target = path.join(f.base, 'claimed-target'), control = path.join(target, 'personal-backup');
  await mkdir(path.join(target, 'personal-access/cloud-identity'), { recursive: true }); await mkdir(control);
  await writeFile(path.join(target, 'personal-access/store.json'), JSON.stringify({ hostId: 'target-host' }));
  await writeFile(path.join(target, 'personal-access/cloud-identity/identity.json'), JSON.stringify({ installation: { privateJwk: { d: 'target-private' } }, bindings: { bound: { issuer, sub, ownerId: 'target-owner', desktop: true, status: 'active', claimId: 'claim' } }, claims: { claim: { ownerId: 'target-owner' } }, devices: { old: {} }, sessions: { old: {} } }));
  await beginRestore({ root: target, control, file: path.join(f.directory, row.id) });
  const identity = JSON.parse(await readFile(path.join(target, 'personal-access/cloud-identity/identity.json'), 'utf8'));
  assert.equal(identity.installation.privateJwk.d, 'target-private'); assert.equal(identity.bindings.bound.ownerId, 'fixture-owner');
  assert.equal(identity.claims.claim.ownerId, 'fixture-owner'); assert.deepEqual(identity.sessions, {}); assert.deepEqual(identity.devices, {});
  await commitRestore({ root: target, control });
});


test('BK-1 write drain timeout releases admission, publishes nothing, then retries on next daily tick', async t => {
  const f = await fixture(t);
  const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => assert.fail('daily restart'), pauseTimeoutMs: 35 });
  await manager.configure({ directory: f.directory });
  const release = await enterProfileWrite(path.join(f.root, 'ledger.json'));
  await assert.rejects(manager.checkDaily(), { code: 'BACKUP_PAUSE_TIMEOUT' });
  assert.equal((await manager.view()).status.state, 'deferred');
  assert.equal((await manager.view()).backups.length, 0);
  const resumed = await enterProfileWrite(path.join(f.root, 'ledger.json')); resumed(); release();
  await manager.checkDaily();
  assert.equal((await manager.view()).backups.length, 1);
  await manager.finishShutdown();
});

test('BK-1 online capture stays coherent during continuous atomic file writes and resumes them before compression', async t => {
  const f = await fixture(t), ledger = path.join(f.root, 'ledger.json');
  const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => assert.fail('online restart') });
  await manager.configure({ directory: f.directory, enabled: false });
  let running = true, writes = 0;
  await durableWrite(ledger, { generation: 0, entries: [] });
  const writer = (async () => {
    while (running) { writes++; await durableWrite(ledger, { generation: writes, entries: Array(writes).fill(writes) }); await new Promise(resolve => setTimeout(resolve, 1)); }
  })();
  const result = await manager.request('daily'); running = false; await writer;
  const extracted = path.join(f.base, 'extracted');
  await verify(path.join(f.directory, result.backup.id), extracted);
  const copied = JSON.parse(await readFile(path.join(extracted, 'ledger.json'), 'utf8'));
  assert.equal(copied.entries.length, copied.generation); assert.ok(copied.entries.every(value => value === copied.generation));
  assert.ok(writes > copied.generation, 'writes continue during hashing/compression');
  assert.equal(manager.isPending(), false);
  await manager.finishShutdown();
});

test('BK-1 task starting at snapshot admission defers backup without cancellation', async t => {
  const f = await fixture(t); let idle = true, cancelled = false;
  const manager = await createBackupManager({ root: f.root, isIdle: async () => idle, requestRestart: () => { cancelled = true; },
    captureBoundary: async work => { idle = false; await work(); } });
  await manager.configure({ directory: f.directory });
  await assert.rejects(manager.checkDaily(), { code: 'SESSION_BUSY' });
  assert.equal(cancelled, false); assert.equal((await manager.view()).backups.length, 0);
  assert.equal((await manager.view()).status.state, 'deferred');
  await manager.finishShutdown();
});


test('BK-1 native capture copies immutable whole log records while the writer event loop is paused', async t => {
  const f = await fixture(t), logs = path.join(f.root, 'logs'), target = path.join(f.base, 'native');
  await mkdir(logs); await mkdir(target);
  const source = path.join(logs, 'events.jsonl');
  await writeFile(source, Array.from({ length: 3000 }, (_, seq) => JSON.stringify({ seq, text: '日志' })).join('\n') + '\n');
  copySnapshotTree(logs, target, { check() {} });
  await writeFile(source, 'later mutation\n');
  const records = (await readFile(path.join(target, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 3000); assert.deepEqual(records.map(row => row.seq), Array.from({ length: 3000 }, (_, seq) => seq));
});

test('BK-1 native pause drains admitted requests, keeps streams alive, and lease expiry releases queued requests', async t => {
  let reads = 0, flushed = 0;
  const gateway = createGatewayV1({ client: { events: {}, llm: {}, workspace: {}, settings: {}, sessions: { list: async () => { reads++; return { result: { ok: true, value: { items: [] } } }; } } },
    lifecycle: { flushIdle: async () => { flushed++; } } });
  const server = createServer((req, res) => void gateway.handle(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { gateway.close(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/weftmate/api/v1`;
  const post = (route, body) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('backup-pause', { id: 'first', deadline: Date.now() + 1000 })).status, 200);
  let finished = false;
  const waiting = fetch(`${base}/sessions`).then(response => { finished = true; return response; });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(finished, false); assert.equal(reads, 0);
  await post('backup-resume', { id: 'stale' }); assert.equal(finished, false);
  await post('backup-resume', { id: 'first' }); assert.equal((await waiting).status, 200);
  assert.equal(flushed, 1);
  assert.equal((await post('backup-pause', { id: 'expires', deadline: Date.now() + 60 })).status, 200);
  assert.equal((await fetch(`${base}/sessions`)).status, 200);
  assert.equal(flushed, 2); assert.equal(reads, 2);
});

test('BK-1 upgrade and account-deletion snapshots complete online; only restore asks for restart', async t => {
  const f = await fixture(t); let restarts = 0;
  const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => restarts++ });
  await manager.configure({ directory: f.directory, enabled: false });
  const upgrade = await manager.request('before-upgrade'); assert.equal(upgrade.restartsHost, false);
  assert.equal((await manager.prepareAccountDeletion()).ready, true); assert.equal(restarts, 0);
  await manager.restore(upgrade.backup.id); assert.equal(restarts, 1);
  await manager.finishShutdown();
  const restarted = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => {}, validate: async () => {} });
  assert.equal(restarted.isRestoredStartup(), true);
  await restarted.started(); assert.equal(restarted.isRestoredStartup(), false); await restarted.finishShutdown();
});

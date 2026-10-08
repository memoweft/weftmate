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
    'personal-access/cloud-identity/identity.json': JSON.stringify({ installation: { privateJwk: { d: 'private-secret' } }, bindings: { local: { issuer: 'https://accounts.example.invalid', sub: 'cloud-subject', ownerId: 'fixture-owner', desktop: true, status: 'active' } } }), 'conversations/owner/session/experience.md': '经验', 'dsh-home/sessions/a/events.jsonl': 'history', 'personal-access/usage.json': 'ledger', 'personal-access/artifacts/result.txt': 'result' })) {
    await mkdir(path.dirname(path.join(f.root, file)), { recursive: true }); await writeFile(path.join(f.root, file), content);
  }
  const row = await snapshot(f), manifest = await verify(path.join(f.directory, row.id));
  for (const name of ['experience.md', 'events.jsonl', 'usage.json', 'result.txt']) assert.ok(manifest.files.some(file => file.path.endsWith(name)));
  assert.ok(manifest.files.some(file => file.path.endsWith('backup-cloud-owners.json')));
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
test('BK-1 busy host refuses restart; unsafe shutdown creates no snapshot', async t => {
  const f = await fixture(t); let idle = false, restarts = 0;
  const manager = await createBackupManager({ root: f.root, isIdle: async () => idle, requestRestart: () => restarts++ });
  await manager.configure({ directory: f.directory, enabled: false });
  await assert.rejects(manager.request(), { code: 'SESSION_BUSY' }); assert.equal(restarts, 0);
  idle = true; await manager.request(); assert.equal(restarts, 1); await manager.finishShutdown({ safe: false });
  const view = await manager.view(); assert.equal(view.status.state, 'failed'); assert.equal(view.backups.length, 0);
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
  idle = true; await manager.checkDaily(); await manager.finishShutdown(); await manager.checkDaily(); assert.equal(restarts, 1);
  now += 86400000; idle = false; await manager.checkDaily(); assert.equal(restarts, 1);
  idle = true; await manager.checkDaily(); await manager.finishShutdown(); assert.equal(restarts, 2);
});
test('BK-1 account deletion requires a verified cold snapshot before returning ready', async t => {
  const f = await fixture(t); const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => {} });
  await manager.configure({ directory: f.directory }); assert.equal((await manager.prepareAccountDeletion()).ready, false);
  await manager.finishShutdown(); assert.equal((await manager.prepareAccountDeletion()).ready, true);
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

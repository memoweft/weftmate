import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, readdir, cp } from 'node:fs/promises';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { snapshot, verify } from '../src/personal-backup/archive.mjs';
import { createBackupManager } from '../src/personal-backup/index.mjs';
import { enterProfileWrite } from '../src/personal-backup/write-barrier.mjs';
import { validateStore } from '../src/personal-access/store.mjs';
import { beginRestore, rollbackRestore, commitRestore } from '../src/personal-backup/restore.mjs';
import { stageCloudVaultRestore, reconcileCloudVaultRestore, commitCloudVaultRestore } from '../src/personal-cloud-backup/vault-restore.mjs';

import {owner,other,sha,fixture,native} from './helpers/cloud-backup-snapshot-fixture.mjs';

test('S4 cloud snapshot isolates account stores, health, memory, usage, connectors and native goals/schedules', async t => {
  const f = await fixture(t);
  f.store.accounts[owner].sessions['session-a'] = { ownerId: owner, title: 'own conversation', modelProfileId: 'own-model' };
  f.store.accounts[other].sessions['session-b'] = { ownerId: other, title: 'other-secret', modelProfileId: 'private-model-other' };
  await f.put('personal-access/store.json', f.store);
  await f.put('personal-access/usage.json', { version: 1, accounts: { [owner]: { records: ['own usage'] }, [other]: { records: ['other usage secret'] } } });
  await f.put('personal-access/connectors.json', { version: 1, accounts: { [owner]: { c_own: { id: 'c_own', slots: ['password'], name: 'own connector' } }, [other]: { c_other: { id: 'c_other', slots: ['key'], name: 'other connector secret' } } } });
  await f.put(`personal-access/accounts/${owner}/health/daily-records.json`, { ownerId: owner, days: { today: 'own health' } });
  await f.put(`personal-access/accounts/${other}/health/daily-records.json`, { ownerId: other, days: { today: 'other health secret' } });
  await f.put(`personal-access/accounts/${owner}/memory-home/memoweft/memoweft.sqlite3`, '');
  const db = new DatabaseSync(path.join(f.root, `personal-access/accounts/${owner}/memory-home/memoweft/memoweft.sqlite3`));
  db.exec("CREATE TABLE facts(text); INSERT INTO facts VALUES ('own memory')"); db.close();
  await f.put(`personal-access/accounts/${other}/memory-home/memoweft/other.txt`, 'other memory secret');
  await f.put('personal-access/sync/events.json', { ownerId: other, events: ['other sync secret'] });
  await f.put(`personal-access/accounts/${owner}/sync/events.json`, { ownerId: owner, events: ['own phone conversation'] });
  await f.put('dsh-home/sessions/project/session-a/log.jsonl', native(f.root, 'session-a'));
  await f.put('dsh-home/sessions/project/session-b/log.jsonl', native(f.root, 'session-b'));
  await f.put('dsh-home/sessions/project/child-a/log.jsonl', native(f.root, 'child-a', { parentSession: 'session-a' }));
  await f.put('dsh-home/personal-schedules.json', { version: 1, sessions: { 'session-a': { items: ['own reminder'] }, 'session-b': { items: ['other reminder secret'] } } });
  await f.put('dsh-home/personal-goal-requests.json', { 'session-a:source:goal-a': { receiptId: 'own-goal' }, 'session-b:source:goal-b': { receiptId: 'other-goal-secret' } });
  await f.put('personal-access/cloud-identity/identity.json', { bindings: { a: { issuer: 'https://synthetic.invalid', sub: 'a', ownerId: owner, desktop: true, status: 'active' }, b: { issuer: 'https://synthetic.invalid', sub: 'b', ownerId: other, desktop: true, status: 'active' } } });
  const row = await snapshot({ ...f, cloudOwnerId: owner }), file = path.join(f.directory, row.id), extracted = path.join(f.base, 'extracted');
  const manifest = await verify(file, extracted), restored = JSON.parse(await readFile(path.join(extracted, 'personal-access/store.json'), 'utf8'));
  assert.deepEqual(Object.keys(restored.accounts), [owner]); assert.equal(restored.legacyOwnerId, owner); validateStore(restored);
  assert.equal(manifest.cloud.ownerId, owner); assert.ok(manifest.files.some(row => row.path.endsWith('memoweft.sqlite3')));
  assert.ok(manifest.files.some(row => row.path.includes('/child-a/')));
  const bytes = gunzipSync(await readFile(file)).toString('utf8');
  for (const text of ['other-secret', 'other usage secret', 'other health secret', 'other memory secret', 'other connector secret', 'other reminder secret', 'other-goal-secret', 'other sync secret', 'history-session-b']) assert.ok(!bytes.includes(text), text);
  assert.deepEqual(JSON.parse(await readFile(path.join(extracted, 'personal-access/backup-cloud-owners.json'), 'utf8')), [{ issuer: 'https://synthetic.invalid', sub: 'a', ownerId: owner }]);
});

test('S4 content hash ignores capture time and device auth changes, but detects user data and credentials changes', async t => {
  const f = await fixture(t); f.store.accounts[owner].devices = { device: { tokenHash: 'a'.repeat(64), csrfHash: 'b'.repeat(64), revoked: false, lastSeenAt: 'old' } }; await f.put('personal-access/store.json', f.store);
  const captureSecrets = async () => ({ models: [{ profileId: 'own-model', value: 'synthetic-api-secret' }] });
  const a = await snapshot({ ...f, cloudOwnerId: owner, captureSecrets, now: 1000000000000 });
  f.store.accounts[owner].devices.device.tokenHash = 'c'.repeat(64); f.store.accounts[owner].devices.device.lastSeenAt = 'new'; await f.put('personal-access/store.json', f.store);
  const b = await snapshot({ ...f, cloudOwnerId: owner, captureSecrets, now: 1000000001000 });
  assert.equal(a.contentHash, b.contentHash); assert.notEqual(a.manifest.createdAt, b.manifest.createdAt);
  assert.equal(a.credentials.models[0].value, 'synthetic-api-secret');
  assert.ok(!gunzipSync(await readFile(path.join(f.directory, a.id))).includes(Buffer.from('synthetic-api-secret')), 'plaintext credentials stay in memory');
  f.store.accounts[owner].defaultApprovalMode = 'allow'; await f.put('personal-access/store.json', f.store);
  const c = await snapshot({ ...f, cloudOwnerId: owner, captureSecrets }); assert.notEqual(b.contentHash, c.contentHash);
  const d = await snapshot({ ...f, cloudOwnerId: owner, captureSecrets: async () => ({ models: [{ profileId: 'own-model', value: 'synthetic-new-secret' }] }) }); assert.notEqual(c.contentHash, d.contentHash);
});

test('S4 compressed native sessions preserve every frame and trusted descendants, excluding other accounts', async t => {
  const f = await fixture(t); f.store.accounts[owner].sessions['session-a'] = { ownerId: owner }; await f.put('personal-access/store.json', f.store);
  const header = zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', id: 'session-a', cwd: f.root }) + '\n'));
  const tail = Buffer.concat([zstdCompressSync(Buffer.from('{"type":"user/message"}\n')), zstdCompressSync(Buffer.from('{"type":"turn/end"}\n'))]);
  const original = Buffer.concat([header, tail]); await f.put('dsh-home/sessions/project/session-a/log.jsonl.zstd', original);
  const row = await snapshot({ ...f, cloudOwnerId: owner }), extracted = path.join(f.base, 'extracted'); await verify(path.join(f.directory, row.id), extracted);
  const actual = await readFile(path.join(extracted, 'dsh-home/sessions/project/session-a/log.jsonl.zstd'));
  assert.deepEqual(actual, original); assert.equal(JSON.parse(zstdDecompressSync(actual.subarray(0, header.length)).toString().trim()).id, 'session-a');
});

test('S4 cloud manager waits for the BK-1 fence, captures secrets inside it and never requests restart', async t => {
  const f = await fixture(t); let inBoundary = false, boundaries = 0;
  const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => assert.fail('snapshot must keep host running'), captureBoundary: async work => { inBoundary = true; boundaries++; try { await work(); } finally { inBoundary = false; } } });
  await manager.configure({ directory: f.directory, enabled: false });
  const row = await manager.cloudSnapshot(owner, { captureSecrets: async metadata => { assert.equal(inBoundary, true); assert.equal(metadata.ownerId, owner); return { synthetic: 'in-memory' }; } });
  assert.equal(boundaries, 1); assert.ok(path.isAbsolute(row.file)); assert.equal(path.dirname(row.file), path.join(f.root, 'personal-backup/cloud-capture'));
  assert.equal((await manager.view()).backups.length, 0); assert.equal(row.verification, 'valid');
  await rm(row.file); await manager.stopOnline(); await manager.finishShutdown();
});

test('S4 cloud snapshot rejects busy admission and releases the write fence after timeout', async t => {
  const f = await fixture(t); let idle = false;
  const manager = await createBackupManager({ root: f.root, isIdle: async () => idle, requestRestart: () => assert.fail('no task cancellation'), pauseTimeoutMs: 30 });
  await assert.rejects(manager.cloudSnapshot(owner), { code: 'SESSION_BUSY' }); idle = true;
  const release = await enterProfileWrite(path.join(f.root, 'personal-access/store.json'));
  await assert.rejects(manager.cloudSnapshot(owner), { code: 'BACKUP_PAUSE_TIMEOUT' }); release();
  const row = await manager.cloudSnapshot(owner); await rm(row.file);
  assert.deepEqual(await readdir(path.join(f.root, 'personal-backup/cloud-capture')), []); await manager.stopOnline(); await manager.finishShutdown();
});

test('S4 cloud snapshot refuses an absent account and unsafe owner path without publishing a file', async t => {
  const f = await fixture(t);
  await assert.rejects(snapshot({ ...f, cloudOwnerId: 'owner-missing' }), { code: 'ACCOUNT_LOGIN_REQUIRED' });
  await assert.rejects(snapshot({ ...f, cloudOwnerId: '../other' }), { code: 'INVALID_REQUEST' });
  assert.deepEqual(await readdir(f.directory), []);
});

test('S4 cloud restore replaces the matching cloud account and preserves other accounts and original user files', async t => {
  const source = await fixture(t), target = await fixture(t), targetOwner = 'owner-target-synthetic';
  const issuer = 'https://synthetic.invalid', sub = 'synthetic-sub';
  await source.put('personal-access/cloud-identity/identity.json', { bindings: { one: { issuer, sub, ownerId: owner, desktop: true, status: 'active' } } });
  await source.put(`personal-access/accounts/${owner}/health/daily-records.json`, { marker: 'restored own health' });
  await source.put(`personal-access/accounts/${owner}/sync/events.json`, { ownerId: owner, events: ['restored own phone conversation'] });
  await source.put('personal-access/usage.json', { version: 1, accounts: { [owner]: { records: ['restored own usage'] } } });
  await source.put('weftmate-settings.json', { schemaVersion: 3, models: { profiles: [{ id: 'source-model' }], activeId: 'source-model' } });
  const saved = await snapshot({ ...source, cloudOwnerId: owner });
  target.store.accounts[targetOwner] = target.store.accounts[owner]; delete target.store.accounts[owner]; target.store.executionOwnerId = targetOwner;
  target.store.accounts[other].sessions['session-retained'] = { ownerId: other };
  await target.put('personal-access/store.json', target.store);
  await target.put('personal-access/cloud-identity/identity.json', { bindings: { one: { issuer, sub, ownerId: targetOwner, desktop: true, status: 'active' } }, installation: { privateJwk: { d: 'synthetic-target-private' } } });
  await target.put(`personal-access/accounts/${targetOwner}/health/daily-records.json`, { marker: 'old replaced health' });
  await target.put(`personal-access/accounts/${other}/health/daily-records.json`, { marker: 'retained other health' });
  await target.put('personal-access/sync/events.json', { ownerId: other, events: ['retained other phone conversation'] });
  await target.put('personal-access/usage.json', { version: 1, accounts: { [targetOwner]: { records: ['old replaced usage'] }, [other]: { records: ['retained other usage'] } } });
  await target.put('weftmate-settings.json', { schemaVersion: 3, models: { profiles: [{ id: 'old-target-model' }, { id: 'private-model-retained' }], activeId: 'old-target-model' } });
  await target.put('dsh-home/sessions/project/session-retained/log.jsonl', native(target.root, 'session-retained'));
  const originals = ['workspace/original.txt', 'desktop-artifacts/export.txt', 'personal-access/artifacts/result.txt', `conversations/${sha(targetOwner)}/old-chat/original.pdf`, `personal-access/accounts/${targetOwner}/sync/attachments/original.bin`];
  for (const name of originals) await target.put(name, `original-${name}`);
  const control = path.join(target.root, 'personal-backup'); await mkdir(control);
  await beginRestore({ root: target.root, control, file: path.join(source.directory, saved.id), validate: async stage => validateStore(JSON.parse(await readFile(path.join(stage, 'personal-access/store.json'), 'utf8'))) });
  const restored = JSON.parse(await readFile(path.join(target.root, 'personal-access/store.json'), 'utf8'));
  assert.deepEqual(Object.keys(restored.accounts).sort(), [owner, other].sort()); assert.equal(restored.hostId, target.store.hostId); assert.equal(restored.executionOwnerId, owner); assert.equal(restored.legacyOwnerId, other);
  assert.equal(JSON.parse(await readFile(path.join(target.root, 'personal-access/cloud-identity/identity.json'), 'utf8')).bindings.one.ownerId, owner);
  assert.equal(JSON.parse(await readFile(path.join(target.root, `personal-access/accounts/${other}/health/daily-records.json`), 'utf8')).marker, 'retained other health');
  assert.equal(JSON.parse(await readFile(path.join(target.root, `personal-access/accounts/${owner}/health/daily-records.json`), 'utf8')).marker, 'restored own health');
  assert.deepEqual(JSON.parse(await readFile(path.join(target.root, 'personal-access/sync/events.json'), 'utf8')).events, ['retained other phone conversation']);
  assert.deepEqual(JSON.parse(await readFile(path.join(target.root, `personal-access/accounts/${owner}/sync/events.json`), 'utf8')).events, ['restored own phone conversation']);
  assert.equal(JSON.parse(await readFile(path.join(target.root, 'personal-access/usage.json'), 'utf8')).accounts[other].records[0], 'retained other usage');
  const profiles = JSON.parse(await readFile(path.join(target.root, 'weftmate-settings.json'), 'utf8')).models.profiles.map(row => row.id);
  assert.deepEqual(profiles, ['private-model-retained', 'source-model']);
  assert.ok((await readFile(path.join(target.root, 'dsh-home/sessions/project/session-retained/log.jsonl'), 'utf8')).includes('history-session-retained'));
  for (const name of originals) assert.equal(await readFile(path.join(target.root, name), 'utf8'), `original-${name}`);
  await commitRestore({ root: target.root, control });
  for (const name of originals) assert.equal(await readFile(path.join(target.root, name), 'utf8'), `original-${name}`);
});

test('S4 cloud restore validation failure preserves the current account and original user files', async t => {
  const source = await fixture(t), target = await fixture(t), saved = await snapshot({ ...source, cloudOwnerId: owner }), control = path.join(target.root, 'personal-backup');
  await mkdir(control); await target.put('workspace/original.txt', 'keep original');
  const before = await readFile(path.join(target.root, 'personal-access/store.json'));
  await assert.rejects(beginRestore({ root: target.root, control, file: path.join(source.directory, saved.id), validate: async () => { throw new Error('synthetic validation failure'); } }), /synthetic validation failure/);
  assert.deepEqual(await readFile(path.join(target.root, 'personal-access/store.json')), before); assert.equal(await readFile(path.join(target.root, 'workspace/original.txt'), 'utf8'), 'keep original');
  assert.equal(await rollbackRestore({ root: target.root, control }), false);
});

test('S4 temporary conversation descendants and experience never enter the cloud package', async t => {
  const f = await fixture(t); f.store.accounts[owner].sessions['session-private'] = { ownerId: owner, temporary: true };
  await f.put('personal-access/store.json', f.store);
  await f.put('dsh-home/sessions/project/session-private/log.jsonl', native(f.root, 'session-private'));
  await f.put('dsh-home/sessions/project/child-private/log.jsonl', native(f.root, 'child-private', { parentSession: 'session-private' }));
  await f.put(`conversations/${sha(owner)}/session-private/经验.md`, 'temporary experience secret');
  const saved = await snapshot({ ...f, cloudOwnerId: owner }), bytes = gunzipSync(await readFile(path.join(f.directory, saved.id))).toString('utf8');
  assert.ok(!bytes.includes('history-session-private')); assert.ok(!bytes.includes('history-child-private')); assert.ok(!bytes.includes('temporary experience secret'));
  assert.ok(!saved.manifest.files.some(row => row.path.includes('private/log.jsonl')));
});

test('S4 paired data and vault restore recover each crash boundary without splitting their state', async t => {
  for (const phase of ['before-intent', 'after-intent', 'rollback-after-intent', 'after-data-journal', 'unrelated-local']) await t.test(phase, async t => {
    const source = await fixture(t), target = await fixture(t);
    source.store.accounts[owner].setting = 'source-data'; await source.put('personal-access/store.json', source.store);
    target.store.accounts[owner].setting = 'target-data'; await target.put('personal-access/store.json', target.store);
    const saved = await snapshot(source), control = path.join(target.root, 'personal-backup'), restoreDirectory = path.join(control, 'cloud', 'synthetic-restore');
    await mkdir(restoreDirectory, { recursive: true });
    const outputFile = path.join(restoreDirectory, 'restored.wmb'); await cp(path.join(source.directory, saved.id), outputFile);
    const vaultFile = path.join(target.root, 'weftmate-model.enc'); await writeFile(vaultFile, 'synthetic-before-vault');
    const vault = {
      snapshotVaultBytes: () => existsSync(vaultFile) ? readFileSync(vaultFile) : null,
      prepareCloudVaultBytes: () => Buffer.from('synthetic-after-vault'),
      restoreVaultBytes: bytes => { if (bytes === null) rmSync(vaultFile, { force: true }); else writeFileSync(vaultFile, bytes); },
    };
    const journalOutput = phase === 'unrelated-local' ? path.join(restoreDirectory, 'unrelated-restored.wmb') : outputFile;
    if (phase === 'unrelated-local') await cp(outputFile, journalOutput);
    await stageCloudVaultRestore(target.root, vault, {}, { outputFile: journalOutput });
    await beginRestore({ root: target.root, control, file: outputFile });
    const dataJournalFile = path.join(control, 'restore.json'), dataJournal = JSON.parse(await readFile(dataJournalFile, 'utf8'));
    assert.equal(dataJournal.sourceFile, path.resolve(outputFile));
    dataJournal.state = 'starting'; await writeFile(dataJournalFile, JSON.stringify(dataJournal));
    await reconcileCloudVaultRestore(target.root, vault, true);
    assert.equal(await readFile(vaultFile, 'utf8'), 'synthetic-after-vault');
    if (phase === 'after-intent' || phase === 'rollback-after-intent') {
      await commitCloudVaultRestore(target.root, outputFile);
      assert.equal(JSON.parse(await readFile(path.join(control, 'cloud-vault-restore.json'), 'utf8')).state, 'committed');
      if (phase === 'rollback-after-intent') {
        assert.equal(await rollbackRestore({ root: target.root, control }), false, 'startup failure retries committed cleanup instead of rolling data back');
        assert.equal(JSON.parse(await readFile(path.join(target.root, 'personal-access/store.json'), 'utf8')).accounts[owner].setting, 'source-data');
        assert.equal(await readFile(vaultFile, 'utf8'), 'synthetic-after-vault');
        await assert.rejects(readFile(dataJournalFile), { code: 'ENOENT' });
      }
    } else if (phase === 'after-data-journal') {
      await commitRestore({ root: target.root, control });
      await assert.rejects(readFile(dataJournalFile), { code: 'ENOENT' });
      assert.equal(JSON.parse(await readFile(path.join(control, 'cloud-vault-restore.json'), 'utf8')).state, 'committed');
      await writeFile(vaultFile, 'synthetic-after-user-update');
    } else if (phase === 'unrelated-local') await commitCloudVaultRestore(target.root, journalOutput);
    // This is the next cold start after the simulated process termination.
    const restarted = await createBackupManager({ root: target.root, isIdle: async () => true, requestRestart: () => {}, validate: async () => {} });
    await reconcileCloudVaultRestore(target.root, vault, restarted.isRestoredStartup());
    const accountState = JSON.parse(await readFile(path.join(target.root, 'personal-access/store.json'), 'utf8')).accounts[owner];
    if (phase === 'before-intent') {
      assert.equal(accountState.setting, 'target-data'); assert.equal(await readFile(vaultFile, 'utf8'), 'synthetic-before-vault');
    } else if (phase === 'unrelated-local') {
      assert.equal(accountState.setting, 'target-data', 'another archive commit marker cannot force a local transaction forward');
      assert.equal(await readFile(vaultFile, 'utf8'), 'synthetic-after-vault', 'the unrelated committed vault stays committed');
    } else {
      assert.equal(accountState.setting, 'source-data');
      assert.equal(await readFile(vaultFile, 'utf8'), phase === 'after-data-journal' ? 'synthetic-after-user-update' : 'synthetic-after-vault');
    }
    await assert.rejects(readFile(dataJournalFile), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(control, 'cloud-vault-restore.json')), { code: 'ENOENT' });
    await restarted.stopOnline(); await restarted.finishShutdown();
  });
});

test('S4 live Core worker leases are excluded from cloud and local captures while a normal empty user file stays in local backup', async t => {
  const f = await fixture(t), databasePath = `personal-access/accounts/${owner}/memory-home/memoweft/memoweft.sqlite3`, workerDirectory = `${databasePath}.workers`;
  await mkdir(path.dirname(path.join(f.root, databasePath)), { recursive: true });
  const database = new DatabaseSync(path.join(f.root, databasePath));
  database.exec("CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES('synthetic durable memory')"); database.close();
  await f.put(`${workerDirectory}/synthetic-live-worker.lock`, 'synthetic process lease');
  await f.put('workspace/ordinary-empty.txt', Buffer.alloc(0));
  const manager = await createBackupManager({ root: f.root, isIdle: async () => true, requestRestart: () => assert.fail('capture does not interrupt Core') });
  await manager.configure({ directory: f.directory, enabled: false });
  try {
    const captured = await manager.cloudSnapshot(owner);
    const cloudManifest = await verify(captured.file);
    assert.ok(cloudManifest.files.some(row => row.path === databasePath));
    assert.ok(!cloudManifest.files.some(row => row.path.startsWith(workerDirectory)), 'capture skips the exclusive operational directory before any lease read');
    const local = await snapshot(f), localManifest = await verify(path.join(f.directory, local.id));
    assert.ok(localManifest.files.some(row => row.path === databasePath));
    assert.ok(!localManifest.files.some(row => row.path.startsWith(workerDirectory)));
    assert.equal(localManifest.files.find(row => row.path === 'workspace/ordinary-empty.txt')?.size, 0, 'zero-byte user files are genuine backup data');
    assert.equal(await readFile(path.join(f.root, `${workerDirectory}/synthetic-live-worker.lock`), 'utf8'), 'synthetic process lease', 'capture does not delete or alter Core lease ownership');
    await rm(captured.file);
  } finally { await manager.stopOnline(); await manager.finishShutdown(); }
});

test('S4 a valid legacy package hashes Core leases but installs neither its source lease nor the target lease', async t => {
  const source = await fixture(t), target = await fixture(t), databasePath = `personal-access/accounts/${owner}/memory-home/memoweft/memoweft.sqlite3`, workerDirectory = `${databasePath}.workers`;
  await mkdir(path.dirname(path.join(source.root, databasePath)), { recursive: true });
  const sourceDatabase = new DatabaseSync(path.join(source.root, databasePath));
  sourceDatabase.exec("CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES('synthetic restored memory')"); sourceDatabase.close();
  await source.put('workspace/ordinary-empty.txt', Buffer.alloc(0));
  const saved = await snapshot(source), file = path.join(source.directory, saved.id), content = gunzipSync(await readFile(file));
  const first = content.indexOf(10), end = content.indexOf(10, first + 1), manifest = JSON.parse(content.subarray(first + 1, end).toString());
  const lease = Buffer.from('synthetic obsolete worker lease'), leasePath = `${workerDirectory}/synthetic-source-worker.lock`;
  manifest.files.push({ path: leasePath, size: lease.length, sha256: sha(lease) });
  const header = JSON.stringify(manifest), prefix = Buffer.from(`WMB1 ${sha(header)}\n${header}\n`), payload = content.subarray(end + 1);
  await writeFile(file, gzipSync(Buffer.concat([prefix, payload, lease])));
  assert.ok((await verify(file)).files.some(row => row.path === leasePath), 'intact legacy package remains selectable and verifiable');
  const corruptedLease = Buffer.from(lease); corruptedLease[0] ^= 1;
  const corruptedFile = path.join(source.directory, 'synthetic-corrupted-lease.wmb'); await writeFile(corruptedFile, gzipSync(Buffer.concat([prefix, payload, corruptedLease])));
  await assert.rejects(verify(corruptedFile), { code: 'BACKUP_CORRUPT' }, 'skipping installation still authenticates every legacy lease byte');
  await target.put(`${workerDirectory}/synthetic-target-worker.lock`, 'synthetic target process lease');
  const control = path.join(target.root, 'personal-backup'); await mkdir(control);
  await beginRestore({ root: target.root, control, file, validate: async stage => {
    await assert.rejects(readFile(path.join(stage, leasePath)), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(stage, `${workerDirectory}/synthetic-target-worker.lock`)), { code: 'ENOENT' }, 'target lease is not copied into the replacement staging tree');
    validateStore(JSON.parse(await readFile(path.join(stage, 'personal-access/store.json'), 'utf8')));
  } });
  await assert.rejects(readFile(path.join(target.root, leasePath)), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(target.root, `${workerDirectory}/synthetic-target-worker.lock`)), { code: 'ENOENT' });
  assert.equal((await readFile(path.join(target.root, 'workspace/ordinary-empty.txt'))).length, 0);
  const restoredDatabase = new DatabaseSync(path.join(target.root, databasePath));
  assert.equal(restoredDatabase.prepare('SELECT value FROM facts').get().value, 'synthetic restored memory');
  assert.equal(restoredDatabase.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); restoredDatabase.close();
  await commitRestore({ root: target.root, control });
});

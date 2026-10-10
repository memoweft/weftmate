// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { verify } from '../../src/personal-backup/archive.mjs';
const repository = resolve(import.meta.dirname, '../..'), base = join('C:/Temp', `weftmate-bk-1-${randomUUID()}`), profile = join(base, 'profile');
const evidence = join(repository, 'tests/evidence/bk-1'); await mkdir(evidence, { recursive: true }); await mkdir(profile, { recursive: true });
const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"], { windowsHide: true });
const key = stdout.trim(); assert.ok(key, 'MiMo credential absent');
const username = `bk-${randomUUID()}`, password = `test-${randomUUID()}-password`, memoryConfig = join(base, 'memory-config.json');
await writeFile(memoryConfig, JSON.stringify({ python: 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe', pythonPath: 'D:/AIProjects/MemoWeft/Core/py/src', baseUrl: 'http://127.0.0.1:8081/v1', model: '@current', authRef: 'fixture' }));
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const backend = Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name => [name, async () => ({})]));
const prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend }), started = await prep.start(), setup = await prep.issueSetupGrant();
assert.equal((await fetch(`${started.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: setup.grant, username, password, deviceName: 'BK-1 synthetic fixture' }) })).status, 201); await prep.close();
const env = { ...process.env }; for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || ['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name)) delete env[name];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
env.WEFTMATE_BASELINE_TRACE = join(base, 'requests.jsonl'); env.TEMP = env.TMP = 'C:/Temp';
let app, page, child;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 120000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(500); } throw new Error('BK-1 isolated scenario timeout'); }
async function api(path, body, method = body ? 'POST' : 'GET') {
    return page.evaluate(async ({ path, body, method }) => {
        const me = await (await fetch('/personal/v1/auth/me')).json();
        const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, body: await response.json() };
    }, { path, body, method });
}
async function launch(root = profile) {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [join(repository, 'tests/integration/bk-1-bootstrap.mjs'), `--user-data-dir=${root}`, '--personal-host', '--access-port=0', `--personal-memory-config=${memoryConfig}`], cwd: repository, env, timeout: 90000 });
    child = app.process();
    let log = ''; const capture = data => { log += String(data).replaceAll(key, '[private-model]'); void writeFile(join(base, 'host.log'), log); }; app.process().stdout?.on('data', capture); app.process().stderr?.on('data', capture);
    page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(90000); await page.waitForURL('**/personal/v1/ui');
    // The baseline vault is intentionally memory-only; re-enter the test key after each launch.
    await app.evaluate((_, key) => globalThis.bkSeedCredentials(key), key);
    await until(async () => await page.getByRole('button', { name: '离线使用这台电脑', exact: true }).isVisible() || (await api('/auth/me')).status === 200);
    // Existing local emergency login exposes standard label associations.
    if (await page.getByRole('button', { name: '离线使用这台电脑', exact: true }).isVisible()) {
        await page.getByRole('button', { name: '离线使用这台电脑', exact: true }).click();
        await page.getByLabel('本地账户名', { exact: true }).fill(username); await page.getByLabel('离线密码', { exact: true }).filter({ visible: true }).fill(password);
        await page.getByRole('button', { name: '登录', exact: true }).click();
    }
    await until(async () => (await api('/auth/me')).status === 200);
    const settings = await api('/backups/settings', { enabled: false, directory: join(base, 'Backups'), dailyDays: 7, weeklyCopies: 4 }, 'PATCH'); assert.equal(settings.status, 200, JSON.stringify(settings.body));
}
async function closed() { await until(() => child.exitCode !== null, 120000); }
async function settingsPage() {
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    if (!await dialog.isVisible()) { await page.getByRole('button', { name: '账户菜单', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click(); }
    await dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '备份与恢复', exact: true }).click();
    await page.getByRole('button', { name: '刷新备份列表', exact: true }).click();
}
async function captureBackup(name) {
    await page.getByRole('heading', { name: '备份与恢复', exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(350); // Existing settings entrance motion completes before the viewport capture.
    await page.screenshot({ path: join(evidence, name) });
}
async function configureModel() {
    const requestId = randomUUID(); assert.equal((await api('/account/models', { requestId, name: 'MiMo BK-1', baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash', apiKey: key })).status, 202);
    const operation = await until(async () => { const row = (await api(`/account/models/by-request/${requestId}`)).body.operation; return row && !['pending','applying'].includes(row.status) && row; }); assert.equal(operation.status, 'succeeded');
    const model = (await api('/models')).body.models.find(row => row.name === 'MiMo BK-1'); assert.ok(model); await api('/settings/models', { backgroundModelProfileId: model.id }, 'PATCH'); return model.id;
}
try {
    await launch(); const modelProfileId = await configureModel(), hostId = (await api('/status')).body.hostId;
    const create = await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId }); assert.equal(create.status, 202);
    const command = await until(async () => { const row = (await api(`/commands/${create.body.command.commandId}`)).body.command; return row.state === 'accepted_by_dsh' && row; }); const sessionId = command.sessionId;
    await api(`/sessions/${sessionId}/approval-mode`, { mode: 'allow-all' }, 'PATCH');
    const message = await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId,
        text: '记住我的长期早餐偏好：我一直喜欢蒸紫薯。请在默认对话工作目录创建 breakfast.md，写一句这个偏好，并把这个文件作为成果展示给我。不要询问。' }); assert.equal(message.status, 202);
    const windowBefore = await app.evaluate(({ BrowserWindow }) => ({ pid: process.pid, ids: BrowserWindow.getAllWindows().map(window => window.id) }));
    // Trigger the actual production daily scheduler while MiMo is executing a turn.
    await until(async () => (await api('/sessions')).body.sessions?.some(row => row.sessionId === sessionId && row.running), 30000);
    const duringTurn = await app.evaluate(() => globalThis.bkDailyTick());
    assert.equal(duringTurn.backups.length, 0, 'daily backup is deferred while a real MiMo task runs');
    assert.equal(child.exitCode, null); assert.equal(page.isClosed(), false);
    await until(async () => (await api(`/sessions/${sessionId}/events?limit=200`)).body.events?.some(row => row.type === 'turn.ended'), 240000);
    const memories = await until(async () => { const value = (await api('/memory/items?kind=cognition')).body; return value.items?.some(row => row.text.includes('紫薯')) && value; }, 180000);
    console.log('MiMo conversation and memory formed');
    const artifacts = await api(`/sessions/${sessionId}/resources`); assert.equal(artifacts.status, 200); assert.ok(artifacts.body.outputs?.length > 0, 'MiMo published a real artifact');
    await api('/settings/approvals', { mode: 'ask' }, 'PATCH');
    await settingsPage(); await captureBackup('desktop-backup-settings.png');
    const daily = await app.evaluate(() => globalThis.bkDailyTick());
    assert.equal(daily.status.state, 'succeeded', JSON.stringify(daily.status));
    assert.equal(daily.status.backup.reason, 'daily');
    assert.equal(child.exitCode, null); assert.equal(page.isClosed(), false);
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => ({ pid: process.pid, ids: BrowserWindow.getAllWindows().map(window => window.id) })), windowBefore);
    await page.getByRole('button', { name: '立即备份', exact: true }).click();
    await until(async () => (await api('/backups')).body.status?.backup?.reason === 'manual');
    assert.equal(child.exitCode, null); assert.equal(page.isClosed(), false);
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => ({ pid: process.pid, ids: BrowserWindow.getAllWindows().map(window => window.id) })), windowBefore);
    const status = JSON.parse(await readFile(join(profile, 'personal-backup/status.json'), 'utf8')); assert.equal(status.state, 'succeeded', JSON.stringify(status)); const backupId = status.backup.id;
    const manifest = await verify(join(base, 'Backups', backupId)); assert.ok(manifest.files.some(row => row.path.endsWith('memoweft.sqlite3'))); assert.ok(manifest.files.some(row => row.path.endsWith('breakfast.md')));
    assert.ok(!gunzipSync(await readFile(join(base, 'Backups', backupId))).includes(Buffer.from(key)), 'live MiMo key does not enter the package');
    const deleted = await api(`/sessions/${sessionId}`, { forgetMemories: false }, 'DELETE'); assert.equal(deleted.status, 200, JSON.stringify(deleted.body)); await api('/settings/approvals', { mode: 'allow-all' }, 'PATCH');
    await settingsPage(); await page.getByRole('button', { name: /^恢复 / }).first().click();
    await page.getByRole('dialog', { name: '恢复备份', exact: true }).screenshot({ path: join(evidence, 'desktop-restore-confirm.png') }); await page.getByRole('button', { name: '确认恢复', exact: true }).click(); await closed();
    await launch(); const restored = (await api('/backups')).body.status; assert.equal(restored.state, 'succeeded', JSON.stringify(restored)); assert.ok(restored.restored); assert.ok((await api('/sessions')).body.sessions.some(row => row.sessionId === sessionId)); assert.equal((await api('/settings/approvals')).body.mode, 'ask');
    assert.ok((await api('/memory/items?kind=cognition')).body.items.some(row => row.text.includes('紫薯'))); assert.equal((await api(`/sessions/${sessionId}/resources`)).body.outputs.length, artifacts.body.outputs.length);
    await settingsPage(); await captureBackup('desktop-restored.png');
    const restoredDeletion = await api(`/sessions/${sessionId}`, { forgetMemories: false }, 'DELETE');
    assert.equal(restoredDeletion.status, 200, 'first restored startup owns the native session disposer: ' + JSON.stringify(restoredDeletion.body));
    await app.close();
    const other = join(base, 'other-profile'); await mkdir(other); await writeFile(join(other, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
    // A different installation ID and empty account prove that source credentials are not required.
    const targetSetup = await createPersonalAccessService({ root: join(other, 'personal-access'), port: 0, backend });
    const targetOrigin = (await targetSetup.start()).origin, targetGrant = await targetSetup.issueSetupGrant();
    assert.equal((await fetch(`${targetOrigin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: targetOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: targetGrant.grant, username, password, deviceName: 'BK-1 other computer' }) })).status, 201); await targetSetup.close();
    await launch(other); const imported = await api('/backups/import', { path: join(base, 'Backups', backupId) }); assert.equal(imported.status, 201);
    assert.equal((await api('/backups/restore', { id: imported.body.id, confirm: true })).status, 202); await closed(); await launch(other);
    assert.ok((await api('/sessions')).body.sessions.some(row => row.sessionId === sessionId)); assert.ok((await api('/memory/items?kind=cognition')).body.items.some(row => row.text.includes('紫薯')));
    const targetStatus = (await api('/status')).body; assert.notEqual(targetStatus.hostId, hostId);
    const continued = await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: targetStatus.hostId, sessionId, text: '只读取本对话默认工作目录中的 breakfast.md，回复文件里的早餐偏好；不要改文件。' }); assert.equal(continued.status, 202);
    await until(async () => { const rows = (await api(`/sessions/${sessionId}/events?limit=200`)).body.events; return rows?.filter(row => row.type === 'turn.ended').length >= 2; }, 180000);
    const targetStore = JSON.parse(await readFile(join(other, 'personal-access/store.json'), 'utf8'));
    const ownSession = targetStore.accounts[Object.keys(targetStore.accounts).find(id => targetStore.accounts[id].sessions[sessionId])];
    assert.ok(ownSession); await settingsPage(); await captureBackup('desktop-other-computer.png');
    const summary = { desktop: true, dailyDeferredDuringMiMoTurn: true, dailyAndManualPreserveWindowIdsAndPid: true, model: 'mimo-v2.6-flash', conversationAndMemory: true, artifactCount: artifacts.body.outputs.length, backupVerified: true, deletedConversationRestored: true, restoredSessionCanBeDeleted: true, settingsRestored: true, memoryRestored: true, artifactsRestored: true, portableRestoreAndRelogin: true, credentialReconfigured: true };
    await writeFile(join(evidence, 'verification.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} finally { await app?.close().catch(() => {}); console.log(`Isolated BK-1 profile: ${base}`); }

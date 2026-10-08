/** Real desktop regression with isolated account/ledger; no model calls or daily data. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { createUsageStore } from '../../src/personal-access/usage.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';

const root = await mkdtemp(join(tmpdir(), 'weft-fix-3-'));
const profile = join(root, 'profile');
await mkdir(profile);
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
let time = Date.parse('2026-09-30T16:30:00Z'), app, prep;
const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(key => [key, async () => key === 'listModels' ? [] : {}]));
try {
    prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend, clock: () => time });
    const { origin } = await prep.start(), grant = await prep.issueSetupGrant();
    const response = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username: 'TimezoneFixture', password: 'Synthetic-Timezone-2026', deviceName: 'Fixture' }) });
    assert.equal(response.status, 201);
    const owner = (await response.json()).account.ownerId;
    await prep.close(); prep = null;
    const usage = await createUsageStore({ root: join(profile, 'personal-access'), clock: () => time });
    await usage.configure(owner, { timeZone: 'UTC' });
    for (const date of ['2026-09-30T16:30:00Z', '2026-10-31T15:30:00Z', '2026-10-31T16:00:00Z']) {
        time = Date.parse(date);
        const id = await usage.begin(owner, { profileId: 'fixture', model: { model: 'mimo-v2.6-flash', sourceKind: 'cloud' } });
        await usage.finish(owner, id, { prompt_tokens: 1000, completion_tokens: 100 });
    }
    await usage.close();
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (name.startsWith('WEFTMATE_') || name.startsWith('MEMOWEFT_') || name === 'ELECTRON_RUN_AS_NODE') delete env[name];
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], cwd: resolve(import.meta.dirname, '../..'), env, timeout: 90000 });
    const page = await app.firstWindow(); page.setDefaultTimeout(60000);
    await page.waitForURL('**/personal/v1/ui');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
    await page.getByRole('button', { name: '离线使用这台电脑', exact: true }).click();
    await page.getByRole('textbox', { name: '本地账户名', exact: true }).fill('TimezoneFixture');
    await page.getByRole('textbox', { name: '离线密码', exact: true }).fill('Synthetic-Timezone-2026');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '账户菜单', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const reported = page.waitForResponse(response => response.url().endsWith('/settings/usage') && response.request().method() === 'PATCH');
    await page.getByText('用量', { exact: true }).click();
    assert.equal((await (await reported).json()).timeZone, 'Asia/Shanghai');
    await page.getByRole('heading', { name: '用量与费用', exact: true }).waitFor();
    const result = await page.evaluate(async () => {
        const summary = await (await fetch('/personal/v1/usage?month=2026-10&timeZone=Asia%2FShanghai')).json();
        const settings = await (await fetch('/personal/v1/settings/usage')).json();
        return { summary, settings };
    });
    assert.equal(result.summary.total.requests, 2);
    assert.equal(result.summary.days[0].requests, 1); assert.equal(result.summary.days[30].requests, 1);
    assert.equal(result.settings.timeZone, 'Asia/Shanghai');
    await page.getByRole('spinbutton', { name: '月度上限（元）', exact: true }).fill('1');
    const saved = page.waitForResponse(response => response.url().endsWith('/settings/usage') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: '保存月度上限', exact: true }).click();
    assert.equal((await (await saved).json()).timeZone, 'Asia/Shanghai');
    console.log('FIX-3 real Electron: local timezone reported/persisted, October midnight/month-end grouping, settings save passed');
} catch (error) {
    if (app) console.log(await (await app.firstWindow()).locator('body').innerText());
    throw error;
} finally {
    await app?.close(); await prep?.close();
    await rm(root, { recursive: true, force: true });
}

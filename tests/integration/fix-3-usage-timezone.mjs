// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
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
    env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
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
    await page.getByText('按 中国标准时间（Asia/Shanghai） 统计，金额按请求时单价计算，供参考，以服务商账单为准。', { exact: true }).waitFor();
    await page.getByLabel('统计月份', { exact: true }).fill('2026-10');
    const chart = page.getByRole('img', { name: '2026-10 每日费用柱状图（中国标准时间（Asia/Shanghai））', exact: true });
    await chart.waitFor();
    assert.match(await chart.getByTitle(/2026-10-01/).getAttribute('title'), /2026-10-01（中国标准时间（Asia\/Shanghai））/);
    await page.getByText('每日明细', { exact: true }).click();
    await page.getByRole('listitem').filter({ hasText: /^2026-10-01（中国标准时间（Asia\/Shanghai））/ }).waitFor();
    await page.getByRole('listitem').filter({ hasText: /^2026-10-31（中国标准时间（Asia\/Shanghai））/ }).waitFor();
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
    // A response in another zone must win over the renderer's Shanghai zone.
    for (const timeZone of ['America/New_York', 'Fixture/Unavailable']) {
        await page.evaluate(timeZone => {
            const target = document.createElement('section'); target.setAttribute('aria-label', '时区呈现验证'); document.body.append(target);
            const total = { cost: 1, requests: 1, inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 };
            globalThis.WeftUsageView({ loadUsage: async () => ({ summary: { month: '2026-10', timeZone,
                total, days: [{ day: '2026-10-01', ...total, unknownRequests: 0 }], budget: { effectiveLimit: null } },
                settings: { canManage: false }, sessions: [], models: [] }), usageMoney: value => `¥${value}` }, target);
        }, timeZone);
        const fixture = page.getByRole('region', { name: '时区呈现验证', exact: true });
        await fixture.getByText(new RegExp(`^按 .*${timeZone}.* 统计，`)).waitFor();
        await fixture.getByRole('img', { name: new RegExp(timeZone) }).waitFor();
        await fixture.getByText('每日明细', { exact: true }).click();
        await fixture.getByRole('listitem').filter({ hasText: new RegExp(`^2026-10-01（.*${timeZone}`) }).waitFor();
        if (timeZone === 'Fixture/Unavailable') await fixture.getByText(/^按 Fixture\/Unavailable 统计，/).waitFor();
        await fixture.evaluate(target => target.remove());
    }
    console.log('FIX-3/FIX-4 real Electron: timezone reported/persisted, October boundaries, localized labels, response timezone and IANA fallback passed');
} catch (error) {
    if (app) console.log(await (await app.firstWindow()).locator('body').innerText());
    throw error;
} finally {
    await app?.close(); await prep?.close();
    await rm(root, { recursive: true, force: true });
}

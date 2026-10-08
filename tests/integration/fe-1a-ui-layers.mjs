import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const repository = resolve(import.meta.dirname, '../..');
const evidence = join(repository, 'tests/evidence/fe-1a');
const phase = process.argv.includes('--before') ? 'before' : 'after';
const moved = process.argv.includes('--relocated');
const capture = !process.argv.includes('--verify-only');
const baselineCommit = 'fc156ee85bb62d37c91818402aea91848186ee35';
const baselineAssets = phase === 'before' ? new Map(['index.html', 'app.js', 'desktop.js', 'timeline.js'].map(name => [name, execFileSync('git', ['show', `${baselineCommit}:src/personal-access-ui/${name}`], { cwd: repository, encoding: 'utf8' })])) : null;
const root = mkdtempSync(join(tmpdir(), 'weftmate-fe-1a-'));
writeFileSync(join(root, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
mkdirSync(evidence, { recursive: true });
let candidate = await startTimelineCandidate({ historyCount: 0, interactive: true, riskApproval: true, baseTime: Date.parse('2026-10-08T08:00:00Z') });
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let application, fixtureOwner, page; const errors = [];
async function until(check) { const deadline = performance.now() + 30000; while (performance.now() < deadline) { if (await check()) return; await new Promise(done => setTimeout(done, 100)); } throw Error('Fixture condition timed out'); }
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: ['.', '--personal-host', '--access-port=0', `--user-data-dir=${root}`, '--force-device-scale-factor=1'], env, timeout: 90000 });
  page = await application.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(30000);
  await page.waitForURL('**/personal/v1/ui*');
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.addInitScript(() => { const NativeDate = Date; const fixed = 1791446500000; globalThis.__fixtureTime = fixed; globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return globalThis.__fixtureTime; } }; });
  await page.route('**/personal/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/ui')) {
      const name = /\/ui\/?$/.test(url.pathname) ? 'index.html' : url.pathname.split('/').at(-1);
      if (baselineAssets?.has(name)) return route.fulfill({ contentType: name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', body: baselineAssets.get(name) });
      return route.continue();
    }
    if (/\/memory\/items\/.*\/sources$/.test(url.pathname)) return route.fulfill({ json: { ownerId: fixtureOwner, sources: [{ recordedAt: '2026-10-08T08:00:00Z', contentAvailable: true, rawContent: '合成偏好：使用中文说明。' }] } });
    const response = await route.fetch({ url: candidate.origin + url.pathname + url.search,
      headers: { ...route.request().headers(), origin: candidate.origin } });
    if (/\/events$/.test(url.pathname)) {
      const data = await response.json();
      for (const event of data.events || []) if (event.type === 'assistant.message') event.data.memoryUsed = [{ id: 'synthetic-memory', kind: 'cognition', summary: '使用中文说明' }];
      return route.fulfill({ response, json: data });
    }
    if (/\/auth\/(me|login)$/.test(url.pathname)) { const data = await response.json(); fixtureOwner = data.account?.ownerId; }
    await route.fulfill({ response });
  });
  const url = new URL(page.url()); url.hash = ''; await page.goto(url.href);
  async function shot(name) {
    if (moved || !capture) return;
    await page.getByText('已登录。', { exact: true }).waitFor({ state: 'hidden' }); await page.mouse.move(0, 0); await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(evidence, `${phase}-${name}.png`), animations: 'disabled' });
  }
  await page.getByRole('heading', { name: '登录 WeftMate' }).waitFor(); await shot('login');
  await page.getByRole('textbox', { name: '账户名', exact: true }).fill(candidate.credentials.username);
  await page.getByLabel('密码', { exact: true }).filter({ visible: true }).fill(candidate.credentials.password);
  await page.getByRole('textbox', { name: '这台设备的名称' }).fill('隔离桌面测试');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  if (moved) {
    // Override only the composition module, before initialization; production layout is never edited.
    await page.route('**/personal/v1/ui/layout.js', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(repository, 'src/personal-access-ui/layout.js'), 'utf8').replace('/* layout-test-slot */', "document.querySelector('.rail-top').append(document.getElementById('conversation-resources')); ") }));
    await page.reload(); await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  }
  await page.getByRole('button', { name: '允许一次', exact: true }).waitFor();
  await page.getByRole('button', { name: '总是允许此类', exact: true }).waitFor();
  await page.getByRole('button', { name: '拒绝', exact: true }).waitFor(); await shot('running-approval-question');
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('把报告写得简短一些');
  await page.getByRole('textbox', { name: '输入消息', exact: true }).press('Enter');
  await until(() => candidate.operations.some(op => op.text === '把报告写得简短一些' && op.mode === 'steer'));
  await page.getByRole('textbox', { name: '输入消息', exact: true }).waitFor();
  await shot('sent');
  await page.getByText('执行了 2 步 · 用时 2 秒', { exact: true }).click();
  await page.getByText('读取 3 个文件', { exact: true }).click();
  await page.getByText(/Read 3 files successfully/).waitFor(); await shot('steps');
  await page.getByRole('button', { name: '输出与来源', exact: true }).click();
  await page.getByRole('button', { name: /README.md.*读取/ }).click();
  await page.getByText('读取 1 次', { exact: true }).waitFor(); await shot('sources');
  await page.getByRole('button', { name: '收起右侧面板', exact: true }).click();
  await page.getByRole('button', { name: '查看这条回复采用的 1 条记忆来源', exact: true }).click();
  await page.getByText('合成偏好：使用中文说明。', { exact: true }).waitFor(); await shot('memory');
  await page.getByRole('button', { name: '收起右侧面板', exact: true }).click();
  await page.getByRole('radio', { name: '简要报告', exact: true }).check();
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.getByRole('button', { name: '允许一次', exact: true }).click();
  await until(() => page.getByText(/已提交允许|已允许本次/).count());
  await candidate.complete(true);
  await page.getByRole('button', { name: /项目进度报告/ }).click();
  await page.getByText('报告已保存，测试全部通过。', { exact: true }).waitFor(); await page.getByRole('button', { name: '发送', exact: true }).waitFor(); await shot('completed');
  await page.getByRole('button', { name: '打开成果', exact: true }).click();
  await page.getByRole('heading', { name: '项目进度报告' }).waitFor(); await shot('artifact');
  await page.getByRole('button', { name: '收起右侧面板', exact: true }).click();
  await page.getByRole('button', { name: /TimelineFixture/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('combobox', { name: /^颜色模式/ }).selectOption('dark');
  await shot('appearance');
  // The other two decisions, queue/steer and stop use fresh synthetic accounts in the same real program.
  const decisions = [];
  for (const label of ['总是允许此类', '拒绝']) {
    const previous = candidate;
    candidate = await startTimelineCandidate({ historyCount: 0, interactive: true, riskApproval: true });
    await page.reload(); await previous.close();
    await page.getByRole('heading', { name: '登录 WeftMate' }).waitFor();
    await page.getByRole('textbox', { name: '账户名', exact: true }).fill(candidate.credentials.username);
    await page.getByLabel('密码', { exact: true }).filter({ visible: true }).fill(candidate.credentials.password);
    await page.getByRole('textbox', { name: '这台设备的名称' }).fill('隔离桌面测试');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).waitFor();
    const replied = page.waitForResponse(value => value.request().method() === 'POST' && /\/approvals\//.test(value.url()));
    await page.getByRole('button', { name: label, exact: true }).click();
    const result = await replied; const receipt = await result.json();
    assert.equal(result.status(), 200); assert.equal(receipt.approval.status, 'answered');
    assert.equal(receipt.approval.decisionOutcome, label === '拒绝' ? 'rejected' : 'allowed-once');
    if (label === '总是允许此类') assert.equal(JSON.parse(result.request().postData()).scope, 'conversation-category');
    decisions.push(label);
    await page.getByRole('combobox', { name: '运行中输入方式', exact: true }).selectOption('queue');
    await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('下一件事：合成排队目标');
    await page.getByRole('textbox', { name: '输入消息', exact: true }).press('Enter');
    await until(() => candidate.operations.some(op => op.text === '下一件事：合成排队目标' && op.mode === 'queue'));
    await until(async () => (await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue()) === '');
    await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('停止时保留草稿');
    if (label === '拒绝') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: '停止', exact: true }).click();
    await until(() => candidate.operations.some(op => op.kind === 'cancel'));
    assert.equal(await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(), '停止时保留草稿');
  }
  assert.deepEqual(errors, []);
  if (capture) writeFileSync(join(evidence, moved ? 'relocated-verification.json' : `${phase}-verification.json`), JSON.stringify({ baselineCommit, decisions, queue: true, stopButton: true, escapeStop: true, realProgram: true, syntheticHost: true, isolated: true, modelRequests: 0, relocated: moved, flows: ['login', 'send-steer', 'running', 'approval-three-buttons', 'question', 'steps', 'sources', 'memory', 'completed', 'artifact', 'appearance'], errors }, null, 2) + '\n');
  console.log(`FE-1a ${moved ? 'relocated' : phase} real program flows passed.`);
} catch (error) { console.error('Renderer errors:', errors); if (page) { console.error((await page.locator('body').innerText()).slice(-1600)); await page.screenshot({path: join(root, 'failure.png')}); console.error('Isolated diagnostics:', root); } throw error; } finally { await page?.unrouteAll({ behavior: 'wait' }).catch(() => {}); await application?.close().catch(() => {}); await candidate.close(); }









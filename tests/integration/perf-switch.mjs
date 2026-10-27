import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, open, unlink, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { measureUi } from '../helpers/ui-smoothness.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = process.env.WEFTMATE_PERF_SWITCH_OUTPUT;
assert.ok(out, 'WEFTMATE_PERF_SWITCH_OUTPUT names a caller-owned evidence directory');
await mkdir(out, { recursive: true });
const temp = join(root, '.local', 'perf-switch'); await mkdir(temp, { recursive: true });
process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(temp, 'fixtures');
let app, fixture, lock, page;
const kill = () => { const pid = app?.process()?.pid; if (pid && app.process().exitCode === null) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' }); };
const watchdog = setTimeout(() => { kill(); process.exitCode = 1; }, 170000);
const samples = [], errors = [];
try {
  if (process.env.WEFTMATE_HEAVY_LOCK_DIR) {
    for (const n of [1, 2, 3]) {
      const path = join(process.env.WEFTMATE_HEAVY_LOCK_DIR, `heavy-${n}.lock`);
      try { const file = await open(path, 'wx'); await file.writeFile('PERF-SWITCH ' + new Date().toISOString()); await file.close(); lock = path; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    assert.ok(lock, 'No heavy slot available');
  }
  fixture = await startFixture();
  const history = fixture.logs.get(fixture.source); history.length = 0;
  const put = (type, data) => history.push({ seq: history.length, type, data, sessionId: fixture.source, at: new Date().toISOString() });
  for (let turn = 1; turn <= 150; turn++) {
    put('turn.started', { turn }); put('user.message', { text: `合成问题 ${turn}`, receiptId: `synthetic-${turn}`, turn });
    for (let step = 0; step < (turn === 150 && !process.argv.includes('--code-only') ? 80 : 1); step++)
      put('step.completed', { taskId: `turn-${turn}`, stepId: `step-${turn}-${step}`, toolName: 'read', state: 'completed', summary: `读取合成资料 ${step}`, turn });
    put('assistant.message', { text: `合成回复 ${turn}\n\n**代码示例**\n\n\`\`\`js\n${'const synthetic = 123;\n'.repeat(35)}\`\`\`\n\n报告已保存`, turn });
    put('turn.ended', { turn, reason: 'completed' });
  }
  const profile = await mkdtemp(join(temp, 'profile-'));
  const env = { ...process.env, PERF_SWITCH_PROFILE: profile, PERF_SWITCH_ORIGIN: fixture.origin, PERF_SWITCH_TOKEN: fixture.libraryDesktopToken }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root, args: ['tests/helpers/perf-switch-electron.mjs'], env, timeout: 25000 });
  app.process().stdout?.resume(); app.process().stderr?.resume();
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }); Object.defineProperty(document, 'hidden', { get: () => false }); });
  await page.route('**/personal/v1/ui/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: (await readFile(join(root, 'src/personal-access-ui/app.js'), 'utf8')).replace('ui.loadAttachmentHasher =', 'globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =') }));
  if (process.argv.includes('--original')) {
    for (const file of ['components/main-chat.js', 'components/messages.js', 'components/steps.js', 'composer-subtasks.js', 'next-suggestions.js', 'popovers.js', 'timeline.js', 'ui-core/model-label.js', 'ui-core/main-chat.js', 'ui-core/work-and-chat.js']) {
      const path = file.startsWith('ui-core/') ? `src/${file}` : `src/personal-access-ui/${file}`;
      const body = execFileSync('git', ['show', `${process.env.WEFTMATE_PERF_SWITCH_BASE || 'HEAD'}:${path}`], { cwd: root, encoding: 'utf8' });
      await page.route(`**/personal/v1/ui/${file}`, route => route.fulfill({ contentType: 'text/javascript', body }));
    }
  }
  await page.waitForURL('**/personal/v1/ui');
  await localUiSession(page, fixture.credentials, 'PERF-SWITCH synthetic', { mainChat: true });
  await page.waitForFunction(() => globalThis.__WeftUiStarted && testCore.state.sessions.length > 0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('wm:desktop:visibility', false));
  await page.evaluate(id => testCore.selectSession(id), fixture.source);
  await page.getByText('合成回复 150', { exact: false }).first().waitFor();
  const cdp = await page.context().newCDPSession(page);
  const profiling = process.argv.includes('--profile');
  if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); }
  for (const width of process.argv.includes('--behavior-only') ? [] : [1280, 900]) {
    await app.evaluate(({ BrowserWindow }, [w,h]) => BrowserWindow.getAllWindows()[0].setContentSize(w,h), [width, width === 1280 ? 800 : 700]);
    for (let repetition = 0; repetition < 3; repetition++) {
      await page.keyboard.press('Control+n');
      await page.waitForFunction(() => testCore.state.newConversation);
      await page.evaluate(() => { testCore.chooseSidebarMode('work'); WeftDesktop.toggleRail(false); });
      if (profiling) await cdp.send('Profiler.start');
      samples.push({ width, repetition, ...await measureUi(page, 'switch-conversation', () => page.locator(`.session-row[data-session-id="${fixture.source}"] > button`).first().click(), { kind: 'conversation', id: fixture.source }) });
      if (profiling) { const { profile } = await cdp.send('Profiler.stop'); await writeFile(join(out, `cpu-${width}-${repetition}.json`), JSON.stringify(profile)); }
    }
  }
  if (process.argv.includes('--behavior-only')) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900,700));
  await page.screenshot({ path: join(out, 'long-conversation.png') });
  const mounted = await page.locator('#transcript > li').count();
  await writeFile(join(out, 'smoothness.json'), JSON.stringify({ complete:false, samples, mounted, syntheticMessages: 300, syntheticEvents: history.length }, null, 2));
  console.log(JSON.stringify({ samples, mounted }));
  if (!process.argv.includes('--baseline')) {
    assert.ok(mounted < 60, `Only nearby messages should mount, got ${mounted}`);
    if (!process.argv.includes('--code-only')) {
      const processKey = `progress:legacy:${fixture.source}:receipt:synthetic-150`;
      await page.evaluate(key => testUi.focusMainEvent(key), processKey);
      const process = page.locator(`[data-event-id="${processKey}"] .execution-block`);
      assert.equal(await process.locator('.execution-step').count(), 0, 'A folded history has only its summary');
      await process.locator(':scope > summary').click();
      await page.waitForFunction(key => [...document.querySelectorAll('#transcript > [data-event-id]')].find(row => row.dataset.eventId === key)?.querySelectorAll('.execution-step').length === 80, processKey);
      assert.equal(await process.locator('.execution-step').count(), 80, 'Expanding shows every original step');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const anchor = await page.evaluate(key => ({ key, offset: [...document.querySelectorAll('#transcript > [data-event-id]')].find(row => row.dataset.eventId === key).getBoundingClientRect().top - document.getElementById('chat-scroll').getBoundingClientRect().top }), processKey);
      await page.keyboard.press('Control+n');
      await page.waitForFunction(() => testCore.state.newConversation);
      await page.evaluate(() => { testCore.chooseSidebarMode('work'); WeftDesktop.toggleRail(false); });
      samples.push({ width:900, ...await measureUi(page, 'switch-expanded-process', () => page.locator(`.session-row[data-session-id="${fixture.source}"] > button`).first().click(), { kind:'conversation-anchor', id:fixture.source, ...anchor }) });
      await page.waitForFunction(key => [...document.querySelectorAll('#transcript > [data-event-id]')].find(row => row.dataset.eventId === key)?.querySelector('.execution-block')?.open, processKey);
      await page.waitForFunction(key => [...document.querySelectorAll('#transcript > [data-event-id]')].find(row => row.dataset.eventId === key)?.querySelectorAll('.execution-step').length === 80, processKey);
      assert.equal(await process.locator('.execution-step').count(), 80);
    }
    // Load hundreds of messages through the real history endpoint. Scrolling
    // and returning must preserve a message anchor, not a height estimate.
    await page.evaluate(async () => {
      testUi.conversationScroll.hold();
      for (let n = 0; n < 5 && testCore.state.hasOlder; n++) await testCore.loadOlderHistory();
    });
    await page.waitForFunction(() => testCore.state.historyEvents.size > 500);
    await page.waitForFunction(() => !testCore.state.olderLoading);
    await page.evaluate(id => testUi.focusMainEvent(`${id}:551`), fixture.source);
    await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('保留合成草稿🙂');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const anchor = await page.evaluate(() => {
      const box = document.getElementById('chat-scroll').getBoundingClientRect();
      const row = [...document.querySelectorAll('#transcript > [data-event-id]')].find(row => row.getBoundingClientRect().bottom > box.top && row.getBoundingClientRect().top < box.bottom);
      return { key: row.dataset.eventId, offset: row.getBoundingClientRect().top - box.top };
    });
    await page.keyboard.press('Control+n');
    await page.waitForFunction(() => testCore.state.newConversation);
    await page.evaluate(() => { testCore.chooseSidebarMode('work'); WeftDesktop.toggleRail(false); });
    if (profiling) await cdp.send('Profiler.start');
    samples.push({ width:900, ...await measureUi(page, 'switch-held-conversation', () => page.locator(`.session-row[data-session-id="${fixture.source}"] > button`).first().click(), { kind:'conversation-anchor', id:fixture.source, ...anchor }) });
    if (profiling) { const {profile} = await cdp.send('Profiler.stop'); await writeFile(join(out,'cpu-held.json'),JSON.stringify(profile)); }
    await page.waitForFunction(expected => {
      const row = [...document.querySelectorAll('#transcript > [data-event-id]')].find(row => row.dataset.eventId === expected.key);
      return row && Math.abs(row.getBoundingClientRect().top - document.getElementById('chat-scroll').getBoundingClientRect().top - expected.offset) < 2;
    }, anchor);
    assert.equal(await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(), '保留合成草稿🙂');
    assert.ok(await page.locator('#transcript > li').count() < 60, 'Hundreds of loaded messages stay virtual');
    // The same live row receives deltas; switching away and back reads the
    // completed response, including a correction made while it was hidden.
    let live = [], liveRevision = 0;
    const read = fixture.backend.readEvents;
    fixture.backend.readEvents = async input => ({ ...await read(input), liveEvents: input.sessionId === fixture.source ? live : [], liveSeq: liveRevision });
    put('turn.started', { turn: 151 }); put('user.message', { text: '合成流式问题', receiptId: 'synthetic-stream', turn: 151 });
    const liveSeq = history.length;
    live = [{ seq: liveSeq, type: 'assistant.delta', sessionId: fixture.source, at: new Date().toISOString(), data: { text: '合成流式第一段', streaming: true, turn: 151 } }];
    await page.locator('#jump-latest').click();
    await page.evaluate(() => testCore.refreshHistory());
    await page.getByText('合成流式第一段', { exact: true }).waitFor();
    await page.evaluate(() => { globalThis.firstLiveRow = [...document.querySelectorAll('.message.assistant')].find(row => row.textContent.includes('合成流式第一段')); });
    live[0] = { ...live[0], data: { ...live[0].data, text: '合成流式第一段，第二段' } }; liveRevision++;
    await page.evaluate(() => testCore.refreshHistory());
    await page.getByText('合成流式第一段，第二段', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => firstLiveRow.isConnected && firstLiveRow.textContent.includes('第二段')), true, 'A delta reuses the mounted row');
    await page.keyboard.press('Control+n');
    await page.waitForFunction(() => testCore.state.newConversation);
    live = []; liveRevision++;
    put('assistant.message', { text: '合成最终回复，已更正。', turn: 151, streamSeq: liveSeq }); put('turn.ended', { turn: 151, reason: 'completed' });
    // Native relay history can omit a timestamp; its sequence still orders it.
    delete history.at(-2).at;
    await page.evaluate(id => testCore.selectSession(id), fixture.source);
    await page.getByText('合成最终回复，已更正。', { exact: true }).waitFor();
    assert.equal(await page.getByText('合成流式第一段，第二段', { exact: true }).count(), 0);
    await writeFile(join(out, 'behavior.json'), JSON.stringify({ anchorRestored: true, draftRestored: true, loadedHundreds: true, streamRowReused: true, hiddenCompletionRead: true, undatedNativeMessageRead:true }, null, 2));
    assert.equal(samples.reduce((n, row) => n + row.longTaskCount, 0), 0, 'Switching must not cause long tasks');
    assert.ok(samples.every(row => row.frameP95Ms <= 16.81), 'Switching frame p95 <=16.8ms');
  }
  assert.deepEqual(errors, []);
  await writeFile(join(out, 'smoothness.json'), JSON.stringify({ complete:true, samples, mounted, syntheticMessages:300, syntheticEvents:history.length }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
    console.error(JSON.stringify(await page.evaluate(() => ({ errors: [], selected: testCore.state.selectedSessionId, events: testCore.state.historyEvents.size,
      rows:[...document.querySelectorAll('#transcript > [data-event-id]')].map(row=>({key:row.dataset.eventId,offset:row.getBoundingClientRect().top-document.getElementById('chat-scroll').getBoundingClientRect().top})), text: document.getElementById('transcript').innerText.slice(0,100), scroll: document.getElementById('chat-scroll').scrollTop })).catch(() => ({}))));
  }
  console.error('Page errors:', errors);
  throw error;
} finally {
  clearTimeout(watchdog);
  if (app) { try { await Promise.race([app.close(), new Promise((_, reject) => setTimeout(() => reject(Error('close timeout')), 7000))]); } catch { kill(); } }
  await fixture?.close(); if (lock) await unlink(lock);
}

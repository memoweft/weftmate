// Production Windows shell, independent identity, synthetic host; no model calls.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';

for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });
const repo = resolve(import.meta.dirname, '../..');
const profile = await mkdtemp(join(tmpdir(), 'weftmate-design-base-'));
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(profile, 'fixtures');
const output = process.env.WEFTMATE_DESIGN_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const bootstrap = join(profile, 'design-base-shell.mjs');
await writeFile(bootstrap, `import {createRequire} from 'node:module';
const {app}=createRequire(${JSON.stringify(new URL('../../package.json', import.meta.url).href)})('electron');
app.setName('WeftMate Design Base Test');app.setAppUserModelId('com.memoweft.weftmate.test.designbase');
app.disableHardwareAcceleration();
for(const stream of [process.stdout,process.stderr])stream.on('error',error=>{if(error.code!=='EPIPE')throw error});
await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs', import.meta.url).href)});`);
let app, fixture, child;
const errors = [];
const killTree = () => { if (child?.exitCode === null) {
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGKILL');
} };
const deadline = setTimeout(() => { killTree(); process.exitCode = 1; }, 155000);
try {
  fixture = await startFixture();
  for (const events of fixture.logs.values()) for (const event of events) {
    if (event.type === 'user.message') event.data.text = '把今天的想法整理成一份简短清单。';
    if (event.type === 'assistant.message') event.data.text = '**今天的清单**\n\n先把想法写下来，再挑出最值得做的一件事。\n\n- 整理已有资料\n- 留出专注时间\n- 晚上回顾进展';
    if (event.type === 'step.completed') event.data.summary = '整理合成资料';
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken, REVIEW_THEME: 'light', REVIEW_HIDDEN: '1', WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repo,
    args: [bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'], env, timeout: 30000 });
  child = app.process();
  const page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await feedbackUiSession(page, fixture, { native: true });
  await page.evaluate(async id => { await __feedbackSessionCore.selectSession(id); WeftReplyMotion.setVisibility(false); }, fixture.source);
  await page.locator('#transcript .message.user,#transcript .main-chat-row').first().waitFor();
  const capture = async name => { if (output) {
    await page.mouse.move(1100, 750);
    await page.evaluate(async () => {
      for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect.getTiming().iterations)) animation.finish();
      await document.fonts.ready;
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    });
    const png = await app.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
    await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'));
  } };
  await capture('chat-light');
  const repeat = await page.evaluate(async id => {
    const transcript = document.getElementById('transcript'), row = transcript.querySelector('.message.user,.main-chat-row');
    if (!row) throw Error('Synthetic user message must be visible');
    const children = [...transcript.children], requests = [], animations = transcript.getAnimations({ subtree: true });
    const fetch = window.fetch; window.fetch = (...args) => { requests.push(String(args[0])); return fetch(...args); };
    const generation = __feedbackSessionCore.state.historyGeneration;
    await __feedbackSessionCore.selectSession(id);
    window.fetch = fetch;
    return { same: children.every((child, index) => transcript.children[index] === child), connected: row.isConnected,
      sameGeneration: generation === __feedbackSessionCore.state.historyGeneration, requests,
      newAnimations: transcript.getAnimations({ subtree: true }).filter(animation => !animations.includes(animation)).length };
  }, fixture.source);
  assert.equal(repeat.same, true, 'reselecting the active conversation must preserve message nodes');
  assert.equal(repeat.connected, true); assert.equal(repeat.sameGeneration, true);
  assert.equal(repeat.newAnimations, 0); assert.deepEqual(repeat.requests, []);
  // Drive the sidebar itself: running user/progress rows keep their identity too.
  const completedEvents = fixture.logs.get(fixture.source).slice();
  const nextSeq = (completedEvents.at(-1)?.seq ?? -1) + 1;
  fixture.logs.get(fixture.source).push({seq:nextSeq,type:'turn.started',at:new Date().toISOString(),data:{turn:2}},
    {seq:nextSeq+1,type:'step.started',at:new Date().toISOString(),data:{turn:2,stepId:'design-running',toolName:'read',state:'running',summary:'正在整理合成资料'}});
  await page.evaluate(async () => {
    const core = __feedbackSessionCore; await core.refreshHistory();
  });
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    globalThis.designRows = [...document.getElementById('transcript').children];
    globalThis.designAnimations = document.getElementById('transcript').getAnimations({ subtree: true });
  });
  const active = page.locator(`.session-row[data-session-id="${fixture.source}"] > button`).first();
  await active.click(); await active.click();
  assert.equal(await page.evaluate(() => designRows.every((node, index) => document.getElementById('transcript').children[index] === node)), true);
  assert.equal(await page.evaluate(() => __feedbackSessionCore.state.turnStatus), 'running');
  assert.equal(await page.evaluate(() => document.getElementById('transcript').getAnimations({subtree:true}).some(animation => !designAnimations.includes(animation))), false);
  fixture.logs.set(fixture.source,completedEvents);
  await page.evaluate(async () => { await __feedbackSessionCore.refreshHistory(true); });
  // Delay a real history response: the shell stays, content uses a skeleton.
  let command = (await fixture.request('/commands', { requestId: 'design-second', kind: 'session.create', targetDeviceId: fixture.hostId, modelProfileId: 'synthetic' })).command;
  while (['pending', 'dispatching', 'preflight'].includes(command.state)) command = (await fixture.request('/commands/' + command.commandId)).command;
  assert.equal(command.state, 'accepted_by_dsh');
  const second = command.sessionId;
  fixture.logs.set(second, fixture.logs.get(fixture.source).map(event => ({ ...event, sessionId: second })));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route(`**/sessions/${second}/events?*`, async route => { await held; await route.continue(); });
  await page.evaluate(async id => {
    await __feedbackSessionCore.refreshSessions();
    globalThis.designShell = ['assistant-view','conversation-pane','transcript','message-form'].map(id => document.getElementById(id));
    void __feedbackSessionCore.selectSession(id);
  }, second);
  await page.locator('#transcript > .wm-skeleton').waitFor();
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  assert.equal(await page.locator('#transcript').getAttribute('aria-busy'), 'true');
  await capture('loading-light');
  release();
  await page.locator('#transcript > .wm-skeleton').waitFor({ state: 'detached' });
  await page.locator('#transcript .message.user').waitFor();
  assert.equal(await page.evaluate(() => designShell.every(node => document.getElementById(node.id) === node)), true);
  await page.unroute(`**/sessions/${second}/events?*`);
  await page.evaluate(async id => { await __feedbackSessionCore.selectSession(id); }, fixture.source);
  await page.waitForFunction(() => !__feedbackSessionCore.state.sessionSelecting);
  await page.locator('#transcript .message.user').waitFor();
  assert.match(await page.locator('#transcript').innerText(), /把今天的想法整理成一份简短清单/);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(() => { __feedbackSessionCore.show('assistant'); document.dispatchEvent(new CustomEvent('weftmate:fixed-page',{detail:'conversation'})); });
    await page.evaluate(theme => { WeftDesktop.setAppearance({ theme }); WeftReplyMotion.setVisibility(false); }, theme);
    await capture('chat-' + theme);
    for (const view of ['activity', 'goals', 'library', 'health']) {
      await page.locator('.' + view + '-entry').evaluate(button => button.click());
      const surface = page.getByRole('region', { name: {activity:'动态',goals:'目标',library:'成果库',health:'健康'}[view], exact:true });
      await surface.waitFor({ state: 'visible' });
      await page.waitForFunction(view => {
        const core = __feedbackSessionCore, model = core[view === 'goals' ? 'goalsPage' : view];
        return Object.entries(model || {}).every(([key,value]) => !/loading$/i.test(key) || !value);
      }, view);
      const repeatedPage = await surface.evaluate((surface, view) => {
        const core = __feedbackSessionCore, method = 'read' + view[0].toUpperCase() + view.slice(1), read = core[method];
        let reads = 0; core[method] = (...args) => { reads++; return read(...args); };
        const children = [...surface.children];
        document.querySelector('.' + view + '-entry').click(); core[method] = read;
        return {same:children.every((node,index)=>surface.children[index]===node),reads};
      }, view);
      assert.deepEqual(repeatedPage,{same:true,reads:0},`${view}: same page keeps nodes and makes no read`);
      assert.equal(await page.locator('#conversation-pane').isVisible(), false, 'fixed page never reveals chat behind it');
    }
    await page.evaluate(() => WeftSettingsNavigation.open('general'));
    await page.locator('#settings-dialog').waitFor({ state: 'visible' });
    await page.evaluate(() => { globalThis.designSettings = [...document.querySelector('.settings-category[data-category="general"]').children]; });
    await page.locator('.settings-nav-item[data-category="general"]').click();
    assert.equal(await page.evaluate(() => designSettings.every((node,index) => document.querySelector('.settings-category[data-category="general"]').children[index] === node)), true);
    await capture('settings-' + theme);
    await page.evaluate(() => __feedbackSessionCore.show('assistant'));
  }
  const controls = await page.evaluate(async () => {
    const C = WeftControls, target = C.node('section'); document.body.append(target);
    const text = C.input({label:'合成输入'}), multiline = C.input({label:'合成多行',multiline:true});
    const source = C.node('select'); source.setAttribute('aria-label','合成选择');
    for (const name of ['一','二','三']) { const option = C.node('option','',name); option.value = name; source.append(option); }
    target.append(source); const segmented = C.segmented(source); let changes = 0;
    source.addEventListener('change',()=>changes++); segmented.children[1].click(); segmented.children[1].click();
    const toggle = C.input({label:'合成开关',type:'checkbox'}); C.toggle(toggle); toggle.click();
    const group = C.group('合成分组',[C.row('标题','说明',text),C.row('多行','',multiline),C.row('开关','',toggle)]);
    target.append(group,C.tag('标签'));
    const first = C.loading(target); const second = C.loading(target); const stale = first(); const fresh = second();
    const dialog = C.dialog({title:'合成对话框',content:group}); dialog.openPanel(); const modal = dialog.matches(':modal'); dialog.close(); dialog.remove();
    const drawer = C.drawer({title:'合成侧栏'}); drawer.openPanel(); const sheet = drawer.matches(':modal'); drawer.close(); drawer.remove();
    target.remove();
    return {changes,selected:source.value,checked:toggle.checked,stale,fresh,modal,sheet};
  });
  assert.deepEqual(controls,{changes:1,selected:'二',checked:true,stale:false,fresh:true,modal:true,sheet:true});
  // Restore real capabilities and exercise the logical history path used today.
  await page.unroute('**/personal/v1/status');
  await page.evaluate(async () => {
    await __feedbackSessionCore.refreshStatus(); await __feedbackSessionCore.refreshSessions();
    if (__feedbackSessionCore.state.personalCapabilities.chats !== 1) throw Error('Logical history must be enabled');
    await __feedbackSessionCore.selectMainChat();
  });
  const mainChat = await page.evaluate(() => __feedbackSessionCore.state.mainChat.chatId);
  let mainCommand = (await fixture.request('/commands', { requestId: 'design-main-message', kind: 'chat.message', chatId: mainChat, targetDeviceId: fixture.hostId, modelProfileId: 'synthetic', text: '合成逻辑对话' })).command;
  while (['pending','dispatching','preflight'].includes(mainCommand.state)) mainCommand = (await fixture.request('/commands/' + mainCommand.commandId)).command;
  assert.equal(mainCommand.state,'accepted_by_dsh');
  await page.evaluate(async () => { await __feedbackSessionCore.refreshSessions(); await __feedbackSessionCore.refreshHistory(); });
  await page.locator('#transcript .main-chat-row').first().waitFor();
  const logicalRepeat = await page.evaluate(async () => {
    const core = __feedbackSessionCore, transcript = document.getElementById('transcript'), children = [...transcript.children], generation = core.state.historyGeneration;
    let reads = 0; const read = core.readChatEvents; core.readChatEvents = (...args) => { reads++; return read(...args); };
    await core.selectMainChat(); await core.selectSession(core.state.selectedSessionId); core.readChatEvents = read;
    return {same:children.every((node,index)=>transcript.children[index]===node),sameGeneration:generation===core.state.historyGeneration,reads};
  });
  assert.deepEqual(logicalRepeat,{same:true,sameGeneration:true,reads:0});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(() => { const node = WeftControls.skeleton(); document.body.append(node); const animation = getComputedStyle(node.querySelector('span')).animationName; node.remove(); return animation; }), 'none');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(window=>window.isVisible())),false);
  assert.deepEqual(errors, []);
  console.log('PASS active conversation/pages keep nodes; delayed history skeleton; shared controls; both themes; reduced motion; hidden production desktop');
} catch (error) {
  if (errors.length) console.error('Renderer errors:', JSON.stringify(errors));
  throw error;
} finally {
  clearTimeout(deadline);
  if (app) { const closing = app.close(); await Promise.race([closing.catch(() => {}), new Promise(resolve => setTimeout(resolve, 4000))]); killTree(); }
  await fixture?.close();
  await rm(profile, { recursive: true, force: true });
}

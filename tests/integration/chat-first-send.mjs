import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, open, unlink, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startFixture } from './ux-4-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { evidencePath } from '../helpers/evidence-path.mjs';

const root = resolve(import.meta.dirname, '../..');
const parent = process.env.WEFTMATE_FIRST_SEND_OUTPUT || evidencePath('chat-first-send');
await mkdir(parent, { recursive: true });
const out = await mkdtemp(join(parent, 'run-'));
const before = process.argv.includes('--before'), record = process.env.WEFTMATE_FIRST_SEND_RECORD !== '0';
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT ??= join(out, 'fixtures');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { before, ci: process.env.CI === 'true', inheritedTempScope: !!process.env.WEFTMATE_TEST_TEMP_SCOPE,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), checks: [], scenarios: [] }, timers = new Set();
let app, fixture, lock, cdp, recording, writes = [];
const check = (name, value) => { report.checks.push({ name, value }); };
const later = (ms, fn) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); };
try {
  if (process.env.WEFTMATE_HEAVY_LOCK_DIR) {
    for (let n = 1; n <= 3; n++) {
      const path = join(process.env.WEFTMATE_HEAVY_LOCK_DIR, `heavy-${n}.lock`);
      try { const file = await open(path, 'wx'); await file.writeFile(`CHAT-FIRST-SEND ${new Date().toISOString()}`); await file.close(); lock = path; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    assert.ok(lock, 'No heavy slot');
  }
  fixture = await startFixture();
  const create = fixture.backend.createSession, describe = fixture.backend.describeSession, read = fixture.backend.readEvents;
  const running = new Set(), live = new Map(), watermarks = new Map(), waiters = new Set();
  const wake = (sessionId, seq) => { watermarks.set(sessionId, seq); for (const row of waiters) if (row.sessionId === sessionId && seq > row.seq) row.resolve(); };
  let scenario;
  fixture.backend.createSession = async input => {
    scenario.creates++; scenario.stages.push({ name: 'create-start', at: Date.now() });
    await pause(scenario.timing?.create ?? 350); const result = await create(input); watermarks.set(input.sessionId, -1);
    scenario.stages.push({ name: 'create-accepted', at: Date.now() }); return result;
  };
  fixture.backend.describeSession = async id => ({ ...await describe(id), running: running.has(id) });
  fixture.backend.readEvents = async input => {
    if (input.sessionId !== fixture.source && !(fixture.logs.get(input.sessionId)?.length)) await pause(scenario?.timing?.emptyRead ?? 160);
    const page = await read(input), seq = Math.max(page.nextSeq, watermarks.get(input.sessionId) ?? -1);
    return { ...page, nextSeq: seq, liveEvents: live.has(input.sessionId) ? [live.get(input.sessionId)] : [], liveSeq: seq };
  };
  fixture.backend.waitForEvents = async ({sessionId,seq,timeoutMs,signal}) => {
    let release; const pending = new Promise(resolve => { release = resolve; }), row = {sessionId,seq,resolve:release};
    const abort=()=>release(), timer=setTimeout(release,timeoutMs); waiters.add(row);signal?.addEventListener('abort',abort,{once:true});
    try {if(signal?.aborted||(watermarks.get(sessionId)??fixture.logs.get(sessionId)?.at(-1)?.seq??-1)>seq)return;await pending;}
    finally{clearTimeout(timer);waiters.delete(row);signal?.removeEventListener('abort',abort);}
  };
  fixture.backend.sendMessage = async input => {
    scenario.sends++; const current = scenario, sessionId = input.sessionId;
    current.stages.push({ name: 'send-start', at: Date.now() });
    const list = fixture.logs.get(sessionId), receiptId = `synthetic-first-${current.sends}`;
    const append = (seq,type,data) => {list.push({seq,type,data,at:new Date().toISOString(),sessionId});wake(sessionId,seq);};
    if (current.fail) {await pause(250);return { accepted: false, rejected: true, errorCode: 'IMAGE_REJECTED', imageReasonCode: 'UNSUPPORTED_FORMAT' };}
    const timing=current.timing||{native:250,thinking:220,text:650,end:1000,accept:700};
    later(timing.native,()=>{
      running.add(sessionId);append(0,'turn.started',{turn:1});append(1,'user.message',{text:input.text,receiptId,turn:1});current.stages.push({name:'user-event',at:Date.now()});
      later(timing.thinking,()=>{live.set(sessionId,{seq:2,type:'assistant.delta',at:new Date().toISOString(),sessionId,
        data:{text:'',modelThinking:'先理解问候，再简洁回答。',thinkingActive:true,streaming:true,turn:1}});wake(sessionId,10);current.stages.push({name:'thinking',at:Date.now()});});
      later(timing.text,()=>{live.set(sessionId,{...live.get(sessionId),data:{text:'你好！这是合成的第一段回答。',modelThinking:'先理解问候，再简洁回答。',thinkingActive:false,streaming:true,turn:1}});wake(sessionId,20);current.stages.push({name:'first-text',at:Date.now()});});
      later(timing.end,()=>{live.delete(sessionId);append(21,'assistant.message',{text:'你好！这是合成的第一段回答。',streamSeq:2,turn:1});append(22,'turn.ended',{turn:1,reason:'completed'});running.delete(sessionId);current.stages.push({name:'completed',at:Date.now()});});
    });
    await pause(timing.accept); current.stages.push({ name: 'send-accepted', at: Date.now() });
    return { accepted: true, receiptId };
  };
  const env = { ...process.env, REVIEW_PROFILE: join(out, 'profile'), REVIEW_ORIGIN: fixture.origin, REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root,
    args: ['tests/helpers/chat-first-send-electron.mjs'], env, timeout: 30000 });
  app.process().stdout?.resume(); app.process().stderr?.resume();
  const page = await app.firstWindow(), errors = [];
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/personal/v1/ui/app.js', async route => route.fulfill({ contentType: 'text/javascript',
    body: (await readFile(join(root, 'src/personal-access-ui/app.js'), 'utf8')).replace('ui.loadAttachmentHasher =', 'globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =') }));
  if (before) {
    const baseline = process.env.WEFTMATE_FIRST_SEND_BASE || execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
    report.baseline = baseline;
    for (const file of execFileSync('git', ['diff', '--name-only', baseline, '--', 'src/personal-access-ui', 'src/ui-core'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)) {
      const asset = file.replace('src/personal-access-ui/', '').replace('src/ui-core/', 'ui-core/');
      await page.route(`**/personal/v1/ui/${asset}`, route => route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' }) }));
    }
  }
  await page.waitForURL('**/personal/v1/ui');
  await localUiSession(page, fixture.credentials, 'FIRST-SEND synthetic', { mainChat: true });
  await page.waitForFunction(() => globalThis.__WeftUiStarted && testCore.state.sessions.length > 0);
  if (record) {
    cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', frame => {
      const target = recording;
      if (target) {
        const index = target.frames.length;
        target.frames.push({ index, metadata: frame.metadata });
        writes.push(writeFile(join(out, target.name, `${String(index).padStart(5, '0')}.jpg`), Buffer.from(frame.data, 'base64')));
      }
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    });
  }
  async function capture(name, action, finish) {
    const target = { name, frames: [] }; await mkdir(join(out, name), { recursive: true });
    recording = target;
    if (cdp) await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
    await page.evaluate(() => {
      const ids = new WeakMap(); let next = 0;
      const id = node => node ? ids.get(node) || (ids.set(node, ++next), next) : null;
      const rect = node => node?.getBoundingClientRect().toJSON();
      globalThis.firstSendFrames = [];
      const tick = () => {
        const intro = document.getElementById('chat-intro'), style = getComputedStyle(intro);
        const users = [...document.querySelectorAll('#transcript .message.user')];
        firstSendFrames.push({ at: performance.now(), epoch: Date.now(), fresh: testCore.state.newConversation,
          session: testCore.state.selectedSessionId, selecting: testCore.state.sessionSelecting, submitting: testCore.state.submitting,
          intro: { hidden: intro.hidden, opacity: Number(style.opacity), visibility: style.visibility, text: intro.textContent, rect: rect(intro) },
          form: rect(document.getElementById('message-form')), draft: document.getElementById('message-text').value,
          operation: { text: document.getElementById('operation-status').textContent, hidden: document.getElementById('operation-status').hidden,
            rect:rect(document.getElementById('operation-status')),reviewRect:rect(document.getElementById('reset-operation')) },
          timelineTime: document.timeline.currentTime, generation: testCore.state.historyGeneration, afterSeq: testCore.state.afterSeq,
          native: [...testCore.state.historyEvents.values()].map(event => ({ seq: event.seq, type: event.type, turn: event.data?.turn, live: event.data?.live })),
          users: users.map(node => ({ id: id(node), bodyId: id(node.querySelector('.message-text')), bubbleId: id(node.querySelector('.message-user-bubble')),
            rect: rect(node), body: rect(node.querySelector('.message-text')), opacity: getComputedStyle(node).opacity, text: node.textContent,
            key: node.dataset.eventId || node.dataset.messageKey, transform: getComputedStyle(node).transform,
            animations: node.getAnimations({ subtree: true }).map(animation => ({ pending: animation.pending, playState: animation.playState,
              currentTime: animation.currentTime, startTime: animation.startTime, target: animation.effect?.target?.className,
              progress: animation.effect?.getComputedTiming().progress, localTime: animation.effect?.getComputedTiming().localTime })) })),
          skeleton: !!document.querySelector('#transcript .wm-skeleton'), status: document.getElementById('timeline-status').textContent,
          transcript: document.getElementById('transcript').textContent });
        globalThis.firstSendFrame = requestAnimationFrame(tick);
      }; tick();
    });
    let actionError;
    try { await page.waitForTimeout(120); await action(); await finish(); await page.waitForTimeout(300); }
    catch (error) { actionError = error; }
    const frames = await page.evaluate(() => { cancelAnimationFrame(firstSendFrame); return firstSendFrames; });
    if (cdp) await cdp.send('Page.stopScreencast'); recording = null; await Promise.all(writes); writes = [];
    await writeFile(join(out, name, 'frames.json'), JSON.stringify(frames));
    await writeFile(join(out, name, 'screencast.json'), JSON.stringify(target.frames));
    await page.screenshot({ path: join(out, name, 'final.png') });
    const first = frames.findIndex(frame => frame.users.length), active = frames.slice(first);
    const summary = { name, samples: frames.length, videoFrames: target.frames.length, ...scenario,
      nodes: [...new Set(active.flatMap(frame => frame.users.map(user => user.id)))],
      bodies: [...new Set(active.flatMap(frame => frame.users.map(user => user.bodyId)))],
      missing: active.filter(frame => frame.users.length === 0).length,
      duplicates: active.filter(frame => frame.users.length > 1).length,
      skeletons: active.filter(frame => frame.skeleton).length,
      introRestarts: active.filter((frame, index) => index > 0 && frame.intro.opacity > active[index - 1].intro.opacity + .01).length,
      userY: [...new Set(active.flatMap(frame => frame.users.map(user => Math.round(user.body.y))))],
      formY: [...new Set(frames.map(frame => Math.round(frame.form.y)))] };
    report.scenarios.push(summary);
    if (actionError) throw actionError;
    return { frames, active, summary };
  }
  async function welcome(name) {
    const geometry = await page.evaluate(() => ({ intro: document.getElementById('chat-intro').getBoundingClientRect().toJSON(),
      scroll: document.getElementById('chat-scroll').getBoundingClientRect().toJSON(),
      transcript: document.getElementById('transcript').getBoundingClientRect().toJSON(), form: document.getElementById('message-form').getBoundingClientRect().toJSON(),
      align: getComputedStyle(document.getElementById('chat-intro')).textAlign }));
    await page.screenshot({ path: join(out, `${name}.png`) });
    check(`${name}: welcome aligns with the content column`, Math.abs(geometry.intro.left - geometry.transcript.left) <= 1 && geometry.align === 'left');
    check(`${name}: welcome has a top inset`, geometry.intro.top - geometry.scroll.top >= 32 && geometry.intro.top - geometry.scroll.top <= 64);
    check(`${name}: welcome is separated from the composer`, geometry.form.top - geometry.intro.bottom >= 100);
    return geometry;
  }
  const timings = [
    {name:'usual',create:350,emptyRead:160,native:250,thinking:220,text:650,end:1000,accept:700},
    {name:'events-before-receipt',create:0,emptyRead:0,native:0,thinking:5,text:80,end:300,accept:450},
    {name:'receipt-before-events',create:0,emptyRead:0,native:500,thinking:250,text:550,end:800,accept:20},
  ];
  for (const theme of ['light', 'dark']) for (const timing of timings) {
    const name=`${theme}-${timing.name}`;
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; WeftReplyMotion.setPreference('full'); }, theme);
    await app.evaluate(({ nativeTheme }, theme) => nativeTheme.themeSource = theme, theme);
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await page.waitForFunction(() => testCore.state.newConversation && !testCore.state.selectedSessionId && !testCore.optimisticMessages().length);
    await page.waitForTimeout(350);
    check(`${name}: welcome starts visible`, await page.locator('#chat-intro').evaluate(node => getComputedStyle(node).opacity === '1'));
    if(timing.name==='usual'){
    await welcome(`${theme}-empty-chat`);
    await page.getByRole('tab', { name: '新对话：工作', exact: true }).click();
    await page.waitForTimeout(350); await welcome(`${theme}-empty-work`);
    check(`${theme}: work welcome uses the selected mode`, await page.locator('#chat-intro h1').innerText() === '让电脑帮你完成');
    await page.getByRole('tab', { name: '新对话：对话', exact: true }).click(); await page.waitForTimeout(350);
    }
    scenario = { creates: 0, sends: 0, stages: [], timing };
    await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('你好');
    const { frames, active, summary } = await capture(`${name}-first-send`, () => page.getByRole('button', { name: '发送', exact: true }).click(),
      () => page.waitForFunction(() => document.querySelector('#transcript').textContent.includes('你好！这是合成的第一段回答。') && testCore.state.turnStatus === 'completed' && !document.getElementById('message-text').value));
    const allY=active.flatMap(frame=>frame.users.map(user=>user.body.y));
    summary.allFrameDisplacement=Math.max(...allY)-Math.min(...allY);
    check(`${name}: first message stays in place from its first visible frame`,summary.allFrameDisplacement<=1);
    const visibleIntro=frames.filter(frame=>frame.intro.opacity>.01);
    check(`${name}: welcome copy stays stable while fading`,new Set(visibleIntro.map(frame=>frame.intro.text)).size<=1);
    check(`${name}: no bottom progress or reserved space`,frames.every(frame=>frame.operation.hidden && !frame.operation.text && frame.operation.rect.height===0 && frame.operation.reviewRect.height===0));
    check(`${theme}: created and sent exactly once`, summary.creates === 1 && summary.sends === 1);
    check(`${theme}: message never vanishes`, summary.missing === 0);
    check(`${theme}: exactly one user message in every frame`, summary.duplicates === 0);
    check(`${theme}: user node survives session binding`, summary.nodes.length === 1);
    check(`${theme}: user body survives acceptance`, summary.bodies.length === 1);
    check(`${theme}: send entrance never flashes back`, active.every((frame, index) => index === 0 || !frame.users.length || !active[index - 1].users.length || Number(frame.users[0].opacity) + .01 >= Number(active[index - 1].users[0].opacity)));
    check(`${theme}: no loading replacement`, summary.skeletons === 0);
    check(`${theme}: welcome only fades out`, summary.introRestarts === 0);
    check(`${theme}: welcome exits`, active.at(-1).intro.opacity === 0);
    check(`${theme}: composer fixed in every frame`, summary.formY.length === 1);
    const settled = active.filter(frame => frame.users.length === 1 && frame.users[0].transform === 'none');
    check(`${theme}: user text does not reflow on binding`, Math.max(...settled.map(frame => frame.users[0].body.y)) - Math.min(...settled.map(frame => frame.users[0].body.y)) <= 1);
    check(`${theme}: user text does not shift sideways`, Math.max(...active.flatMap(frame => frame.users.map(user => user.body.x))) - Math.min(...active.flatMap(frame => frame.users.map(user => user.body.x))) <= 1);
    check(`${theme}: draft clears after acceptance`, active.at(-1).draft === '' && !active.at(-1).transcript.includes('发送中'));
  }
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 700));
  await page.waitForTimeout(350); await welcome('narrow-empty-chat');
  await page.getByRole('tab', { name: '新对话：工作', exact: true }).click();
  await page.waitForTimeout(350); await welcome('narrow-empty-work');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await page.waitForFunction(() => testCore.state.newConversation && !testCore.state.selectedSessionId);
  scenario = { creates: 0, sends: 0, stages: [], fail: true };
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('失败后保留的合成草稿');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => testCore.optimisticMessages().some(row => row.status === 'failed'));
  check('failure retains the draft', await page.locator('#message-text').inputValue() === '失败后保留的合成草稿');
  check('failure offers retry', await page.getByRole('button', { name: '检查状态', exact: true }).isVisible());
  check('real failure remains visible above the composer', await page.locator('#operation-status').isVisible() && !!await page.locator('#operation-status').textContent());
  await page.screenshot({path:join(out,'failure-feedback.png')});
  scenario.fail = false;
  await page.getByRole('button', { name: '检查状态', exact: true }).click();
  await page.waitForFunction(() => testCore.state.turnStatus === 'completed');
  check('retry reuses the created session', scenario.creates === 1);
  check('retry sends once after the failed attempt', scenario.sends === 2);
  check('successful retry clears the resolved notice without a slot', await page.locator('#operation-status').evaluate(node=>node.hidden && !node.textContent && node.getBoundingClientRect().height===0));
  await page.screenshot({path:join(out,'retry-completed.png')});
  check('no renderer errors', errors.length === 0); report.errors = errors;
  if (!before) assert.deepEqual(report.checks.filter(check => !check.value), [], 'First-send invariants');
} catch (error) {
  report.error = error.stack;
  if (app) { const page = await app.firstWindow(); await page.screenshot({ path: join(out, 'failure.png') }); await writeFile(join(out, 'failure.txt'), await page.locator('body').innerText()); }
  throw error;
} finally {
  if (cdp && recording) await cdp.send('Page.stopScreencast').catch(() => {});
  await Promise.all(writes); for (const timer of timers) clearTimeout(timer);
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close(); await fixture?.close(); if (lock) await unlink(lock);
}
console.log(JSON.stringify(report));

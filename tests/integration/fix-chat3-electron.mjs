// Production desktop shell, isolated personal host and synthetic history only.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync,execFileSync } from 'node:child_process';
import { startFixture } from './ux-4-fixture.mjs';
import { feedbackUiSession } from '../helpers/feedback-ui-session.mjs';

const repo = resolve(import.meta.dirname, '../..');
const profile = await mkdtemp(join(tmpdir(), 'weftmate-fix-chat3-'));
// Keep the shared fixture helper's managed-temp scan inside this test profile.
process.env.WEFTMATE_MANAGED_TEMP_ROOT = join(profile, 'fixtures');
const out = process.env.WEFTMATE_CHAT3_OUTPUT;
assert.ok(out, 'screenshot output must be outside the repository');
await mkdir(out, { recursive: true });
const bootstrap = join(profile, 'fix-chat3-shell.mjs');
await writeFile(bootstrap, `import {createRequire} from 'node:module';\nconst {app}=createRequire(${JSON.stringify(new URL('../../package.json', import.meta.url).href)})('electron');\napp.setAppUserModelId('com.memoweft.weftmate.test.fixchat3');\nawait import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs', import.meta.url).href)});\n`);
let app, fixture;
const killTree = () => {
  const child = app?.process();
  if (child?.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
};
const deadline = setTimeout(() => { killTree(); process.exitCode = 1; }, 150000);
try {
  fixture = await startFixture();
  const main=(await fixture.request('/chats/main')).chat;
  let mainCommand=(await fixture.request('/commands',{requestId:'chat3-main',kind:'chat.message',chatId:main.chatId,targetDeviceId:fixture.hostId,modelProfileId:'synthetic',text:'合成天气查询'})).command;
  while(['pending','dispatching','preflight'].includes(mainCommand.state))mainCommand=(await fixture.request('/commands/'+mainCommand.commandId)).command;
  assert.equal(mainCommand.state,'accepted_by_dsh');fixture.source=mainCommand.sessionId;
  const describe=fixture.backend.describeSession;
  fixture.backend.describeSession=async id=>({...await describe(id),running:fixture.logs.get(id)?.findLast(e=>e.type==='turn.started'||e.type==='turn.ended')?.type==='turn.started',processing:{phase:'answering'}});
  const executed=[];
  fixture.backend.listSlashCommands=async()=>({items:[{name:'compact',description:'Compact history',kind:'command'},{name:'goal',description:'Set goal',kind:'command',input:{hint:'目标内容'}},{name:'review',description:'检查当前内容',kind:'skill'}]});
  fixture.backend.executeSlashCommand=async input=>{executed.push(input.line);return {commandId:'native-command',result:{kind:'success',text:'已执行'}}};
  const rows = fixture.logs.get(fixture.source);
  const at = new Date().toISOString();
  rows.splice(0, rows.length, ...[
    {type:'turn.started',data:{turn:1}},
    {type:'user.message',data:{text:'今天的天气怎么样？'}},
    {type:'assistant.message',data:{text:'',modelThinking:'The user wants the weather. Now fetch it.',thinkingActive:false,streamSeq:2}},
    {type:'step.completed',data:{taskId:'turn-1',stepId:'weather',toolName:'web_fetch',state:'completed',summary:'查询天气'}}
  ].map((e,seq)=>({...e,seq,at,sessionId:fixture.source})));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  Object.assign(env, { REVIEW_PROFILE: profile, REVIEW_ORIGIN: fixture.origin, REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken, REVIEW_THEME: 'light', REVIEW_HIDDEN: '1', WEFTMATE_TEST_HOST_NAME: 'synthetic-host' });
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repo, args: [bootstrap], env, timeout: 30000 });
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  const page = await app.firstWindow(); page.setDefaultTimeout(12000);
  if(process.env.WEFTMATE_CHAT3_BASELINE==='1') for(const file of ['components/main-chat.js','timeline.js','components/messages.js']) { const source=execFileSync('git',['show','HEAD:src/personal-access-ui/'+file],{cwd:repo,encoding:'utf8',windowsHide:true});await page.route('**/personal/v1/ui/'+file,route=>route.fulfill({body:source,contentType:'text/javascript'})); }
  const errors = []; page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.route('**/personal/v1/settings/usage', route => route.fulfill({ json: { timeZone: 'Asia/Shanghai' } }));
  await feedbackUiSession(page, fixture, { native: true });
  await page.evaluate(async id => { await globalThis.__feedbackSessionCore.selectSession(id); }, fixture.source);
  await page.unroute('**/personal/v1/status');
  await page.evaluate(async id=>{const core=__feedbackSessionCore;await core.refreshStatus();await core.refreshSessions();await core.selectMainChat();},fixture.source);
  await page.waitForFunction(()=>__feedbackSessionCore.inLogicalTimeline());
  await page.evaluate(()=>{const core=__feedbackSessionCore;core.currentTimelineChat().running=true;core.currentTimelineChat().processing={phase:'answering'};core.setMessageMode('queue')});
  await page.locator('#transcript .execution-block').waitFor();
  const waiting = await page.locator('#transcript').evaluate(list => [...list.querySelectorAll('.inline-waiting,.message.assistant')]
    .filter(row => !row.hidden && !row.closest('.execution-block')).map(row=>row.textContent).filter(Boolean));
  assert.deepEqual(waiting, [], 'no second status or empty answer outside the process disclosure');
  assert.equal(await page.locator('#transcript .execution-block').count(),1);
  const capture=async name=>{await page.mouse.move(1150,750);await page.waitForFunction(()=>[...document.querySelectorAll('details.execution-block')].every(d=>d.open || getComputedStyle(d,'::details-content').contentVisibility==='hidden'));await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect.getTiming().iterations))a.finish();await new Promise(requestAnimationFrame)});const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await writeFile(join(out,name+'.png'),Buffer.from(png,'base64'))};
  await capture('running-light');
  rows.splice(2,rows.length-2,...[
    {seq:2,type:'assistant.message',data:{text:'先查看天气。',modelThinking:'Now fetch the weather.',thinkingActive:false,streamSeq:2}},
    {seq:3,type:'step.completed',data:{taskId:'turn-1',stepId:'weather',toolName:'web_fetch',state:'completed',summary:'Fetch weather'}},
    {seq:4,type:'assistant.message',data:{text:'资料已找到，接着核对。'}},
    {seq:5,type:'step.completed',data:{taskId:'turn-1',stepId:'check',toolName:'read',state:'completed',summary:'Read details'}},
    {seq:6,type:'assistant.message',data:{text:'今天多云，气温 18–23°C，出门可以带件薄外套。\n\n来源：[合成天气站](https://weather.example/today)',memoryUsed:[{kind:'cognition',id:'synthetic-memory'}]}},
    {seq:7,type:'turn.ended',data:{turn:1,reason:'completed'}}
  ].map(e=>({...e,at,sessionId:fixture.source})));
  await page.evaluate(async()=>{const core=__feedbackSessionCore;core.currentTimelineChat().running=false;await core.refreshHistory(true);core.setMessageMode('queue')});
  await page.getByText('今天多云，气温 18–23°C，出门可以带件薄外套。',{exact:true}).waitFor();
  assert.equal(await page.locator('#transcript .execution-block').count(),1);
  assert.equal(await page.locator('#transcript .reply-memory').count(),0);
  assert.equal(await page.locator('#transcript .execution-block[open]').count(),0);
  assert.match(await page.locator('#transcript .execution-block > summary').innerText(),/处理了 \d+ 步 ·/);
  const positions=await page.evaluate(()=>({process:document.querySelector('#transcript .execution-block').getBoundingClientRect().top,answer:document.querySelector('#transcript .message.assistant').getBoundingClientRect().top}));
  assert.ok(positions.process<positions.answer);
  await page.locator('#transcript .execution-block > summary').click();
  await page.locator('#transcript .execution-note').first().waitFor({state:'visible'});
  assert.match(await page.locator('#transcript .execution-records').innerText(),/先查看天气/);
  assert.doesNotMatch(await page.locator('#transcript .execution-block > summary').innerText(),/Now fetch/);
  await capture('process-expanded-light');
  await page.locator('#transcript .execution-block > summary').click();
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
    await page.evaluate(()=>document.getElementById('chat-scroll').scrollTop=0);
    await capture('answer-'+theme);
    const field=page.locator('#message-text');await field.fill('/');
    await page.getByRole('menu',{name:'命令和技能'}).waitFor();
    await capture('commands-'+theme);
    await field.press('Escape');assert.equal(await page.getByRole('menu',{name:'命令和技能'}).count(),0);
  }
  const field=page.locator('#message-text');await field.fill('/comp');await page.getByRole('menuitem',{name:'/compact',exact:true}).waitFor();
  assert.equal(await page.getByRole('menuitem',{name:'/goal',exact:true}).count(),0);
  await field.press('Enter');await page.waitForFunction(()=>document.getElementById('message-text').value==='');
  assert.deepEqual(executed,['/compact']);
  await field.fill('/');await page.getByRole('menuitem',{name:'/goal',exact:true}).waitFor();await field.press('ArrowDown');await field.press('Enter');
  assert.equal(await field.inputValue(),'/goal ');
  await field.fill('/goal 整理今天的想法');await page.locator('#message-form').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>document.getElementById('message-text').value==='');assert.equal(executed.at(-1),'/goal 整理今天的想法');
  await field.fill('/review');await page.getByRole('menuitem',{name:'/review',exact:true}).waitFor();await field.press('Enter');assert.equal(await field.inputValue(),'/review ');
  // Source numbers are small links; their destinations refer to the actual footer entry.
  const citation=await page.evaluate(()=>{const body=WeftContent.create('结论有依据[1]。\n\n## 出处\n\n1. [合成资料](https://docs.example/one) · 今天 11:32 访问 · 一句话摘要。');document.getElementById('transcript').append(body);const a=body.querySelector('.render-citation');return {href:a.getAttribute('href'),target:!!body.querySelector(a.getAttribute('href')),compact:!!body.querySelector('.render-sources')}});
  assert.equal(citation.target,true);assert.equal(citation.compact,true);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
  if(errors.length)console.error(errors[0]);
  assert.equal(errors.length,0);
  await page.goto(fixture.mobileUrl);
  await page.waitForFunction(()=>state.booted && !!uiCore.state.mainChat);
  await page.evaluate(async()=>{await uiCore.selectMainChat()});
  const mobileField=page.locator('#draft');await mobileField.fill('/comp');
  await page.getByRole('menuitem',{name:'/compact',exact:true}).waitFor();
  const menuPosition=await page.evaluate(()=>({bottom:document.querySelector('.slash-command-menu').getBoundingClientRect().bottom,top:document.getElementById('draft').getBoundingClientRect().top}));
  assert.ok(menuPosition.bottom<=menuPosition.top);
  await mobileField.press('Enter');await page.waitForFunction(()=>document.getElementById('draft').value==='');
  assert.equal(executed.filter(line=>line==='/compact').length,2);
  await mobileField.fill('/goal 整理手机里的想法');await page.evaluate(()=>send());
  await page.waitForFunction(()=>document.getElementById('draft').value==='');
  assert.equal(executed.at(-1),'/goal 整理手机里的想法');
  assert.equal(errors.length,0);

  console.log('PASS: hidden production Electron; one process above answer, empty reply, light/dark, native command menu, keyboard, source links.');

} finally {
  clearTimeout(deadline); killTree();
  await app?.close().catch(error => { if (!/closed|EPIPE|Target/.test(error.message)) throw error; });
  await fixture?.close();
  await rm(profile, { recursive: true, force: true });
}

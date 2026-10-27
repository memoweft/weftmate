process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, lstat, unlink, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { phoneRuntime } from '../../services/cloud/test/relay-phone-runtime.mjs';
import { redactEvidenceText, cleanupOwnedProcesses } from '../helpers/process-evidence.mjs';
import { evidencePath } from '../helpers/evidence-path.mjs';

const repository = resolve(import.meta.dirname, '../..'), startedAt = Date.now();
const root = await mkdtemp(join(tmpdir(), 'weftmate-mode1-')), out = evidencePath('mode-1-fix');
await mkdir(out, { recursive: true });
const logs = [], report = { realElectron: true, realDsh: true, syntheticModel: true, checks: [], screenshots: [], errors: [], systemBarsVerified: false };
let host, runtime, secondHost, secondRuntime, app, browser, heavyLock, heavyLease, activePage, stage = 'start';
const textOf = m => typeof m.content === 'string' ? m.content : (m.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
function respond(body) {
  const index = body.messages.findLastIndex(m => m.role === 'user' && textOf(m).startsWith('MODE1_'));
  const text = index < 0 ? '' : textOf(body.messages[index]);
  if (!body.tools?.length) return { content: '合成对话' };
  if (!text.startsWith('MODE1_WRITE')) return { content: '合成回复：我在这里，可以继续聊。' };
  const calls = body.messages.slice(index + 1).flatMap(m => m.tool_calls || []);
  const step = calls.length;
  const name = step === 0 ? 'load_tools' : 'write';
  if (step > 1) return { content: '这件事已按你的选择处理。' };
  const filename = text.includes('NEW_WORK') ? `new-work-${text.includes('PHONE')?'phone':'desktop'}.txt` : text.includes('PHONE') ? 'phone.txt' : 'desktop.txt';
  const args = step === 0 ? { names: ['write'] } : { file_path: filename, content: 'MODE1_SYNTHETIC_FILE\n' };
  return { content: '', tool_calls: [{ id: `mode1-${createHash('sha256').update(text).digest('hex').slice(0, 10)}-${step}`,
    type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
}
async function until(read, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 150)); }
  throw Error('Timed out: ' + label);
}
async function unlinkTreeLinks(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) { const path = join(directory, item.name);
    if ((await lstat(path)).isSymbolicLink()) await unlink(path); else if (item.isDirectory()) await unlinkTreeLinks(path); }
}
function cleanEvidence(value) {
  if(typeof value==='string')return redactEvidenceText(value,[root]);
  if(Array.isArray(value))return value.map(cleanEvidence);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,cleanEvidence(item)]));
  return value;
}
async function capture(page, kind, state, open = null) {
  for (const theme of ['light', 'dark']) for (const viewport of kind === 'desktop' ? [{ width: 1200, height: 850 }, { width: 480, height: 850 }] : [{ width: 390, height: 844 }, { width: 360, height: 780 }]) {
    if (kind === 'desktop') await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), viewport);
    else await page.setViewportSize(viewport);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForTimeout(200);
    let openedRail = false;
    if (state.startsWith('sidebar') || state === 'original-history') {
      await page.evaluate(()=>WeftDesktop.toggleRail(false)); openedRail = viewport.width < 720;
    }
    if (open) await open(page);
    const file = `${kind}-${viewport.width}-${theme}-${state}.png`;
    if (kind === 'desktop') {
      const encoded = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
        const window = BrowserWindow.getAllWindows()[0], handle = window.getNativeWindowHandle(), id = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 } });
        const source = sources.find(row => row.id.split(':')[1] === id); if (!source || source.thumbnail.isEmpty()) throw Error('Owned native window capture unavailable');
        return source.thumbnail.toPNG().toString('base64');
      }); await writeFile(join(out, file), Buffer.from(encoded, 'base64'));
    } else await page.screenshot({ path: join(out, file) }); report.screenshots.push(file);
    if (open) await page.keyboard.press('Escape');
    if (openedRail) {
      if(kind==='phone')await page.evaluate(()=>mode1Effects.closeRail());
      else await page.locator('#rail-open').click();
    }
  }
  if (kind === 'desktop') await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width: 1200, height: 850 });
  else await page.setViewportSize({ width: 390, height: 844 });
}
try {
  for (const id of [1, 2, 3]) { const lock = `D:/AIProjects/WeftMate/Runtime/Orchestrator/heavy-${id}.lock`;
    try { const handle = await open(lock, 'wx'); heavyLease=`MODE-1 ${new Date().toISOString()} real Electron and phone`;await handle.writeFile(heavyLease); await handle.close(); heavyLock = lock; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; } }
  if (!heavyLock) throw Error('All heavy slots occupied; retry after independent work');
  runtime = await phoneRuntime(root, logs, { respond });
  host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend, uiHandler: servePersonalAccessUi });
  runtime.setHost(host); await runtime.start(); const started = await host.start();
  const grant = await host.issueSetupGrant();
  const setup = await fetch(started.origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin: started.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'SyntheticMODE1', password: 'Synthetic mode one password', deviceName: 'synthetic-phone' }) });
  assert.equal(setup.status, 201); const auth = await setup.json(), cookie = setup.headers.get('set-cookie').split(';')[0];
  async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(started.origin + '/personal/v1' + path, { method, headers: { origin: started.origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify({ path, status: response.status, error: value.error })); return value;
  }
  const work = join(root, 'SyntheticWork'); await mkdir(work);
  const project = (await api('/projects', { requestId: randomUUID(), name: '合成项目', rootPath: work, permission: 'write' })).project;
  await api('/settings/models', { defaultModelProfileId: 'synthetic' }, 'PATCH');
  await api('/onboarding', { step: 'first', completed: true }, 'PATCH');
  const secondRoot=join(root,'computer-b');await mkdir(secondRoot);secondRuntime=await phoneRuntime(secondRoot,logs,{respond});
  secondHost=await createPersonalAccessService({root:join(secondRoot,'account'),port:0,backend:secondRuntime.backend,uiHandler:servePersonalAccessUi});
  secondRuntime.setHost(secondHost);await secondRuntime.start();const second=await secondHost.start(),secondGrant=await secondHost.issueSetupGrant();
  const secondSetup=await fetch(second.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:second.origin,'content-type':'application/json'},body:JSON.stringify({grant:secondGrant.grant,username:'SyntheticMODE1',password:'Synthetic mode one password',deviceName:'synthetic-phone'})});
  assert.equal(secondSetup.status,201);const secondAuth=await secondSetup.json(),secondCookie=secondSetup.headers.get('set-cookie').split(';')[0],secondWork=join(secondRoot,'SyntheticWork');await mkdir(secondWork);
  const secondApi=async(path,body,method=body===undefined?'GET':'POST')=>{const res=await fetch(second.origin+'/personal/v1'+path,{method,headers:{origin:second.origin,cookie:secondCookie,'x-weftmate-csrf':secondAuth.csrfToken,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await res.json();assert.ok(res.ok,JSON.stringify({path,status:res.status,error:value.error}));return value;};
  const secondProject=(await secondApi('/projects',{requestId:randomUUID(),name:'合成电脑二的项目',rootPath:secondWork,permission:'write'})).project;
  await secondApi('/settings/models',{defaultModelProfileId:'synthetic'},'PATCH');await secondApi('/onboarding',{step:'first',completed:true},'PATCH');
  report.syntheticComputers=2;report.contentTransport='isolated authenticated HTTP proxy; cloud-directory and channel-credential exchange are synthetic';
  browser = await chromium.launch({ headless: true });
  const env = { ...process.env, REVIEW_PROFILE: join(root, 'desktop-profile'), REVIEW_ORIGIN: started.origin,
    REVIEW_LIBRARY_TOKEN: host.libraryDesktopToken, REVIEW_THEME: 'light', WEFTMATE_TEST_HOST_NAME: 'synthetic-host' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: repository,
    args: ['scripts/review-gallery/electron.mjs','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'], env });
  const desktop = await app.firstWindow(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFocusable(false));
  report.nativeFocusTaken = false;
  report.occlusionDisabledForSyntheticWindow = true;
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const [kind, page] of [['desktop', desktop], ['phone', phone]]) {
    activePage = page;
    page.on('pageerror', error => report.errors.push(redactEvidenceText(error.message, [root])));
    page.on('response',async response=>{if([401,403].includes(response.status())){const url=new URL(response.url());const body=await response.json().catch(()=>null);
      (report.authorizationFailures??=[]).push({kind,path:url.pathname,status:response.status(),code:body?.error?.code});}});
    await page.addInitScript(() => { let mod; Object.defineProperty(globalThis, 'WeftUiCore', { configurable: true, get: () => mod, set: value => {
      mod = value; const create = value.create; value.create = (...args) => { globalThis.mode1Effects=args[0].effects;const core = create(...args); globalThis.mode1Core = core; return core; }; } }); });
    await page.route('**/mode1-proxy/**',async route=>{const incoming=route.request(),url=new URL(incoming.url()),parts=url.pathname.split('/'),hostId=parts[2],path='/'+parts.slice(3).join('/')+url.search;
      const target=hostId===second.hostId?second:started,targetAuth=hostId===second.hostId?secondAuth:auth,targetCookie=hostId===second.hostId?secondCookie:cookie;
      const res=await fetch(target.origin+path,{method:incoming.method(),headers:{origin:target.origin,cookie:targetCookie,'x-weftmate-csrf':targetAuth.csrfToken,'content-type':'application/json'},body:['GET','HEAD'].includes(incoming.method())?undefined:incoming.postData()});
      const responseBody=await res.text();let value;try{value=JSON.parse(responseBody);}catch{}
      report.proxy??=[];if(report.proxy.length<150)report.proxy.push({host:hostId===second.hostId?'B':'A',path,method:incoming.method(),status:res.status,state:value?.command?.state,error:value?.error?.code});
      await route.fulfill({status:res.status,contentType:'application/json',body:responseBody});});
    await page.context().addCookies([{ name: 'wm_personal_session', value: cookie.slice(cookie.indexOf('=') + 1), url: started.origin }]);
    await page.goto(started.origin + '/personal/v1/ui/'); await page.waitForFunction(() => globalThis.mode1Core?.state.personalCapabilities?.workAndChat === 1);
    await page.locator('#assistant-view').waitFor({ state: 'visible' });
    stage = kind + '-chat';
    await page.evaluate(() => mode1Core.startNewConversation());
    await page.locator('#message-text').fill('MODE1_HELLO_' + randomUUID()); await page.locator('#send-message').click();
    await until(() => page.locator('#transcript').innerText().then(text => text.includes('合成回复')), stage);
    await page.locator('#message-text').fill('MODE1_SECOND_' + randomUUID()); await page.locator('#send-message').click();
    await until(() => page.evaluate(() => [...mode1Core.state.historyEvents.values()].filter(e => e.type === 'user.message').length >= 2), 'two chat messages');
    const before = await page.evaluate(() => ({ id: mode1Core.state.selectedSessionId, chat: mode1Core.state.selectedChatId }));
    await api(`/sessions/${before.id}/approval-mode`, { mode: 'ask' }, 'PATCH');
    await capture(page, kind, 'sidebar-chat', async p=>{await p.getByRole('button',{name:'筛选最近对话',exact:true}).click();await p.getByRole('menu',{name:'最近对话类型',exact:true}).getByRole('menuitemradio',{name:'对话',exact:true}).click();});
    await capture(page, kind, 'sidebar-work', async p=>{await p.getByRole('button',{name:'筛选最近对话',exact:true}).click();await p.getByRole('menu',{name:'最近对话类型',exact:true}).getByRole('menuitemradio',{name:'工作',exact:true}).click();});
    await page.getByRole('button',{name:'筛选最近对话',exact:true}).click();await page.getByRole('menu',{name:'最近对话类型',exact:true}).getByRole('menuitemradio',{name:'对话',exact:true}).click();
    assert.equal(await page.locator('.rail-main-chat:not([hidden])').count(),0);
    await page.evaluate(()=>mode1Core.selectMainChat());
    await page.locator('#message-text').fill('MODE1_ORIGINAL_HISTORY_'+kind+'_'+randomUUID());await page.locator('#send-message').click();
    await until(()=>page.locator('#transcript').innerText().then(text=>text.includes('合成回复')),'original history readable');
    await capture(page,kind,'original-history');
    await page.evaluate(id=>mode1Core.selectSession(id),before.id);
    await page.locator('#message-text').fill(`MODE1_WRITE_${kind.toUpperCase()}_${randomUUID()}`); await page.locator('#send-message').click();
    await page.getByRole('region', { name: '切换到工作', exact: true }).waitFor();
    if(kind==='desktop'){await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},work);
      await page.getByRole('region',{name:'切换到工作',exact:true}).getByRole('button',{name:'选择文件夹…',exact:true}).click();
      await until(()=>page.evaluate(()=>!mode1Core.state.workProjectSelecting),'synthetic native folder choice');assert.equal(await page.evaluate(()=>mode1Core.state.selectedSessionId),before.id);}
    assert.equal(await page.evaluate(() => mode1Core.currentConversationMode()), 'chat');
    await capture(page, kind, 'switch-card');
    await page.getByRole('button', { name: '切换到工作', exact: true }).click();
    await until(() => page.evaluate(() => mode1Core.currentConversationMode() === 'work'), 'work mode');
    assert.equal(await page.evaluate(() => mode1Core.state.selectedSessionId), before.id);
    const approvals = await until(async () => { const rows = (await api(`/sessions/${before.id}/approvals`)).approvals; return rows.find(row => row.status === 'pending' && row.intent !== 'work-switch'); }, 'ordinary write approval');
    await api(`/sessions/${before.id}/approvals/${approvals.approvalId}`, { requestId: randomUUID(), outcome: 'allowed-once' });
    const filename = kind === 'phone' ? 'phone.txt' : 'desktop.txt';
    await until(() => readFile(join(work, filename), 'utf8').catch(() => null), 'file exists');
    assert.equal(await readFile(join(work, filename), 'utf8'), 'MODE1_SYNTHETIC_FILE\n');
    assert.ok((await page.locator('#transcript').innerText()).includes('MODE1_HELLO')); await capture(page, kind, 'working');
    assert.equal(await page.evaluate(()=>mode1Core.sidebarConversationMode()),'work');
    await capture(page,kind,'sidebar-work');
    report.checks.push(kind + ': chat history, actual tool card, same session, approval and real file');
    stage = kind + '-decline'; await page.evaluate(() => mode1Core.startNewConversation());
    await page.locator('#message-text').fill('MODE1_WRITE_DECLINE_' + randomUUID()); await page.locator('#send-message').click();
    await page.getByRole('region', { name: '切换到工作', exact: true }).waitFor(); await page.getByRole('button', { name: '先不用', exact: true }).click();
    await until(() => page.getByRole('region', { name: '切换到工作', exact: true }).count().then(n => n === 0), 'card closes');
    assert.equal(await page.evaluate(() => mode1Core.currentConversationMode()), 'chat'); report.checks.push(kind + ': decline remains chat');
    stage = kind + '-new-work';
    await page.evaluate(({a,b,authA,authB})=>{
      const core=mode1Core,fx=mode1Effects;core.cloudCurrentComputer=()=>a.hostId;
      core.cloudConnect=async id=>({hostId:id,status:'online',baseUrl:id===b.hostId?b.origin:a.origin});core.cloudComputerCapabilities=async()=>({cloudChannel:1});
      core.cloudComputerChannel=async connection=>({...connection.hostId===b.hostId?authB:authA,token:'s'.repeat(64)});
      fx.openComputerChannel=async connection=>({close(){},request:async(path,options={})=>{const res=await fetch('/mode1-proxy/'+connection.hostId+path,options);const data=await res.json();if(!res.ok)throw {code:data.error?.code,status:res.status};return data;}});
      core.cloudDirectory=async()=>{};core.updateComputerDirectory({capabilities:{multiHost:1},hosts:[{hostId:a.hostId,name:'合成电脑一',displayName:'合成电脑一',online:true},{hostId:b.hostId,name:'合成电脑二',displayName:'合成电脑二',online:true}]});
    },{a:started,b:second,authA:auth,authB:secondAuth});
    await page.evaluate(() => mode1Core.chooseSidebarMode('work'));
    if (!await page.locator('#new-session').isVisible()) await page.locator('#rail-open').click();
    await page.locator('#new-session').click();
    await until(()=>page.evaluate(()=>mode1Core.currentConversationMode()==='work'),'new button follows work tab');
    assert.equal(await page.locator('#send-message').isDisabled(), true);
    await capture(page,kind,'computer-menu',p=>p.getByRole('button',{name:/^电脑：/}).click());
    await page.getByRole('button',{name:/^电脑：/}).click();await page.getByRole('menuitemradio',{name:/合成电脑二/}).click();
    await until(()=>page.evaluate(id=>mode1Core.currentExecutionComputer()===id,second.hostId),'second computer selected');
    await capture(page, kind, 'new-work', p => p.getByRole('button', { name: '选择项目或文件夹', exact: true }).click());
    await page.getByRole('button', { name: '选择项目或文件夹', exact: true }).click(); await page.getByRole('menuitemradio', { name: /合成电脑二的项目/ }).click();
    await page.locator('#message-text').fill('MODE1_WRITE_NEW_WORK_'+kind.toUpperCase()+'_'+randomUUID());await page.locator('#send-message').click();
    await until(()=>readFile(join(secondWork,`new-work-${kind}.txt`),'utf8').catch(()=>null),'second computer file');
    await assert.rejects(readFile(join(work,`new-work-${kind}.txt`)));report.checks.push(kind + ': new work chooses second computer and its project; only second computer writes');
    await capture(page,kind,'second-computer-work');
    await page.evaluate(async id=>{await mode1Core.selectExecutionComputer(id);await mode1Core.startNewConversation();},started.hostId);
    await page.locator('#message-text').fill('MODE1_WRITE_OFFLINE_'+randomUUID());await page.locator('#send-message').click();
    const offlineCard=await until(()=>page.evaluate(()=>mode1Core.state.selectedSessionId),'offline card session accepted');
    const offlineApproval=await until(async()=> (await api(`/sessions/${offlineCard}/approvals`)).approvals.find(row=>row.status==='pending'),'offline native approval');
    assert.equal(offlineApproval.intent,'work-switch','native mode decision must precede any ordinary risk approval');
    await page.getByRole('region',{name:'切换到工作',exact:true}).waitFor();
    await page.evaluate(()=>{for(const host of mode1Core.state.computers)host.online=false;const bar=document.getElementById('approval-bar');delete bar.dataset.workSignature;for(const child of bar.children)delete child.dataset.signature;mode1Effects.renderConversationApprovals();});
    await capture(page,kind,'offline-card');assert.ok((await page.getByRole('region',{name:'切换到工作',exact:true}).innerText()).includes('需要一台在线的电脑'));
    await api('/commands',{requestId:randomUUID(),kind:'session.cancel',targetDeviceId:started.hostId,sessionId:offlineCard});
  }
  stage='desktop-main-conversion';activePage=desktop;
  await desktop.evaluate(async()=>{for(const row of mode1Core.state.computers)row.online=true;await mode1Core.selectMainChat();});
  await desktop.locator('#message-text').fill('MODE1_MAIN_HELLO_'+randomUUID());await desktop.locator('#send-message').click();
  await until(()=>desktop.locator('#transcript').innerText().then(text=>text.includes('合成回复')),'main hello');
  const oldMain=await desktop.evaluate(()=>({chatId:mode1Core.state.selectedChatId,sessionId:mode1Core.state.selectedSessionId}));
  await desktop.locator('#message-text').fill('MODE1_WRITE_MAIN_'+randomUUID());await desktop.locator('#send-message').click();
  await desktop.getByRole('region',{name:'切换到工作',exact:true}).waitFor();await desktop.getByRole('button',{name:'切换到工作',exact:true}).click();
  await until(()=>desktop.evaluate(()=>mode1Core.currentConversationMode()==='work'),'main moves to work');
  assert.equal(await desktop.evaluate(()=>mode1Core.state.selectedChatId),oldMain.chatId);assert.equal(await desktop.evaluate(()=>mode1Core.state.selectedSessionId),oldMain.sessionId);
  assert.ok((await desktop.locator('#transcript').innerText()).includes('MODE1_MAIN_HELLO'));
  assert.equal((await api('/chats/main')).chat.chatId,oldMain.chatId);report.checks.push('desktop: original logical history remains readable in work; no replacement main is created');
  await capture(desktop,'desktop','main-to-work');
  await api('/commands',{requestId:randomUUID(),kind:'session.cancel',targetDeviceId:started.hostId,sessionId:oldMain.sessionId});
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = { stage, message: redactEvidenceText(error.stack || error.message, [root]) };
  if (activePage) report.failure.ui = JSON.parse(redactEvidenceText(JSON.stringify(await activePage.evaluate(() => {
    const core = globalThis.mode1Core; return { selectedSessionId: core?.state.selectedSessionId, selectedChatId: core?.state.selectedChatId,
      newConversation: core?.state.newConversation, newConversationMode:core?.state.newConversationMode,sidebarMode:core?.sidebarConversationMode?.(),capabilities:core?.state.capabilities,
      modelProfileId: core?.state.modelProfileId, models: core?.state.models,
      composer: core?.composerState?.(document.getElementById('message-text').value), transcript: document.getElementById('transcript').textContent,
      operation: document.getElementById('operation-status').textContent, sessions: core?.state.sessions,
      approvalContext:core?.approvalContext(), approvalRows:[...core.conversationApprovals.entries.values()], approvalHtml:document.getElementById('approval-bar').outerHTML,
      visibility:document.visibilityState,background:core?.state.background,currentView:core?.state.currentView,online:core?.state.online,historyAllowed:core?.historyReadAllowed(),
      refreshTimer:!!core?.state.refreshTimer,liveTimer:!!core?.state.liveRefreshTimer,waitInFlight:!!core?.mainChatRefreshPromise,readResult:core?.state.historyReadResult };
  }).catch(() => ({}))), [root]));
  if(activePage)report.failure.observedApprovals=await activePage.evaluate(async()=>{const core=globalThis.mode1Core;return core.state.selectedSessionId?await core.accessApi(`/sessions/${core.state.selectedSessionId}/approvals`):null;}).catch(error=>({error:error.code}));
  report.modelRequests = runtime?.requests.map(body => ({ tools: body.tools?.map(tool => tool.function?.name), messages: body.messages.map(m => ({ role: m.role, text: textOf(m).slice(0, 100), calls: m.tool_calls?.map(call => call.function.name) })) }));
  const secondStore=await readFile(join(root,'computer-b','account','store.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(secondStore)report.failure.targetCommands=Object.values(secondStore.accounts).flatMap(account=>Object.values(account.commands).map(command=>({kind:command.kind,state:command.state,errorCode:command.errorCode,sessionId:command.sessionId,projectId:command.payload.projectId,targetDeviceId:command.targetDeviceId})));
  report.secondModelRequests=secondRuntime?.requests.map(body=>({tools:body.tools?.map(tool=>tool.function?.name),messages:body.messages.map(m=>({role:m.role,text:textOf(m).slice(0,100),calls:m.tool_calls?.map(call=>call.function.name)}))}));
  throw error;
}
finally {
  const closing=await Promise.allSettled([browser?.close(),app?.close(),secondRuntime?.close(),runtime?.close()]);
  const hostsClosed=await Promise.allSettled([secondHost?.close(),host?.close()]);
  report.closeFailures=[...closing,...hostsClosed].filter(row=>row.status==='rejected').map(row=>String(row.reason?.message||row.reason));
  const cleaned = cleanupOwnedProcesses({ startedAt, executables: [process.execPath, createRequire(import.meta.url)('electron'), chromium.executablePath()], commandRoots: [root] }); report.cleaned = cleaned.cleaned;
  report.logs = logs.map(line => redactEvidenceText(line, [root])).filter(line => /error|fail/i.test(line)).slice(-10);
  try {await writeFile(join(out, 'electron-report.json'), JSON.stringify(cleanEvidence(report),null,2));}
  finally {if (heavyLock && await readFile(heavyLock,'utf8').catch(()=>null) === heavyLease) await unlink(heavyLock);}
  assert.ok(resolve(root).startsWith(resolve(tmpdir()))); await unlinkTreeLinks(root); await rm(root, { recursive: true, force: true });
}

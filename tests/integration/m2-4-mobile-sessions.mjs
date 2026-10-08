import {execFileSync,spawn} from 'node:child_process';
/** Real Electron and browser, real personal host/pinned DSH, isolated synthetic model. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const repository = resolve(import.meta.dirname, '../..');
const root = mkdtempSync(join(process.env.SystemRoot || 'C:/Windows', 'Temp', 'weftmate-m2-4-mobile-'));
const profile = join(root, 'profile'); mkdirSync(profile);
writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const evidence = join(repository, 'tests/evidence/m2-4'); mkdirSync(evidence, { recursive: true });
const password = `synthetic-${randomUUID()}-password`;
const preparation = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0,
  backend: Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => name === 'listModels' ? [] : {}])) });
const prepared = await preparation.start(), grant = await preparation.issueSetupGrant();
const setup = await fetch(`${prepared.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: prepared.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: grant.grant, username: 'UiThreeFixture', password, deviceName: 'Preparation' }) });
assert.equal(setup.status, 201); await preparation.close();
const requests = [], emitted = new Set(), automatic = new Set(), errors = [], reports = [];
const model = createServer(async (request, response) => {
  if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'ui3-synthetic-model', object: 'model' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  let raw = ''; for await (const part of request) raw += part;
  const body = JSON.parse(raw), text = JSON.stringify(body.messages), names = (body.tools || []).map(row => row.function?.name);
  const marker = /UI3_(chromium|mumu)/.exec(text)?.[0] || 'background';
  const deletion = [...text.matchAll(/UI3_DELETE_(chromium|mumu)_(allow|deny)/g)].at(-1)?.[0];
  const record = { marker, text, closed: false, complete: null }; requests.push(record);
  response.on('close', () => { record.closed = true; });
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const frame = (delta, finish = null) => response.write(`data: ${JSON.stringify({ id: 'ui3-fixture', object: 'chat.completion.chunk', model: body.model,
    choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  const finish = () => { if (record.closed) return; frame({ content: '合成任务完成。' }); frame({}, 'stop'); response.end('data: [DONE]\n\n'); };
  record.complete = finish;
  if (deletion && names.length && !emitted.has(deletion)) {
    emitted.add(deletion);
    const file = join(root, `${deletion}.txt`);
    let tool = 'pwsh', args = { command: `Remove-Item -LiteralPath '${file.replace(/'/g, "''")}'`, description: '删除本次隔离测试文件' };
    if (!names.includes(tool) && names.includes('run_code')) { args = { code: `return await tools.pwsh(${JSON.stringify(args)});`, description: '删除本次隔离测试文件' }; tool = 'run_code'; }
    assert.ok(names.includes(tool), `Missing shell tool: ${names.join(',')}`);
    frame({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] });
    frame({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
  }
  if (!text.includes('RUN_DELETE')) { finish(); return; }
  frame({ role: 'assistant', content: '正在处理隔离测试任务。' });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('WEFTMATE_') || key.startsWith('MEMOWEFT_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let application, browser, page, output = '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await sleep(200); }
  throw Error('UI-3 condition timed out');
}
async function api(page, path, body, method = body ? 'POST' : 'GET') {
  return page.evaluate(async ({ path, body, method }) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function login(page) {
  page.setDefaultTimeout(30000); page.on('pageerror', error => { errors.push(error.message); console.error('UI-3 renderer error:',error.message); });
  await page.getByRole('textbox', { name: '账户名', exact: true }).fill('UiThreeFixture');
  await page.getByLabel('密码', { exact: true }).filter({ visible: true }).fill(password);
  await page.getByRole('textbox', { name: '这台设备的名称' }).fill('UI-3 隔离验收');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '新对话 Ctrl N', exact: true }).waitFor();
}
async function newSession(page) {
  const seen = new Set(), listen = request => seen.add(request.url()); page.on('request', listen);
  const posted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/commands'));
  await page.getByRole('button', { name: '新对话 Ctrl N', exact: true }).click();
  const created = await (await posted).json(), id = created.command.sessionId;
  await until(() => [...seen].some(url => url.includes(`/sessions/${id}/events`)));
  await until(() => page.getByRole('textbox', { name: '输入消息', exact: true }).isEnabled());
  page.off('request', listen); console.log('UI-3 new isolated session'); return id;
}
async function history(page, sessionId) { return (await api(page, `/sessions/${sessionId}/events?afterSeq=-1&limit=200`)).body.events; }
async function desktopSend(page, text, key = null) {
  await sleep(900);
  const input = page.getByRole('textbox', { name: '输入消息', exact: true }); await input.fill(text);
  await until(() => page.getByRole('button', {name:'发送',exact:true}).isEnabled());
  const posted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/commands'));
  console.log(`UI-3 sending ${text}; inputEnabled=${await input.isEnabled()}; sendEnabled=${await page.getByRole('button', {name:'发送',exact:true}).isEnabled()}`);
  if (key) await input.press(key); else await page.getByRole('button', { name: '发送', exact: true }).click();
  const submission = await (await posted).json(), id = submission.command.commandId;
  await until(async () => await input.inputValue() === '');
  const command = await until(async () => { const row = (await api(page, `/commands/${id}`)).body.command; return row?.state === 'accepted_by_dsh' ? row : null; });
  console.log(`UI-3 sent ${text}: ${command.intent}`); return command;
}

const device=process.argv.includes('--device'),surface=device?'mumu':'chromium';
const packageName='com.memoweft.weftmate.mobile.m24qa';
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe',serial='127.0.0.1:7555';
const adbRun=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',maxBuffer:12*1024*1024});
let mobile,webServer,debugPort,instrumentation,installed=false,probeInstalled=false,probeLog='',hostPort;
let cookie='',csrf='',nativeProfile=null,origin,control;
async function request(path,method='GET',body){const response=await fetch(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...(csrf?{'x-weftmate-csrf':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error?.code||'OPERATION_FAILED'),{status:response.status});
  if(response.headers.getSetCookie().length)cookie=response.headers.getSetCookie().map(row=>row.split(';')[0]).join('; ');
  if(value.csrfToken)csrf=value.csrfToken;return value;}
async function bridge({method,params={}}){
  if(method==='app.bootstrap')return {loggedIn:!!nativeProfile,...nativeProfile,model:null,busy:false};
  if(method==='auth.login'){const value=await request('/personal/v1/auth/login','POST',{username:params.username,password:params.password,deviceName:params.deviceName});nativeProfile={loggedIn:true,...value.account,owner:value.account.ownerId,device:value.device,deviceId:value.device.id};return nativeProfile;}
  if(method==='auth.me')return nativeProfile||{};
  if(method==='auth.state')return request('/personal/v1/auth/state');
  if(method==='settings.appearance')return {value:'light'};
  if(method==='conversations.list')return {conversations:[]};
  if(method==='attachments.list')return {attachments:[]};
  if(method==='shared.sessions.list'){const data=await request('/personal/v1/sessions?archived=all');return {...data,source:'host',hostAvailable:true,sessions:data.sessions.map(row=>({...row,source:'host'}))};}
  if(method==='shared.sessions.lifecycle')return request(`/personal/v1/sessions/${params.sessionId}${params.action==='delete'?'':'/'+params.action}`,params.action==='delete'?'DELETE':'POST',params.action==='delete'?{forgetMemories:params.forgetMemories}:{});
  if(method==='shared.sessions.events'){const query=new URLSearchParams();for(const key of ['afterSeq','beforeSeq'])if(params[key]!=null)query.set(key,params[key]);return {...await request(`/personal/v1/sessions/${params.sessionId}/events?${query}`),source:'host',sessionId:params.sessionId};}
  if(method==='shared.sessions.eventDetail')return request(`/personal/v1/sessions/${params.sessionId}/events/${params.seq}/detail`);
  if(method==='shared.approvals.list'||method==='shared.questions.list')return request(`/personal/v1/sessions/${params.sessionId}/${method.includes('approvals')?'approvals':'questions'}`);
  if(method==='shared.approvals.decide')return request(`/personal/v1/sessions/${params.sessionId}/approvals/${params.approvalId}`,'POST',{requestId:params.requestId,outcome:params.outcome,scope:params.scope});
  if(method==='shared.tasks.detail')return request(`/personal/v1/tasks/${params.taskId}`);
  if(method==='shared.tasks.stop'){return request(`/personal/v1/tasks/${params.taskId}/stop`,'POST',{requestId:params.requestId});}
  if(method==='activity.list'){const data=await request('/personal/v1/commands?limit=50');return {hostAvailable:true,activities:data.commands.map(row=>({...row,source:'host'}))};}
  if(method==='host.business')return request(params.path,params.method,params.body);
  if(method==='shared.send'||method==='shared.stop'){const result=await request('/personal/v1/commands','POST',{...params,kind:method==='shared.send'?'session.message':'session.cancel',targetDeviceId:(await request('/personal/v1/status')).hostId});return {source:'host',sessionId:params.sessionId,requestId:params.requestId,state:'accepted',command:result.command};}
  if(method==='shared.outbox.list'||method==='shared.outbox.reconcile')return {source:'host',commands:[]};
  if(method==='shared.commands.byRequest')return request(`/personal/v1/commands/by-request/${params.requestId}`);
  return {};
}
async function click(locator){console.log('Click',String(locator));await locator.waitFor();if(!device)return locator.click();let box;
  await until(async()=>{try{await locator.scrollIntoViewIfNeeded();box=await locator.boundingBox();return !!box;}catch(error){if(error.message.includes('not attached'))return false;throw error;}});
  const dpr=await mobile.evaluate(()=>devicePixelRatio);
  adbRun('shell','input','tap',String(Math.round((box.x+box.width/2)*dpr)),String(Math.round((box.y+box.height/2)*dpr+24*dpr)));await sleep(250);}
async function fill(locator,text){await locator.evaluate((node,text)=>{node.value=text;node.dispatchEvent(new Event('input',{bubbles:true}));},text);}
async function shots(name){for(const theme of ['light','dark']){await mobile.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await sleep(450);
  const file=join(evidence,`${surface}-${name}-${theme}.png`);if(device)writeFileSync(file,execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:12*1024*1024}));else await mobile.screenshot({path:file,animations:'disabled'});}
  await mobile.evaluate(()=>document.documentElement.dataset.theme='light');}
async function observe(){await mobile.evaluate(()=>{window.qaCalls=[];const original=mobileEffects.nativeCall;
  mobileEffects.nativeCall=async(...args)=>{const row={method:args[0],params:args[0].startsWith('auth.')?undefined:args[1]};qaCalls.push(row);const result=await original(...args);row.result=result;return result;};});}
async function send(text,key){const start=await mobile.evaluate(()=>qaCalls.length);await fill(mobile.getByRole('textbox',{name:'输入消息',exact:true}),text);
  await until(()=>mobile.getByRole('button',{name:'发送',exact:true}).isEnabled());
  if(key)await mobile.getByRole('textbox',{name:'输入消息',exact:true}).press(key);else await click(mobile.getByRole('button',{name:'发送',exact:true}));
  const row=await until(()=>mobile.evaluate(start=>qaCalls.slice(start).find(row=>row.method==='shared.send'&&row.result),start));
  const command=await until(async()=>{const value=(await api(control,`/commands/by-request/${row.params.requestId}`)).body.command;return value?.state==='accepted_by_dsh'?value:null;});
  if(row.result.state==='uncertain')await click(mobile.getByRole('button',{name:'检查状态',exact:true}));
  await until(async()=>await mobile.getByRole('textbox',{name:'输入消息',exact:true}).inputValue()==='');return command;}
async function enterSession(id){await click(mobile.getByRole('button',{name:'返回',exact:true}));
  const title=(await api(control,'/sessions')).body.sessions.find(row=>row.sessionId===id).title;
  await click(mobile.getByRole('button',{name:`${title} 正在运行`,exact:true}));
  await mobile.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();}
try {
  application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:['.','--personal-host','--access-port=0',`--user-data-dir=${profile}`],env,timeout:90000});
  application.process().stdout?.on('data',part=>output=(output+part).slice(-30000));application.process().stderr?.on('data',part=>output=(output+part).slice(-30000));
  control=await application.firstWindow();await control.waitForURL('**/personal/v1/ui*');await login(control);origin=new URL(control.url()).origin;hostPort=new URL(origin).port;
  const configured=await api(control,'/account/models',{requestId:'ui3m-model',name:'UI-3m 合成模型',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'ui3-synthetic-model',apiKey:'synthetic-fixture-only'});
  assert.ok([200,202].includes(configured.status));await until(async()=>(await api(control,'/account/models/by-request/ui3m-model')).body.operation?.status==='succeeded');await control.reload();
  const id=await newSession(control),marker=`UI3_${surface}`;
  // Give this fresh session a unique visible title through the regular desktop UI.
  const target=await desktopSend(control,`${marker} BLOCK`);await until(()=>requests.some(row=>row.marker===marker&&row.closed));
  if(device){assert.deepEqual(adbRun('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate')),[],'MuMu is occupied');
    assert.ok(!adbRun('shell','pm','list','packages',packageName).includes(packageName),'Fresh independent package required');
    adbRun('install',join(repository,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));installed=true;
    adbRun('install',join(repository,'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));probeInstalled=true;adbRun('reverse',`tcp:${hostPort}`,`tcp:${hostPort}`);
    instrumentation=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.M24WebViewProbeTest','-e','m24Probe','1',`${packageName}.test/androidx.test.runner.AndroidJUnitRunner`]);
    instrumentation.stdout.on('data',part=>probeLog+=part);instrumentation.stderr.on('data',part=>probeLog+=part);
    await until(()=>{try{return adbRun('shell','pidof',packageName).trim();}catch{return false;}});
    const reserve=createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));debugPort=reserve.address().port;await new Promise(done=>reserve.close(done));
    adbRun('forward',`tcp:${debugPort}`,`localabstract:webview_devtools_remote_${adbRun('shell','pidof',packageName).trim()}`);
    await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).some(row=>row.url.includes('appassets'));}catch{return false;}});
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true});mobile=browser.contexts()[0].pages().find(row=>row.url().includes('appassets'));await mobile.reload();
  }else{const assets=join(repository,'apps/mobile-ui/www');webServer=createServer((req,res)=>{try{const file=resolve(assets,'.'+(req.url==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!file.startsWith(assets))return res.writeHead(404).end();res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}});
    await new Promise(done=>webServer.listen(0,'127.0.0.1',done));browser=await chromium.launch({headless:true});mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await mobile.exposeFunction('__native',async payload=>{try{return {id:payload.id,ok:true,result:await bridge(payload)};}catch(error){return {id:payload.id,ok:false,error:{code:error.message,status:error.status}};}});
    await mobile.addInitScript(()=>window.weftNative={postMessage(value){window.__native(JSON.parse(value)).then(result=>window.weftNative.onmessage({data:JSON.stringify(result)}));}});await mobile.goto(`http://127.0.0.1:${webServer.address().port}/`);
  }
  mobile.setDefaultTimeout(30000);mobile.on('pageerror',error=>errors.push(error.message));await mobile.waitForFunction(()=>typeof state!=='undefined'&&state.booted);await observe();
  await click(mobile.getByRole('button',{name:'登录或连接',exact:true}));
  await fill(mobile.getByLabel('个人服务地址',{exact:true}),origin);await fill(mobile.getByLabel('账户名（3–64个字符）',{exact:true}),'UiThreeFixture');
  await fill(mobile.getByLabel('密码（注册时15–128个字符）',{exact:true}),password);await fill(mobile.getByLabel('设备名称',{exact:true}),'合成 UI-3m 手机');
  await click(mobile.getByRole('button',{name:'检查服务连接',exact:true}));await mobile.getByRole('button',{name:'注册新账户',exact:true}).waitFor();await click(mobile.getByRole('button',{name:'登录',exact:true}));await mobile.waitForFunction(()=>state.loggedIn);

  if(await mobile.getByRole('button',{name:'返回',exact:true}).isVisible())await click(mobile.getByRole('button',{name:'返回',exact:true}));
  const home=mobile.getByLabel('会话列表',{exact:true});
  const title=(await api(control,'/sessions?archived=all')).body.sessions.find(row=>row.sessionId===id).title;
  const sessionButton=home.getByRole('button',{name:title,exact:true});
  if(device){const box=await sessionButton.boundingBox(),dpr=await mobile.evaluate(()=>devicePixelRatio),x=Math.round((box.x+box.width/2)*dpr),y=Math.round((box.y+box.height/2+24)*dpr);adbRun('shell','input','swipe',String(x),String(y),String(x),String(y),'650');}
  else{await sessionButton.dispatchEvent('pointerdown');await sleep(550);await sessionButton.dispatchEvent('pointerup');}
  await mobile.getByRole('dialog',{name:'对话操作',exact:true}).waitFor();await click(mobile.getByRole('button',{name:'归档对话',exact:true}));await mobile.getByRole('dialog',{name:'对话操作',exact:true}).waitFor({state:'hidden'});
  await click(home.getByRole('button',{name:'已归档',exact:true}));await shots('archived');
  await click(home.getByRole('button',{name:`更多操作 ${title}`,exact:true}));await click(mobile.getByRole('button',{name:'恢复对话',exact:true}));await mobile.getByRole('dialog',{name:'对话操作',exact:true}).waitFor({state:'hidden'});
  await click(home.getByRole('button',{name:'返回最近对话',exact:true}));
  await click(home.getByRole('button',{name:`更多操作 ${title}`,exact:true}));await click(mobile.getByRole('button',{name:'删除对话',exact:true}));
  assert.equal(await mobile.getByRole('checkbox',{name:'同时忘掉从这段对话形成的记忆'}).isChecked(),false);await shots('delete-confirm');
  await click(mobile.getByRole('button',{name:'永久删除',exact:true}));
  await until(async()=>!(await api(control,'/sessions?archived=all')).body.sessions.some(row=>row.sessionId===id));
  const runningId=await newSession(control);await desktopSend(control,`${marker} RUN_DELETE`);
  await until(async()=>(await api(control,'/sessions?archived=all')).body.sessions.some(row=>row.sessionId===runningId&&row.running));
  const stoppedDelete=await api(control,`/sessions/${runningId}`,{},'DELETE');assert.equal(stoppedDelete.status,200,JSON.stringify(stoppedDelete.body));
  reports.push({archiveRestore:true,defaultDelete:true,runningDeletion:true});
  assert.deepEqual(errors,[]);writeFileSync(join(evidence,`${surface}-verification.json`),JSON.stringify({surface,realHost:true,realPinnedDsh:true,realNativeBridge:device,syntheticModel:true,isolated:true,locators:'visible names and roles',archiveRestore:true,longPress:true,defaultDelete:true,runningDeletion:true,errors},null,2)+'\n');
  console.log(`UI-3m ${surface} complete`);
}catch(error){console.error('UI-3m failure:',error.message);console.error((await mobile?.locator('body').innerText().catch(()=>''))?.slice(-2200));console.error(output.slice(-2000));await mobile?.screenshot({path:join(root,'failure.png')}).catch(()=>{});console.error('Isolated diagnostics:',root);throw error;
}finally{
  if(device&&installed){if(instrumentation){try{adbRun('shell','run-as',packageName,'touch','files/m24-probe.done');await until(()=>instrumentation.exitCode!==null,15000);}catch{instrumentation.kill();}}
    await browser?.close().catch(()=>{});if(debugPort)try{adbRun('forward','--remove',`tcp:${debugPort}`);}catch{}
    if(hostPort)try{adbRun('reverse','--remove',`tcp:${hostPort}`);}catch{}
    if(probeInstalled)adbRun('uninstall',`${packageName}.test`);adbRun('uninstall',packageName);
    writeFileSync(join(evidence,'mumu-cleanup.json'),JSON.stringify({packageName,applicationRemoved:!adbRun('shell','pm','list','packages',packageName).includes(packageName),reverseRemoved:!adbRun('reverse','--list').includes(`tcp:${hostPort}`),forwardRemoved:!adbRun('forward','--list').includes(`tcp:${debugPort}`),probePassed:/OK \(1 test\)/.test(probeLog),originalPackagesUntouched:true},null,2)+'\n');
  }else await browser?.close().catch(()=>{});
  if(webServer){webServer.closeAllConnections();await new Promise(done=>webServer.close(done));}await application?.close().catch(()=>{});model.closeAllConnections();await new Promise(done=>model.close(done));
}

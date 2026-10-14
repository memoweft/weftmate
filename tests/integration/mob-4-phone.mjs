import { evidencePath } from '../helpers/evidence-path.mjs';
import './and-2-fixture.mjs';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { fixture } from '../helpers/auth-1-https-cloud.mjs';
import { startAnd3Fixture } from './and-3-fixture.mjs';
import { systemBarDifference } from '../../scripts/nightly/system-bars.mjs';
const nativeEntry=process.argv.includes('--native-entry'), native = nativeEntry || process.argv.includes('--native'), repo = resolve(import.meta.dirname, '../..');
const postMainSmoke=process.argv.includes('--post-main-smoke');
const out = nativeEntry ? evidencePath('and-4/standalone', postMainSmoke ? 'post-main' : '') : evidencePath('mob-4'); mkdirSync(out, { recursive: true });
const report = { native, nativeEntry, testDiscovery:'synthetic computer presence and loopback address; authentication and content use product APIs', syntheticCloud: true, syntheticAccount: true, mimoRequests: 0, checks: [], screenshots: [], errors: [] };
const pkg = 'com.memoweft.weftmate.mobile.'+(nativeEntry?'and4qa':'mob4qa'), adb = process.env.AND4_ADB_EXE || 'D:/Software/MuMuPlayer/nx_main/adb.exe';
const adbServer=process.env.AND4_ADB_SERVER_PORT?['-P',process.env.AND4_ADB_SERVER_PORT]:[];
const execute = (file, args) => execFileSync(file, args, { windowsHide: true, timeout: 30000, maxBuffer: 24 * 1024 ** 2 });
const key = execute('powershell.exe', ['-NoProfile', '-Command', "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"]).toString().trim(); assert.ok(key);
const cleanups = []; let cloud, gate, browser, page, host, serial, probe, forward, installed, reversed = [], probeLog = '', width=390, heavyLock, mumuLock, ownershipStarted;
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(fn, label, timeout = 45000) { const end = Math.min(Date.now() + timeout, ownershipStarted ? ownershipStarted + 19*60000 : Infinity); while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch {} await pause(200); } throw Error(label); }
const run = (...args) => execute(adb, [...adbServer,'-s', serial, ...args]);
async function acquireLock(name,label){const path='D:/AIProjects/WeftMate/Runtime/Orchestrator/'+name;try{const fd=openSync(path,'wx');writeFileSync(fd,`AND-4 integrate ${new Date().toISOString()} ${label}`);closeSync(fd);return path;}catch(e){if(e.code==='EEXIST')return null;throw e;}}
async function ui(action,p={}){
  const id=crypto.randomUUID(),data=JSON.stringify({id,action,...p});
  execFileSync(adb,[...adbServer,'-s',serial,'shell','run-as',pkg,'sh','-c',"'cat > files/mob4-command.json'"],{input:data,windowsHide:true,timeout:10000});
  const value=await until(()=>{const value=JSON.parse(run('shell','run-as',pkg,'cat','files/mob4-response.json').toString());return value.id===id&&value;},'native '+action);assert.equal(value.failure,'',`native ${action} ${p.label||''}`);return value;
}
const nativeState=()=>ui('state');
function serve(req, res) {
  const name = new URL(req.url, 'https://fixture.invalid').pathname;
  if (name.startsWith('/personal/')) return false;
  const file = name === '/' ? 'index.html' : name.slice(1); if (file.includes('..')) return false;
  try { const data = readFileSync(join(repo, 'apps/mobile-ui/www', file)); res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' }); res.end(data); return true; } catch { return false; }
}
async function attach() {
  const pid = await until(() => run('shell', 'pidof', pkg).toString().trim(), 'native PID');
  forward = run('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid).toString().trim();
  browser = await until(() => chromium.connectOverCDP('http://127.0.0.1:' + forward, { noDefaults: true }), 'WebView attach');
  page = await until(() => browser.contexts()[0].pages().find(p => p.url().includes('appassets')), 'native page');
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForFunction(() => typeof state !== 'undefined' && state.booted);
  await page.evaluate(()=>{globalThis.mob4NativeFailures=[];const receive=window.weftNative.onmessage;window.weftNative.onmessage=message=>{try{const value=JSON.parse(message.data);if(value.error?.exceptionType)mob4NativeFailures.push({code:value.error.code,exceptionType:value.error.exceptionType});}catch{}return receive(message);};});
}
async function nativeStart() {
  probeLog = ''; probe = spawn(adb, [...adbServer,'-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class',
    'com.memoweft.weftmate.mobile.Mob4ShellProbeTest', '-e', 'host', gateOrigin, '-e', 'cloudCa', Buffer.from(cloud.certificatePem).toString('base64'),
    '-e','nativeEntry',String(nativeEntry),'-e','width',String(width),
    pkg + '.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true });
  probe.stdout.on('data', d => { probeLog += d; }); probe.stderr.on('data', d => { probeLog += d; }); await attach();
}
let gateOrigin;
async function screenshot(name, width, dark) {
  await page.evaluate(async dark => { if(window.weftNative)await androidBridge.call('settings.appearance',{value:dark?'dark':'light'});applyTheme(dark ? 'dark' : 'light'); }, dark);
  if(nativeEntry) await ui('theme',{dark});
  await pause(250);
  const path = join(out, `${native ? 'native' : 'web'}-${width}-${dark ? 'dark' : 'light'}-${name}.png`);
  if (native) {
    const bytes = run('exec-out', 'screencap', '-p'); writeFileSync(path, bytes);
    const window = JSON.parse(run('shell', 'run-as', pkg, 'cat', 'files/mob4-window.json').toString());
    report.screenshots.push({ file: path.split(/[\\/]/).at(-1), viewportWidth: width, systemTheme: 'unchanged', pageTheme: dark ? 'dark' : 'light', android: '15', ...window,
      topColor: window.statusHeight>2?systemBarDifference(bytes, {statusHeight:window.statusHeight}):null, bottomVisible: window.navigationHeight > 0 });
  } else { await page.screenshot({ path }); report.screenshots.push({ file: path.split(/[\\/]/).at(-1), width, height: width === 360 ? 780 : 844, pageTheme: dark ? 'dark' : 'light', browserToolbarsVisible: false }); }
}
try {
  cloud = await fixture({ after: fn => cleanups.push(fn) }, { realProcess: false, serve, transformReply:(path,body)=>{
      if(!host)return body;
      if(path.endsWith('/hosts/connect'))return {...body,status:'online',baseUrl:host.origin};
      return {...body,hosts:body.hosts?.map(row=>({...row,status:'online',online:true}))};
    },
    env: origin => ({ CLOUD_OIDC_CLIENTS: JSON.stringify([
      { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
      { client_id: 'weftmate-android', redirect_uris: ['com.memoweft.weftmate:/oauth'] },
      { client_id: 'weftmate-web', application_type: 'web', redirect_uris: [origin + '/personal/v1/ui/'] },
    ]) }) });
  const clock = setInterval(() => cloud.advance(Math.max(0, Date.now() - cloud.now)), 100); cleanups.push(() => clearInterval(clock));
  gate = createServer((req, res) => {
    if (req.url === '/personal/v1/cloud/config') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ issuer: cloud.config.issuer, hostId: 'unconnected', clientId: 'weftmate-android' })); }
    const target = new URL(cloud.origin); const up = httpRequest({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers });
    // The gate only handles the initial native configuration; identity calls use the real TLS cloud.
    up.on('error', () => { res.writeHead(503); res.end(); }); up.on('response', response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); }); req.pipe(up);
  }); await new Promise(done => gate.listen(0, '127.0.0.1', done)); gateOrigin = 'http://127.0.0.1:' + gate.address().port;
  if (native) {
    for(;;) {
    while(!mumuLock){
      for(let i=1;i<=3;i++){heavyLock=await acquireLock(`heavy-${i}.lock`,'MuMu standalone acceptance');if(heavyLock)break;}
      if(heavyLock)mumuLock=await acquireLock('mumu.lock','MuMu standalone acceptance');
      if(!mumuLock){if(heavyLock){unlinkSync(heavyLock);heavyLock=null;}console.log('WAIT_MUMU_OR_HEAVY');await pause(60000);await pause(60000);}
    }
    ownershipStarted=Date.now();
    const info = JSON.parse(execute('D:/Software/MuMuPlayer/nx_main/MuMuManager.exe', ['info', '-v', '0']).toString()); serial = '127.0.0.1:' + info.adb_port;
    execute(adb, [...adbServer,'connect', serial]);
    const others=run('shell','pm','list','packages').toString().split('\n').filter(l=>/weftmate.*qa/.test(l)&&!l.trim().endsWith('.test')).map(l=>l.replace('package:','').trim()).filter(p=>p!==pkg);
    const active=others.filter(other=>{try{return !!run('shell','pidof',other).toString().trim()}catch{return false}});
    if(!active.length)break;
    console.log('WAIT_OTHER_QA '+active.join(', '));execute(adb,[...adbServer,'disconnect',serial]);
    unlinkSync(mumuLock);unlinkSync(heavyLock);mumuLock=null;heavyLock=null;ownershipStarted=null;
    await pause(60000);await pause(60000);
    }
    const ports = [Number(new URL(cloud.origin).port), gate.address().port]; for (const port of ports) { run('reverse', 'tcp:' + port, 'tcp:' + port); reversed.push(port); }
    run('install', '-r', join(repo, 'apps/android/app/build/outputs/apk/debug/app-debug.apk')); installed = true;
    run('install', '-r', join(repo, 'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'));
    // This package is exclusively synthetic. A restarted runner must start with a
    // new account, even if a prior interrupted batch left its installation behind.
    assert.match(pkg,/\.(?:and4qa|mob4qa)$/);
    assert.match(run('shell','pm','clear',pkg).toString(),/Success/);
    // Package-only test permission; the emulator's global settings are unchanged.
    run('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');await nativeStart();
  } else {
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message)); await page.goto(cloud.origin); await page.waitForFunction(() => state.booted);
    await page.route('https://api.xiaomimimo.com/v1/**', async route => {
      if(process.argv.includes('--fixture-model')){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'合成问候'}}]})});return;}report.mimoRequests++; const response = await fetch(route.request().url(), { method: route.request().method(), headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: route.request().postData() });
      await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json' }, body: Buffer.from(await response.arrayBuffer()) });
    });
  }
  await page.getByRole('button', { name: '注册账号', exact: true }).click(); await page.locator('#auth-email').fill('account@example.com');
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await page.locator('#auth-code').waitFor();
  const challenge = await page.evaluate(() => WeftMobileCloud.core.cloudAuthView().challengeId);
  await page.locator('#auth-code').fill(await cloud.mailCode(challenge)); await page.getByRole('button', { name: '验证邮箱', exact: true }).click();
  await page.locator('#auth-password').fill('a test password with 20 chars'); await page.locator('#auth-confirm').fill('a test password with 20 chars');
  await page.getByRole('button', { name: '完成注册', exact: true }).click();
  await until(()=>page.evaluate(()=>WeftPhone.active || WeftMobileCloud.core.cloudAuthView().mode==='confirm'),'registration completes or confirms device');
  if(await page.evaluate(()=>WeftMobileCloud.core.cloudAuthView().mode==='confirm')){const challenge=await page.evaluate(()=>WeftMobileCloud.core.cloudAuthView().challengeId||WeftMobileCloud.core.state.cloudAuth.challengeId);await page.locator('#auth-code').fill(await cloud.mailCode(challenge));await page.getByRole('button',{name:'确认并登录',exact:true}).click();}
  await page.waitForFunction(() => state.loggedIn && WeftPhone.active, null, { timeout: 30000 });
  if(nativeEntry) await nativeStandaloneFlow();
  else {
  assert.equal(await page.evaluate(() => state.page), 'chat'); assert.equal(await page.locator('#mobile-bottom-tabs [role=tab]').count(), 5);
  assert.equal(await page.locator('.presence-label').innerText(), '已登录'); report.checks.push('register-with-no-computers-enters-chat-and-five-tabs');
  await page.getByRole('button', { name: '设置模型', exact: true }).click(); await screenshot('model-empty', 390, false);
  for(const dark of [false,true]){await page.evaluate(dark=>applyTheme(dark?'dark':'light'),dark);await page.getByRole('combobox',{name:'模型提供方'}).click();await screenshot('provider-menu',390,dark);await page.keyboard.press('Escape');}
  // This isolated test bridge supplies the secret directly to the phone bridge; it is never logged or written to a fixture file.
  await page.evaluate(key=>{document.querySelector('#page-content input[type=password]').value=key},key);
  await page.getByRole('button',{name:'测试连接并使用',exact:true}).click();
  await page.waitForFunction(()=>state.page==='chat'&&state.model,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>document.querySelector('#page-content input[type=password]')?.value||''),'');
  report.modelSetup={ok:true,throughActualSettings:true};
  if (native) report.mimoRequests++;
  await page.locator('#draft').fill('请用一句中文问候我。'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => !state.busy && document.querySelector('.message.assistant'), null, { timeout: 180000 });
  if (native) report.mimoRequests++; report.checks.push('phone-configure-test-stream-and-persist');
  const savedText = await page.locator('.message.assistant .markdown').first().innerText(); assert.ok(savedText.length);const savedId=await page.evaluate(()=>state.conversationId);
  if(native){const bytes=run('shell','run-as',pkg,'tar','-cf','-','no_backup','shared_prefs');assert.equal(bytes.includes(Buffer.from(key))||bytes.includes(Buffer.from(key,'utf16le')),false,'model key must not appear in ordinary phone files');report.checks.push('native-key-byte-scan-and-backup-disabled');}
  assert.equal(await page.evaluate(key=>JSON.stringify(localStorage).includes(key),key),false,'no model key in localStorage');
  for (const width of [360, 390]) {
    if (!native) await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });
    else { const cdp = await browser.contexts()[0].newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 360 ? 780 : 844, deviceScaleFactor: 0, mobile: false }); await cdp.detach(); }
    for (const dark of [false, true]) {
      for (const name of ['chat', 'activity', 'health', 'goals', 'library']) { await page.evaluate(name => selectMobileTab(name), name); await screenshot(name, width, dark); }
      await page.evaluate(() => page('models')); await screenshot('models', width, dark);
      await page.evaluate(() => page('devices')); await screenshot('devices', width, dark);
      await page.evaluate(() => page('memory')); await screenshot('memory', width, dark);
    }
  }
  report.checks.push('all-five-tabs-settings-empty-states-light-dark-360-390');
  await page.evaluate(() => page('chat'));
  if (native) {
    run('shell', 'run-as', pkg, 'touch', 'files/mob4-probe.done'); await until(() => probe.exitCode !== null, 'probe exit'); assert.match(probeLog, /OK \(1 test\)/);
    await browser.close(); run('forward', '--remove', 'tcp:' + forward); forward = null; run('shell', 'am', 'force-stop', pkg); await nativeStart();
  } else await page.reload();
  await page.waitForFunction(() => WeftPhone.active);await page.evaluate(id=>selectConversation(id),savedId);await page.waitForFunction(()=>document.querySelector('.message.assistant'));
  assert.equal(await page.locator('.message.assistant .markdown').first().innerText(), savedText); report.checks.push('restart-preserves-encrypted-phone-chat');
  if (!native) assert.equal(await page.evaluate(() => state.model), null, 'browser key only lives for this opening');
  const ingested = [];
  host = await startAnd3Fixture({ existingCloud: cloud, allowedOrigins:[cloud.origin], memoryManager: { enabled: true, query: async () => ({ items: [], world_revision: 1 }),
    submitCommand:async()=>({}),receiptByRequest:async()=>null,retryCleanupByRequest:async()=>({}),peek: () => 'ready', status: async () => ({ state: 'ready' }), ingest: async (_owner, input) => { ingested.push(input); return { state: 'accepted' }; } } });
  if (native) { const port = Number(new URL(host.origin).port); run('reverse', 'tcp:' + port, 'tcp:' + port); reversed.push(port); }
  report.hostDirectory=await page.evaluate(()=>WeftMobileCloud.core.cloudDirectory());
  if(!native){let cookie='';await page.route(host.origin+'/**',async route=>{const request=route.request();if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':cloud.origin,'access-control-allow-credentials':'true','access-control-allow-headers':'content-type,dpop,x-weftmate-csrf','access-control-allow-methods':'GET,POST,PATCH,DELETE'}});return;}const response=await fetch(request.url(),{method:request.method(),headers:{...request.headers(),origin:host.origin,...(cookie?{cookie}:{})},...(request.postData()?{body:request.postData()}:{}),redirect:'manual'});const next=response.headers.get('set-cookie');if(next)cookie=next.split(';')[0];const headers=Object.fromEntries(response.headers);delete headers['content-length'];headers['access-control-allow-origin']=cloud.origin;headers['access-control-allow-credentials']='true';headers['access-control-allow-headers']='content-type,dpop,x-weftmate-csrf';headers['access-control-allow-methods']='GET,POST,PATCH,DELETE';await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});});}
  await page.evaluate(() => {globalThis.mob4Failures=[];const api=WeftMobileCloud.core.accessApi;WeftMobileCloud.core.accessApi=async(...args)=>{try{return await api(...args)}catch(error){mob4Failures.push({path:args[0],code:error.code,status:error.status});throw error;}};});
  const result=await page.evaluate(async()=>{try{await WeftMobileCloud.core.resumeCloudComputer();return {ok:true}}catch(error){return {ok:false,code:error.code,status:error.status,message:error.message}}});report.exchange=result;assert.equal(result.ok,true,JSON.stringify(result));
  report.handoffState=await page.evaluate(()=>({connection:state.connection,cloudOnly:WeftMobileCloud.core.cloudAuthView().cloudOnly,failures:mob4Failures}));
  await until(() => ingested.length > 0, 'phone conversation delivered to synthetic computer'); report.checks.push('first-computer-imports-original-phone-turn');
  assert.ok(ingested.some(row => row.source_messages.some(m => m.content?.includes(savedText) || m.text?.includes(savedText))));
  await page.evaluate(id=>selectConversation(id),savedId);await page.waitForFunction(()=>document.querySelector('.message.assistant'));assert.equal(await page.locator('.message.assistant .markdown').first().innerText(),savedText);assert.equal(await page.locator('#draft').isDisabled(),true);await screenshot('phone-history-after-computer',390,false);report.checks.push('phone-original-still-readable-after-computer');
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  }
} catch (error) { report.failure = error.message.replaceAll(key, '<redacted>').replaceAll(repo, '<repo>').replaceAll(process.env.USERPROFILE||'<no-user-profile>','%USERPROFILE%');
  if(nativeEntry&&installed){try{report.nativeState=JSON.parse(run('shell','run-as',pkg,'cat','files/mob4-native-state.json').toString());}catch{}}
  if(page)try{report.webState=await page.evaluate(()=>({page:state.page,booted:state.booted,loggedIn:state.loggedIn,phoneActive:WeftPhone.active,authBusy:WeftMobileCloud.core.cloudAuthView().busy,authEpoch:state.authEpoch,route:window.weftNativeRoute}));}catch{}
  if(page)try{report.nativeFailures=await page.evaluate(()=>globalThis.mob4NativeFailures||[]);if(nativeEntry){const state=await nativeState();report.failedPresentation={error:state.error,running:state.running,canRegenerate:state.canRegenerate,scrollVersion:state.scrollVersion,modelId:state.modelId,rows:state.rows.slice(-3)};report.failedEngine=await page.evaluate(async()=>{const view=await WeftPhone.presentation('view');return {error:view.error,running:view.running,selectedId:view.selectedId,last:view.conversations.at(-1)?.turns.at(-1)};});}}catch{}
  if (page) try { await screenshot('failure', 390, false); } catch {} throw error; }
finally {
  try {
  if (native && installed) { try { run('shell', 'run-as', pkg, 'touch', 'files/mob4-probe.done'); } catch {} }
  await browser?.close(); if (native && forward) try { run('forward', '--remove', 'tcp:' + forward); } catch {}
  if (native && installed) {
    report.cleanup=[];
    try { run('shell', 'am', 'force-stop', pkg); } catch {}
    for(const own of [pkg+'.test',pkg])try{report.cleanup.push({package:own,result:run('uninstall',own).toString().trim()});}catch{report.cleanup.push({package:own,result:'uninstall failed'});}
  }
  for (const port of reversed) try { run('reverse', '--remove', 'tcp:' + port); } catch {}
  if (native && serial) execute(adb, [...adbServer,'disconnect', serial]);
  await host?.close(); if (gate) await new Promise(done => { gate.close(done); gate.closeAllConnections(); }); for (const fn of cleanups.reverse()) await fn();
  const ledgerPath=join(repo,'.local/mob4-mimo-ledger.json');let ledger;try{ledger=JSON.parse(readFileSync(ledgerPath,'utf8'))}catch{ledger={actualRequests:0,tlsHandshakeFailuresBeforeHttp:0,runs:[]}};ledger.actualRequests+=report.mimoRequests;ledger.runs.push({native,mimoRequests:report.mimoRequests,checks:report.checks.length,success:!report.failure});writeFileSync(ledgerPath,JSON.stringify(ledger,null,2));
  writeFileSync(join(out, (native ? 'native' : 'web') + '-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ native, checks: report.checks.length, mimoRequests: report.mimoRequests, errors: report.errors, failure: report.failure }));
  } finally { for(const lock of [mumuLock,heavyLock])if(lock)unlinkSync(lock); }
}
async function finishProbe(){run('shell','run-as',pkg,'touch','files/mob4-probe.done');await until(()=>probe.exitCode!==null,'probe exit');assert.match(probeLog,/OK \(1 test\)/);await browser.close();browser=null;run('forward','--remove','tcp:'+forward);forward=null;run('shell','am','force-stop',pkg);}
async function phoneModelFixture(){
  let count=0,failNext=false;
  const model=createServer((req,res)=>{count++;report.syntheticModelRequests=count;let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
    if(!JSON.parse(raw).stream){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{content:'合成连接成功'}}]}));}
    if(failNext){failNext=false;res.writeHead(503,{'content-type':'application/json'});return res.end(JSON.stringify({error:'synthetic model unavailable'}));}
    res.writeHead(200,{'content-type':'text/event-stream'});let i=0;const timer=setInterval(()=>{
      if(i<24)res.write('data: '+JSON.stringify({choices:[{delta:{content:i++===0?'合成回复，':'继续。'},finish_reason:null}]})+'\n\n');
      else{clearInterval(timer);res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    },120);res.on('close',()=>clearInterval(timer));
  });});
  await new Promise(done=>model.listen(0,'127.0.0.1',done));cleanups.push(()=>new Promise(done=>{model.close(done);model.closeAllConnections();}));
  const port=model.address().port;run('reverse','tcp:'+port,'tcp:'+port);reversed.push(port);
  return {endpoint:`http://127.0.0.1:${port}/v1`,count:()=>count,failNext:()=>{failNext=true;}};
}
async function nativeStandaloneFlow(){
  const fixtureMode=process.argv.includes('--fixture-model');report.fixtureModel=fixtureMode;
  let synthetic=fixtureMode?await phoneModelFixture():null;
  await until(async()=>{const s=await nativeState();return s.loggedIn&&s.standalone&&!s.loading&&s.phoneArchive;},'native standalone landing');
  report.checks.push('native-register-no-computer-enters-chat');
  console.log('Native standalone landing ready');
  await screenshot('registered-empty',390,false);
  const entry=await ui('text',{label:'设置对话模型'});report.modelEntry={tab:entry.tab,standalone:entry.standalone};await page.getByRole('combobox',{name:'模型提供方'}).waitFor();await screenshot('model-settings',390,false);
  const configuredKey=fixtureMode?'synthetic-key':key;
  await page.evaluate(({key,endpoint})=>{document.querySelector('#page-content input[type=password]').value=key;if(endpoint){const inputs=[...document.querySelectorAll('#page-content input')].filter(i=>i.type!=='password');inputs[0].value=endpoint;inputs[1].value='synthetic-stream';}},{key:configuredKey,endpoint:synthetic?.endpoint});
  if(!fixtureMode)report.mimoRequests++;await page.getByRole('button',{name:'测试连接并使用',exact:true}).click();
  await until(async()=>{const s=await nativeState();return s.tab==='chat'&&s.modelId===(fixtureMode?'synthetic-stream':'mimo-v2.6-flash')&&s.sendAvailable;},'native returns from model setup',90000);
  report.checks.push('native-empty-model-cta-actual-settings-return');
  console.log('Native model settings returned to chat');
  const stored=run('shell','run-as',pkg,'tar','-cf','-','no_backup','shared_prefs');assert.equal(stored.includes(Buffer.from(configuredKey))||stored.includes(Buffer.from(configuredKey,'utf16le')),false);report.checks.push('native-model-key-is-encrypted');
  if(postMainSmoke) {
    await ui('input',{text:'模型测试期间保留的草稿'});
    await page.evaluate(()=>{state.modelSwitching=true;});
    await ui('staleSend');
    await until(async()=>{const s=await nativeState();return s.draft==='模型测试期间保留的草稿'&&!s.running&&!s.sendAvailable&&s.error.includes('测试')&&s.rows.length===0;},'native rejected send preserves draft and explains model test');
    assert.equal(report.syntheticModelRequests,1,'blocked activation must not send a model request');
    await page.evaluate(()=>{state.modelSwitching=false;});
    await until(async()=> (await nativeState()).sendAvailable,'model test unblock');
    report.checks.push('native-main-send-blocker-stale-activation-keeps-draft');
  }
  await ui('input',{text:'请用四段简短中文说明如何安排本周的工作和休息，每段两句话。'});if(!fixtureMode)report.mimoRequests++;await ui('click',{label:'发送消息'});
  await until(async()=>{const s=await nativeState();return s.rows.some(r=>r.type==='assistant.delta'&&r.data.text);},'real native streaming',90000);
  await screenshot(fixtureMode?'synthetic-stream':'mimo-stream',390,false);
  const reply=await until(async()=>{const s=await nativeState();return !s.running&&s.rows.some(r=>r.type==='assistant.message')&&s;},'real native completion',180000);
  const savedText=reply.rows.find(r=>r.type==='assistant.message').data.text,savedUser=reply.rows.find(r=>r.type==='user.message').data.text,savedId=reply.chatId;
  report.checks.push(fixtureMode?'native-synthetic-stream-and-final-reply':'native-mimo-stream-and-final-reply');
  console.log('Native stream completed');
  // All remaining turns are synthetic, with controlled partial frames and stop timing.
  synthetic??=await phoneModelFixture();
  await page.evaluate(async endpoint=>{await androidBridge.call('phone.models.configure',{endpoint,modelId:'synthetic-stream',displayName:'合成流式模型',apiKey:'synthetic-key'});await WeftPhone.presentation('model',{endpoint,modelId:'synthetic-stream'});},synthetic.endpoint);
  await until(async()=> (await nativeState()).modelId==='synthetic-stream','native local model list refresh');
  await ui('input',{text:'停止后留下已生成文字。'});await ui('click',{label:'模型：合成流式模型'});await screenshot('local-model-menu',390,false);await ui('text',{label:'合成流式模型'});
  await ui('click',{label:'发送消息'});await until(async()=> (await nativeState()).rows.some(r=>r.type==='assistant.delta'),'synthetic partial');
  await ui('click',{label:'停止回复'});await until(async()=>!(await nativeState()).running,'stop completion');
  assert.ok((await nativeState()).rows.at(-1).data.text);report.checks.push('native-stop-preserves-partial');
  await ui('click',{label:'重新生成回复'});await until(async()=>!(await nativeState()).running&&(await nativeState()).canRegenerate,'regeneration completed');
  assert.ok((await ui('copy')).copyVersion>0);report.checks.push('native-regenerate-and-copy');
  console.log('Native stop, regenerate and copy passed');
  synthetic.failNext();await ui('input',{text:'先模拟没有输出的失败，再重试。'});await ui('click',{label:'发送消息'});
  await until(async()=>{const s=await nativeState();return !s.running&&s.error&&s.canRegenerate&&s.rows.at(-1)?.data.text==='先模拟没有输出的失败，再重试。';},'failed completion without assistant text');
  const beforeRetry=await nativeState();await ui('click',{label:'重新生成回复'});assert.ok((await nativeState()).scrollVersion>beforeRetry.scrollVersion,'native retry button action reached model');await until(async()=>{const s=await nativeState();return !s.running&&!s.error&&s.rows.at(-1)?.type==='assistant.message'&&s.rows.at(-2)?.data.text==='先模拟没有输出的失败，再重试。';},'retry failed phone completion');
  report.checks.push('native-failure-before-first-token-can-regenerate');

  await ui('input',{text:'重开后保留的合成草稿'});await pause(600);
  await finishProbe();await nativeStart();await until(async()=>{const s=await nativeState();return s.standalone&&!s.loading&&s.rows.some(r=>r.data.text===savedText)&&s.rows.some(r=>r.data.text===savedUser)&&s.draft==='重开后保留的合成草稿';},'native identity-chat-draft restore');
  report.checks.push('native-kill-reopen-identity-encrypted-chat-draft');
  if(postMainSmoke)return;
  console.log('Native identity, chat and draft restored');
  await ui('input',{text:'重开以后继续聊天。'});await ui('click',{label:'发送消息'});await until(async()=>{const s=await nativeState();return !s.running&&s.rows.some(r=>r.data.text==='重开以后继续聊天。');},'continue after restart');
  for(width of [360,390]){
    if(width===360){await finishProbe();await nativeStart();await until(async()=>!(await nativeState()).loading,'360 restored');}
    else{await finishProbe();await nativeStart();await until(async()=>!(await nativeState()).loading,'390 restored');}
    for(const dark of [false,true]){
      for(const [tab,label] of [['chat','聊天'],['activity','动态'],['health','健康'],['goals','目标'],['library','成果库']]){
        await ui('click',{label});await until(async()=> (await nativeState()).tab===tab,'native '+tab);await screenshot(tab,width,dark);
        if(tab!=='chat'){await page.getByRole('button',{name:'怎么连上电脑',exact:true}).click();await page.getByText('在电脑上安装 WeftMate 并用同一个账号登录，就会出现在这里').waitFor();await screenshot(tab+'-devices',width,dark);}
      }
      await ui('click',{label:'聊天'});await ui('click',{label:'打开侧栏'});await screenshot('sidebar',width,dark);await ui('click',{label:'关闭侧栏'});
    }
  }
  report.checks.push('native-five-tabs-embedded-pages-operable-four-variants');
  console.log('Native four-variant navigation screenshots completed');
  if(process.argv.includes('--comparisons'))await capturePhoneComparisons(savedId);
  const ingested=[];
  host=await startAnd3Fixture({existingCloud:cloud,allowedOrigins:[cloud.origin],memoryManager:{enabled:true,query:async()=>({items:[],world_revision:1}),submitCommand:async()=>({}),receiptByRequest:async()=>null,retryCleanupByRequest:async()=>({}),peek:()=> 'ready',status:async()=>({state:'ready'}),ingest:async(_owner,input)=>{ingested.push(input);return{state:'accepted'};}}});
  const port=Number(new URL(host.origin).port);run('reverse','tcp:'+port,'tcp:'+port);reversed.push(port);
  await page.evaluate(()=>WeftMobileCloud.core.resumeCloudComputer());await until(()=>ingested.length>0,'native phone handoff');
  assert.ok(ingested.some(row=>row.source_messages.some(m=>(m.content||m.text)?.includes(savedText))&&row.source_messages.some(m=>(m.content||m.text)===savedUser)));
  await until(async()=>!(await nativeState()).standalone,'native computer adoption');
  await ui('click',{label:'打开侧栏'});await until(async()=> (await nativeState()).chats.some(c=>c.nativePhone&&c.id===savedId),'native archived sidebar');
  const archived=(await nativeState()).chats.find(c=>c.nativePhone&&c.id===savedId);await ui('text',{label:archived.title});
  await until(async()=>{const s=await nativeState();return s.phoneArchive&&s.rows.some(r=>r.data.text===savedText)&&s.rows.some(r=>r.data.text===savedUser)&&!s.sendAvailable;},'native original remains readable');
  await screenshot('phone-history-after-computer',390,false);report.checks.push('native-first-computer-handoff-original-sidebar-readable');
  await ui('input',{text:'旧账号隔离草稿'});await page.evaluate(()=>WeftMobileCloud.core.cloudLogout());
  await until(async()=> !(await nativeState()).loggedIn,'native logout');
  // A second synthetic account goes through the same registration UI.
  await page.getByRole('button',{name:'注册账号',exact:true}).click();await page.locator('#auth-email').fill('second@example.com');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.locator('#auth-code').waitFor();
  const challenge=await page.evaluate(()=>WeftMobileCloud.core.cloudAuthView().challengeId);await page.locator('#auth-code').fill(await cloud.mailCode(challenge));await page.getByRole('button',{name:'验证邮箱',exact:true}).click();
  await page.locator('#auth-password').fill('a test password with 20 chars');await page.locator('#auth-confirm').fill('a test password with 20 chars');await page.getByRole('button',{name:'完成注册',exact:true}).click();
  await until(()=>page.evaluate(()=>WeftPhone.active||WeftMobileCloud.core.cloudAuthView().mode==='confirm'),'second registration');
  if(await page.evaluate(()=>WeftMobileCloud.core.cloudAuthView().mode==='confirm')){const challenge=await page.evaluate(()=>WeftMobileCloud.core.cloudAuthView().challengeId);await page.locator('#auth-code').fill(await cloud.mailCode(challenge));await page.getByRole('button',{name:'确认并登录',exact:true}).click();}
  await until(async()=>{const s=await nativeState();return s.loggedIn&&s.standalone&&!s.loading&&s.rows.length===0&&s.draft===''&&s.modelId==='';},'new account isolation');
  await screenshot('second-account-isolated',390,false);report.checks.push('native-logout-switch-account-isolates-history-models-draft');
  report.syntheticModelRequests=synthetic.count();assert.equal(report.errors.length,0,JSON.stringify(report.errors));
}
async function capturePhoneComparisons(savedId){
  const current=(await nativeState()).chats.find(c=>c.id===savedId);
  for(const dark of [false,true]){
    await ui('new');await until(async()=>{const s=await nativeState();return s.chatId==='phone-new'&&s.rows.length===0;},'comparison empty');await screenshot('compare-native-empty',390,dark);
    await ui('click',{label:'打开侧栏'});await ui('text',{label:current.title});await ui('input',{text:''});await ui('click',{label:'聊天'});await screenshot('compare-native-content',390,dark);
    await ui('input',{text:'本周计划'});await ui('click',{label:'模型：合成流式模型'});await screenshot('compare-native-menu',390,dark);await ui('text',{label:'合成流式模型'});
  }
  await ui('legacy');await browser.close();browser=null;run('forward','--remove','tcp:'+forward);forward=null;await attach();await page.waitForFunction(()=>WeftPhone.active);
  report.comparisonWebMetrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,header:getComputedStyle(document.querySelector('.brand strong')).fontSize,control:document.querySelector('#menu-button').getBoundingClientRect().width}));
  for(const dark of [false,true]){
    await page.evaluate(()=>{state.conversationId=null;state.chatSource='phone';page('chat');WeftPhone.render();});await screenshot('compare-web-empty',390,dark);
    await page.evaluate(id=>selectConversation(id),savedId);await page.waitForFunction(()=>document.querySelector('.message.assistant'));await page.locator('#draft').fill('');await page.evaluate(()=>{document.querySelector('#draft').blur();updateComposer();});if(!dark)report.comparisonWebTextMetrics=await page.evaluate(()=>{const box=document.querySelector('.message-body'),p=box?.querySelector('p')||box,bubble=document.querySelector('.message.user');return {body:box&&getComputedStyle(box).fontSize,paragraph:p&&getComputedStyle(p).lineHeight,user:bubble&&getComputedStyle(bubble).fontSize,input:getComputedStyle(document.querySelector('#draft')).fontSize};});await screenshot('compare-web-content',390,dark);
    await page.locator('#draft').fill('本周计划');await page.locator('#model-button').click();await screenshot('compare-web-menu',390,dark);await page.keyboard.press('Escape');await page.evaluate(()=>closeModelMenu());
  }
  await ui('nativePreference');await finishProbe();await nativeStart();await until(async()=>{const s=await nativeState();return s.standalone&&!s.loading;},'native entry restored after comparisons');
  report.checks.push('native-and-hybrid-entry-same-account-data-theme-comparisons');
}

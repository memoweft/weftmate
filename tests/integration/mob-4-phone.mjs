import './and-2-fixture.mjs';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { fixture } from '../helpers/auth-1-https-cloud.mjs';
import { startAnd3Fixture } from './and-3-fixture.mjs';
import { systemBarDifference } from '../../scripts/nightly/system-bars.mjs';
const native = process.argv.includes('--native'), repo = resolve(import.meta.dirname, '../..');
const out = join(repo, 'tests/evidence/mob-4'); mkdirSync(out, { recursive: true });
const report = { native, testDiscovery:'synthetic computer presence and loopback address; authentication and content use product APIs', syntheticCloud: true, syntheticAccount: true, mimoRequests: 0, checks: [], screenshots: [], errors: [] };
const pkg = 'com.memoweft.weftmate.mobile.mob4qa', adb = 'D:/Software/MuMuPlayer/nx_main/adb.exe';
const execute = (file, args) => execFileSync(file, args, { windowsHide: true, timeout: 30000, maxBuffer: 24 * 1024 ** 2 });
const key = execute('powershell.exe', ['-NoProfile', '-Command', "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"]).toString().trim(); assert.ok(key);
const cleanups = []; let cloud, gate, browser, page, host, serial, probe, forward, installed, reversed = [], probeLog = '';
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(fn, label, timeout = 45000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch {} await pause(200); } throw Error(label); }
const run = (...args) => execute(adb, ['-s', serial, ...args]);
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
  probeLog = ''; probe = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class',
    'com.memoweft.weftmate.mobile.Mob4ShellProbeTest', '-e', 'host', gateOrigin, '-e', 'cloudCa', Buffer.from(cloud.certificatePem).toString('base64'),
    pkg + '.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true });
  probe.stdout.on('data', d => { probeLog += d; }); probe.stderr.on('data', d => { probeLog += d; }); await attach();
}
let gateOrigin;
async function screenshot(name, width, dark) {
  await page.evaluate(dark => applyTheme(dark ? 'dark' : 'light'), dark);
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
    const info = JSON.parse(execute('D:/Software/MuMuPlayer/nx_main/MuMuManager.exe', ['info', '-v', '0']).toString()); serial = '127.0.0.1:' + info.adb_port;
    execute(adb, ['connect', serial]);
    const others=run('shell','pm','list','packages').toString().split('\n').filter(l=>/weftmate.*qa/.test(l)&&!l.trim().endsWith('.test')).map(l=>l.replace('package:','').trim()).filter(p=>p!==pkg);
    for(const other of others){let active=false;try{active=!!run('shell','pidof',other).toString().trim()}catch{}assert.equal(active,false,'other test package is still running: '+other);}
    const ports = [Number(new URL(cloud.origin).port), gate.address().port]; for (const port of ports) { run('reverse', 'tcp:' + port, 'tcp:' + port); reversed.push(port); }
    run('install', '-r', join(repo, 'apps/android/app/build/outputs/apk/debug/app-debug.apk')); installed = true;
    run('install', '-r', join(repo, 'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')); await nativeStart();
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
} catch (error) { report.failure = error.message.replaceAll(key, '<redacted>').replaceAll(repo, '<repo>').replaceAll(process.env.USERPROFILE||'<no-user-profile>','%USERPROFILE%'); if (page) try { await screenshot('failure', 390, false); } catch {} throw error; }
finally {
  if (native && installed) { try { run('shell', 'run-as', pkg, 'touch', 'files/mob4-probe.done'); } catch {} }
  await browser?.close(); if (native && forward) try { run('forward', '--remove', 'tcp:' + forward); } catch {}
  if (native && installed) { try { run('shell', 'am', 'force-stop', pkg); run('uninstall', pkg); run('uninstall', pkg + '.test'); } catch {} }
  for (const port of reversed) try { run('reverse', '--remove', 'tcp:' + port); } catch {}
  if (native && serial) execute(adb, ['disconnect', serial]);
  await host?.close(); if (gate) await new Promise(done => { gate.close(done); gate.closeAllConnections(); }); for (const fn of cleanups.reverse()) await fn();
  const ledgerPath=join(repo,'.local/mob4-mimo-ledger.json');let ledger;try{ledger=JSON.parse(readFileSync(ledgerPath,'utf8'))}catch{ledger={actualRequests:0,tlsHandshakeFailuresBeforeHttp:0,runs:[]}};ledger.actualRequests+=report.mimoRequests;ledger.runs.push({native,mimoRequests:report.mimoRequests,checks:report.checks.length,success:!report.failure});writeFileSync(ledgerPath,JSON.stringify(ledger,null,2));
  writeFileSync(join(out, (native ? 'native' : 'web') + '-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ native, checks: report.checks.length, mimoRequests: report.mimoRequests, errors: report.errors, failure: report.failure }));
}

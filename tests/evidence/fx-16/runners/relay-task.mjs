/** LG-1b real cloud, isolated host, mobile browser and native Android acceptance. */
import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, connect } from 'node:net';
import { join, resolve, extname } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { _electron, chromium } from 'playwright';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';

const repository = resolve(import.meta.dirname, '../../../..');
const evidence = join(repository, 'tests/evidence/fx-16', optionPhase());
function optionPhase(){const at=process.argv.indexOf('--phase');return at<0?'before':process.argv[at+1]}
const run = randomUUID();
const email = `lg1b-${run}@example.com`, changedEmail = `lg1b-changed-${run}@example.com`;
const password = randomBytes(24).toString('base64url');
const localPassword = randomBytes(24).toString('base64url');
let legacySnapshot;
const resetPassword = randomBytes(24).toString('base64url');
const transientSecrets=new Set([password,resetPassword,localPassword]);
const processOnly=value=>{if(value)transientSecrets.add(value);return value;};
const redact=value=>{let text=String(value);for(const secret of transientSecrets)text=text.replaceAll(secret,'[process-only credential]');return text.replace(/[A-Za-z]:[\\/][^\n]+/g,'[local diagnostic path]');};
const report = { startedAt: new Date().toISOString(), realCloudEntrypoint: 'services/cloud/src/main.mjs',
  realElectronEntrypoint: '.', sourceCommit: execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8',windowsHide:true}).trim(), phase:optionPhase(), baselineHost:optionPhase()==='before', steps: [], cloudTransport: process.platform === 'win32' ? 'WSL Ubuntu' : 'native' };
const profile = await mkdtemp(join(tmpdir(), 'weftmate-fx16-'));
await mkdir(evidence, { recursive: true });
await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const relaySockets=new Set();const cloudSockets=new Set();let infra,infraMeta,relayBridge,relayPort,browserProxy,relayCallback,savedCloudPort;
let cloud, application, browser, cloudRoot, cloudData, mailDirectory, cloudProxy, currentDesktop;
let mobile, instrumentation, debugPort, appInstalled = false, probeInstalled = false;
let instrumentationLog = '', mobileOrigin, originalNightMode;
const device = process.argv.includes('--device');
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const adb = option('--adb', 'D:/Software/MuMuPlayer/nx_main/adb.exe');
const serial = option('--serial', '127.0.0.1:7555');
const packageName = 'com.memoweft.weftmate.mobile.fx9qa';
const adbRun = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, windowsHide: true });
const reversePorts = [];
const surface = device ? 'android' : 'mobile-web';
const pageErrors = [], requests = [], failedRequests = [];
let mainObserverInstalled = false, mainRequestOffset = 0;

async function installMainNetworkObserver() {
  await application.evaluate(({ session }) => {
    globalThis.__lgMainRequests = [];
    session.fromPartition('persist:weftmate-desktop').webRequest.onCompleted(details => {
      const path = new URL(details.url).pathname;
      if (path.startsWith('/personal/v1')) globalThis.__lgMainRequests.push({ path, status: details.statusCode });
    });
  });
  mainObserverInstalled = true;
}
async function collectMainRequests() {
  if (!mainObserverInstalled) return;
  const rows = await application.evaluate((_electron, offset) => globalThis.__lgMainRequests.slice(offset), mainRequestOffset);
  mainRequestOffset += rows.length;
  requests.push(...rows);
  failedRequests.push(...rows.filter(row => row.status >= 400));
}

async function until(check, message, milliseconds = 30000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { await collectMainRequests(); const value = await check(); if (value) return value; await sleep(milliseconds > 60000 ? 1000 : 100); }
  throw new Error(message);
}
async function freePort() {
  const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
function cleanEnvironment() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|CLOUD_)/.test(name) || name === 'ELECTRON_RUN_AS_NODE') delete env[name];
  return env;
}
async function startCloud(hostOrigin) {
  const port = savedCloudPort || await freePort(), origin = `http://127.0.0.1:${port}`;savedCloudPort=port;
  const env = { ...infraMeta.env, CLOUD_HOST: '0.0.0.0', CLOUD_PORT: String(port), CLOUD_MAIL_TRANSPORT: 'file',
    CLOUD_MAIL_FROM: 'test@example.com', CLOUD_ISSUER: `${origin}/personal/v1/cloud/oidc`,
    CLOUD_OIDC_CLIENTS: JSON.stringify([{ client_id: 'weftmate-web', application_type: 'web',
      redirect_uris: [...(relayCallback?[relayCallback+"/personal/v1/ui/"]:[]), `${hostOrigin}/personal/v1/ui/`, `${mobileOrigin}/personal/v1/ui/`] }, { client_id: 'weftmate-android', application_type: 'native', redirect_uris: ['com.memoweft.weftmate:/oauth'] }]) };
  if (process.platform === 'win32') {
    const distro = process.env.WEFTMATE_LG1_WSL_DISTRO || 'Ubuntu';
    const linuxNode = process.env.WEFTMATE_LG1_WSL_NODE || '/tmp/weftmate-s1d-node/bin/node';
    cloudRoot ||= execFileSync('wsl.exe', ['-d', distro, '--exec', 'mktemp', '-d', '/tmp/weftmate-fx16-XXXXXXXX'], { encoding: 'utf8', windowsHide: true }).trim();
    assert.match(cloudRoot, /^\/tmp\/weftmate-fx16-[a-zA-Z0-9]+$/);
    cloudData = cloudRoot;
    mailDirectory = `\\\\wsl.localhost\\${distro}${cloudRoot.replaceAll('/', '\\')}\\mail`;
    const source = execFileSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', repository], { encoding: 'utf8', windowsHide: true }).trim();
    env.CLOUD_DATA_DIR = cloudData; env.CLOUD_MAIL_DIR = `${cloudData}/mail`;
    // Closing stdin terminates only this launcher’s cloud child. No global process matching.
    const launcher = `import {spawn} from 'node:child_process'; const child=spawn(process.execPath,[${JSON.stringify(`${source}/services/cloud/src/main.mjs`)}],{stdio:['ignore','inherit','inherit']}); process.stdin.resume(); process.stdin.on('end',()=>child.kill('SIGTERM')); child.on('exit',code=>process.exit(code??1));`;
    cloud = spawn('wsl.exe', ['-d', distro, '--exec', 'env', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), linuxNode, '--input-type=module', '-e', launcher], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: cleanEnvironment() });
    // WSL localhost forwarding is disabled on some Windows machines. A byte-only
    // loopback bridge keeps the public issuer and host verification unchanged.
    const linuxAddress = execFileSync('wsl.exe', ['-d', distro, '--exec', 'hostname', '-I'], { encoding: 'utf8', windowsHide: true }).trim().split(/\s+/)[0];
    assert.match(linuxAddress, /^\d+\.\d+\.\d+\.\d+$/);
    cloudProxy = createServer(socket => {cloudSockets.add(socket);socket.on("close",()=>cloudSockets.delete(socket));
      const upstream = connect(port, linuxAddress);
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise(done => cloudProxy.listen(port, '127.0.0.1', done));
  } else {
    cloudRoot = await mkdtemp(join(tmpdir(), 'weftmate-fx16-cloud-')); cloudData = cloudRoot;
    mailDirectory = join(cloudRoot, 'mail'); env.CLOUD_DATA_DIR = cloudRoot; env.CLOUD_MAIL_DIR = mailDirectory;
    cloud = spawn(process.execPath, [join(repository, 'services/cloud/src/main.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...cleanEnvironment(), ...env } });
  }
  let started = false, failed = false;
  let cloudDiagnostics=''; cloud.stderr.on('data',value=>{ cloudDiagnostics += value; });
  createInterface({ input: cloud.stdout }).on('line', line => {
    try { const event = JSON.parse(line); if (event.event === 'service.started') started = true; if (event.event === 'service.start_failed') failed = true; } catch { /* provider diagnostics */ }
  });
  await until(() => { if (failed || cloud.exitCode !== null) throw Error('Real cloud entrypoint failed to start: '+cloudDiagnostics); return started; }, 'Real cloud readiness timeout', 30000);
  const health = await fetch(`${origin}/healthz`); assert.equal(health.status, 200); await health.text();
  report.steps.push('Real cloud entrypoint health'); return { origin, issuer: env.CLOUD_ISSUER };
}
async function latestCode(recipient, since) {
  return until(async () => {
    const names = await readdir(mailDirectory).catch(() => []);
    const messages = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => readFile(join(mailDirectory, name), 'utf8').then(JSON.parse)));
    const message = messages.filter(value => value.to === recipient && Date.parse(value.createdAt) >= since && /\b\d{6}\b/.test(value.text)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return processOnly(message?.text.match(/\b\d{6}\b/)?.[0]);
  }, 'File mail verification code timeout');
}
function observe(page) {
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed',request=>console.error(JSON.stringify({event:'request.failed',path:new URL(request.url()).pathname,error:request.failure()?.errorText})));
  page.on('console',message=>{if(message.type()==='error')console.error(message.text().replace(/http:\/\/127\.0\.0\.1:\d+/g,'[loopback]'));});
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/personal/v1')) requests.push({ path: url.pathname, status: response.status() });
    if (url.pathname.startsWith('/personal/v1') && response.status() >= 400) {
      failedRequests.push({ path: url.pathname, status: response.status() });response.json().then(b=>{(report.httpErrors ||= []).push({path:url.pathname,status:response.status(),code:b.error?.code||b.error});}).catch(()=>{});
    }
  });
}
const button = (page, name) => page.getByRole('button', { name: name === '新对话' && page===currentDesktop ? /^(新对话|新旁聊) Ctrl N$/ : name, exact: true }).filter({ visible: true });
const field = (page, name) => page.getByLabel(name, { exact: true }).filter({ visible: true });
async function click(page, locator) {
  if (!device || page === currentDesktop) return locator.click();
  await locator.waitFor({state:'visible'}); await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox(); assert.ok(box);
  const dpr = await page.evaluate(() => devicePixelRatio);
  adbRun('shell','input','tap',String(Math.round((box.x+box.width/2)*dpr)),String(Math.round((box.y+box.height/2+24)*dpr)));
  await sleep(180);
}
async function fill(page, locator, value) {
  if (!device || page === currentDesktop) return locator.fill(value);
  await locator.evaluate((node,text)=>{node.value=text;node.dispatchEvent(new Event('input',{bubbles:true}));},value);
}
async function shot(page, name, theme, scene) {
  if(!process.argv.includes('--review'))scene=null;
  await sleep(400); await page.evaluate(()=>document.fonts.ready);
  const visual=await page.evaluate(()=>{
    const primary=[...document.querySelectorAll('.primary')].find(node=>node.offsetWidth&&node.offsetHeight);
    const luminance=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(value=>Number(value)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
    const style=primary?getComputedStyle(primary):null,fg=style?luminance(style.color):null,bg=style?luminance(style.backgroundColor):null;
    return {horizontalOverflow:document.documentElement.scrollWidth>innerWidth,primaryContrast:style?Math.round((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)*100)/100:null};
  });assert.equal(visual.horizontalOverflow,false,'Phone has horizontal overflow');
  if(visual.primaryContrast!==null)assert.ok(visual.primaryContrast>=4.5,'Primary text contrast below 4.5');
  (report.visualChecks ||= []).push({name,theme,...visual});
  const generatedAt = new Date().toISOString(), timestamp = generatedAt.replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
  const filename = scene ? `review-${surface}-${scene}-${theme}-${timestamp}` : `${surface}-${name}-${theme}`;
  if (device) await writeFile(join(evidence,filename+'.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:12*1024*1024,windowsHide:true}));
  else await page.screenshot({path:join(evidence,filename+'.png'),animations:'disabled'});
  if(scene) await writeFile(join(evidence,filename+'.json'),JSON.stringify({platform:surface,scene,theme,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8',windowsHide:true}).trim(),generatedAt,synthetic:true,source:'隔离真实云登录与原生手机验收'},null,2)+'\n');
}
async function systemThemeShots(page,name,scene) {
  for(const theme of ['dark','light']) {
    if(device) { adbRun('shell','cmd','uimode','night',theme==='dark'?'yes':'no'); await sleep(500); }
    else await page.emulateMedia({colorScheme:theme});
    try { await until(()=>page.evaluate(t=>document.documentElement.dataset.theme===t,theme),'Theme did not apply'); }
    catch(error){
      const diagnostic=await page.evaluate(async()=>({appearance:state.appearance,nativeSystemDark:state.nativeSystemDark,dataset:document.documentElement.dataset.theme,mediaDark:matchMedia('(prefers-color-scheme: dark)').matches,native:window.weftNative?await call('settings.appearance'):null}));
      console.error(JSON.stringify({event:'theme.diagnostic',expected:theme,...diagnostic}));throw error;
    }
    await shot(page,name,theme,scene);
  }
}
async function login(page,recipient,secret) {
  await page.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
  await fill(page,field(page,'邮箱'),recipient);await fill(page,field(page,'密码'),secret);await click(page,button(page,'登录'));
}
async function confirmMail(page, recipient, since) {
  await field(page, '验证码').waitFor(); await fill(page,field(page,'验证码'),await latestCode(recipient,since));
  await click(page,button(page,'验证'));
}
async function openSettings(page,tab) {
  if(page===currentDesktop || !device && await page.locator('#assistant-view').isVisible().catch(()=>false)) {
    if(await button(page,tab).count()){await click(page,button(page,tab));return;}
    if(await button(page,'设置').count())await click(page,button(page,'设置'));
    else{await click(page,button(page,'账户菜单'));await click(page,button(page,'设置'));}
    await click(page,button(page,tab));return;
  }
  if(!device && !await button(page,'设置与账户').count() && await button(page,'切换会话侧栏').count())await button(page,'切换会话侧栏').click();
  if(await button(page,'设置与账户').count())await click(page,button(page,'设置与账户'));
  const exact=button(page,tab);
  if(await exact.count() && await page.evaluate(()=>state.page!=='settings'))await click(page,exact);
  else await click(page,page.getByRole('button',{name:new RegExp('^'+tab+'(?:\\s|$)')}).filter({visible:true}).last());
}
async function startMobileWeb(hostOrigin) {
  const assets=join(repository,'apps/mobile-ui/www');
  browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-features=LocalNetworkAccessChecks']});mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  // Only immutable built UI assets are supplied here. All auth/cloud/host calls
  // keep the real host origin and use real fetch, cookies, DPoP and cloud mail.
  await mobile.route(hostOrigin+'/mobile-ui/**',async route=>{
    try {
      const path=new URL(route.request().url()).pathname.slice('/mobile-ui'.length);
      const file=resolve(assets,'.'+(path==='/'?'/index.html':path));
      if(!file.startsWith(assets+'\\')&&!file.startsWith(assets+'/'))return route.fulfill({status:404});
      await route.fulfill({status:200,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'}[extname(file)]||'application/octet-stream',body:await readFile(file)});
    }catch{await route.fulfill({status:404});}
  });
  observe(mobile);await mobile.goto(hostOrigin+'/mobile-ui/');
}
async function startAndroid(hostOrigin,configuration) {
  const apk=option('--apk'),probe=option('--probe-apk');assert.ok(apk&&probe,'--device requires isolated --apk and --probe-apk');
  const installed=adbRun('shell','pm','list','packages');
  assert.ok(!installed.includes(packageName),'Isolated LG-1b package already installed');
  assert.deepEqual(adbRun('shell','ps','-A').split('\n').filter(row=>row.includes('weftmate')),[],'MuMu occupied by another WeftMate application');
  originalNightMode=adbRun('shell','cmd','uimode','night').trim().split(/:\s*/).at(-1);
  adbRun('install',apk);appInstalled=true;adbRun('install',probe);probeInstalled=true;
  for(const port of [new URL(hostOrigin).port,new URL(configuration.origin).port]){adbRun('reverse',`tcp:${port}`,`tcp:${port}`);reversePorts.push(port);}
  instrumentation=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','class','com.memoweft.weftmate.mobile.Fx9WebViewProbeTest','-e','lg1bProbe','1','-e','lg1bHostOrigin',hostOrigin,`${packageName}.test/androidx.test.runner.AndroidJUnitRunner`],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  instrumentation.stdout.on('data',v=>{instrumentationLog+=v;});instrumentation.stderr.on('data',v=>{instrumentationLog+=v;});
  const pid=await until(()=>{try{return adbRun('shell','pidof',packageName).trim();}catch{return false;}},'Native activity did not start');
  debugPort=await freePort();adbRun('forward',`tcp:${debugPort}`,`localabstract:webview_devtools_remote_${pid}`);
  await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).some(row=>row.url.includes('appassets'));}catch{return false;}},'Native CDP unavailable');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{noDefaults:true});mobile=browser.contexts()[0].pages().find(row=>row.url().includes('appassets'));assert.ok(mobile);observe(mobile);
  await mobile.exposeFunction('__lgNativeReceipt', row=>{requests.push(row);if(row.status>=400)failedRequests.push(row);});
  await mobile.exposeFunction('__lgNativeError', row=>{(report.nativeErrors ||= []).push(row);});
  const instrumentNative=()=>{
    if(globalThis.__lgNativeObserved)return;globalThis.__lgNativeObserved=true;
    const original=androidBridge.call.bind(androidBridge);
    androidBridge.call=async function(method,params,...rest){
      try {
        const result=await original(method,params,...rest);
        if(method==='cloud.app.request')await globalThis.__lgNativeReceipt({path:new URL(params.url).pathname,status:result.status});
        return result;
      }catch(error){
        if(method==='cloud.app.request')await globalThis.__lgNativeReceipt({path:new URL(params.url).pathname,status:error.status||0});
        else await globalThis.__lgNativeError({method,errorCode:/^[A-Z][A-Z0-9_]{0,127}$/.test(error.message||'')?error.message:'OPERATION_FAILED',status:Number(error.status)||0});
        throw error;
      }
    };
  };
  await mobile.addInitScript("document.addEventListener('DOMContentLoaded',"+instrumentNative.toString()+",{once:true});");
  await mobile.evaluate(instrumentNative);
}
async function prepareLegacy() {
  const root=join(profile,'personal-access');
  const service=await createPersonalAccessService({root,port:0,backend:{getStatus:async()=>({runtime:'ready'}),listModels:async()=>[],preflight:async()=>({ok:true}),createSession:async({sessionId})=>({sessionId}),sendMessage:async()=>({}),cancelSession:async()=>({}),readEvents:async({afterSeq})=>({events:[],nextSeq:afterSeq,hasMore:false}),describeSession:async()=>null}});
  try {
    const {origin}=await service.start(),grant=(await service.issueSetupGrant()).grant;
    const response=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({grant,username:'fx9-local',password:localPassword,deviceName:'合成旧电脑'})});
    assert.equal(response.status,201);await response.json();
  } finally {await service.close();}
  legacySnapshot=JSON.parse(await readFile(join(root,'store.json'),'utf8'));
  await writeFile(join(root,'legacy-preserved.txt'),'FX9_LEGACY_DATA_UNCHANGED');
  report.legacy={ownerId:legacySnapshot.legacyOwnerId,hostId:legacySnapshot.hostId};
}
async function bindLegacyDesktop() {
  const page=currentDesktop;
  await button(page,'离线使用这台电脑').click();
  await field(page,'本地账户名').fill('fx9-local');await field(page,'离线密码').fill(localPassword);
  await button(page,'登录').click();await button(page,'新对话').waitFor();
  await openSettings(page,'账户');await button(page,'绑定 WeftMate 账号').click();
  const since=Date.now();await login(page,email,password);await confirmMail(page,email,since);
  await page.getByText('已绑定 WeftMate 账号',{exact:true}).filter({visible:true}).waitFor({timeout:90000});
  await page.screenshot({path:join(evidence,'desktop-legacy-bound.png')});await page.keyboard.press('Escape');
  const stored=JSON.parse(await readFile(join(profile,'personal-access','store.json'),'utf8'));
  const owner=legacySnapshot.legacyOwnerId;
  report.legacy.preserved=stored.legacyOwnerId===owner&&stored.hostId===legacySnapshot.hostId&&
    JSON.stringify(stored.accounts[owner].account.password)===JSON.stringify(legacySnapshot.accounts[owner].account.password)&&
    Object.keys(legacySnapshot.accounts[owner].devices).every(id=>stored.accounts[owner].devices[id])&&
    await readFile(join(profile,'personal-access','legacy-preserved.txt'),'utf8')==='FX9_LEGACY_DATA_UNCHANGED';
  assert.equal(report.legacy.preserved,true);
}
async function secondDesktopAttempt() {
  const page=currentDesktop;
  const before=await page.evaluate(async()=>({me:await(await fetch('/personal/v1/auth/me')).json(),status:await(await fetch('/personal/v1/status')).json()}));
  const secondEmail=`fx9-second-${run}@example.com`,secondPassword=processOnly(randomBytes(24).toString('base64url'));
  const config=await page.evaluate(async()=>await(await fetch('/personal/v1/cloud/config')).json());
  const cloudBase=config.issuer.slice(0,-5),origin=new URL(page.url()).origin;
  const registration=async(path,body)=>{const result=await fetch(cloudBase+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(result.status,200);return result.json()};
  const since=Date.now(),challenge=await registration('/auth/registration/request',{email:secondEmail});
  const verified=await registration('/auth/registration/verify',{challengeId:challenge.challengeId,code:await latestCode(secondEmail,since)});
  await registration('/auth/registration/complete',{passwordTicket:verified.passwordTicket,password:secondPassword});
  await openSettings(page,'账户');await button(page,'退出登录').click();await page.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();await page.reload();
  const loginAt=Date.now();await login(page,secondEmail,secondPassword);await confirmMail(page,secondEmail,loginAt);await button(page,'新对话').waitFor({timeout:90000});
  const second=await page.evaluate(async()=>{
    const me=await(await fetch('/personal/v1/auth/me')).json(),status=await(await fetch('/personal/v1/status')).json();
    const action=await fetch('/personal/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},
      body:JSON.stringify({requestId:crypto.randomUUID(),kind:'desktop.open_app',targetDeviceId:status.hostId,appId:'notepad'})});
    return {ownerId:me.account.ownerId,executionAccount:status.executionAccount,actionStatus:action.status,
      sessions:(await(await fetch('/personal/v1/sessions')).json()).sessions.length,text:document.body.innerText};
  });
  report.secondAccount={isolated:second.ownerId!==before.me.account.ownerId,executionAccount:second.executionAccount,actionStatus:second.actionStatus,visibleExplanation:second.text.includes('这台电脑已有执行账号'),privateSessions:second.sessions};
  assert.equal(report.secondAccount.isolated,true);assert.equal(second.executionAccount,false);assert.equal(second.actionStatus,403);
  if(!report.secondAccount.visibleExplanation){report.issues??=[];report.issues.push({id:'restricted-account-explanation-missing',visible:false});}assert.equal(second.sessions,0);
  await page.screenshot({path:join(evidence,'desktop-second-account-limited.png')});
  await openSettings(page,'账户');await button(page,'退出登录').click();await page.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
  const again=Date.now();await login(page,email,password);await until(async()=>await field(page,'验证码').isVisible().catch(()=>false)||await button(page,'新对话').isVisible().catch(()=>false),'Original login did not advance',60000);if(await field(page,'验证码').isVisible())await confirmMail(page,email,again);await until(async()=>{if(await button(page,'新对话').isVisible())return true;const allow=button(mobile,'允许');if(await allow.isVisible().catch(()=>false)){await allow.click();report.secondAccount.originalDesktopApprovedFromPhone=true;const delivery=mobile.getByRole('dialog',{name:'可信交付',exact:true});await delivery.waitFor({state:'visible',timeout:10000}).catch(()=>{});if(await delivery.isVisible().catch(()=>false))await delivery.getByRole('button',{name:'关闭',exact:true}).click();}return false;},'Original desktop did not receive phone approval',90000);
  const original=await page.evaluate(async()=>({me:await(await fetch('/personal/v1/auth/me')).json(),status:await(await fetch('/personal/v1/status')).json()}));
  assert.equal(original.me.account.ownerId,before.me.account.ownerId);assert.equal(original.status.executionAccount,true);
  report.secondAccount.originalExecutionRetained=true;const remaining=mobile.getByRole('dialog',{name:'可信交付',exact:true});if(await remaining.isVisible().catch(()=>false))await remaining.getByRole('button',{name:'关闭',exact:true}).click();
}
async function mobileRegistration() {
  await click(mobile,button(mobile,'还没有账号？注册'));
  for(const title of ['服务条款','隐私政策']) {
    await click(mobile,button(mobile,`《${title}》`));const reader=mobile.getByRole('dialog',{name:title,exact:true});await reader.waitFor();
    assert.ok((await reader.innerText()).includes('WeftMate'));await click(mobile,reader.getByRole('button',{name:'关闭',exact:true}));
  }
  await fill(mobile,field(mobile,'邮箱'),email);const since=Date.now();await click(mobile,button(mobile,'发送验证码'));
  const resend=mobile.getByRole('button',{name:/秒后可重发/});await resend.waitFor();assert.equal(await resend.isDisabled(),true);
  await confirmMail(mobile,email,since);await fill(mobile,field(mobile,'设置密码'),password);await fill(mobile,field(mobile,'确认密码'),password);
  assert.ok(await field(mobile,'设备名称').inputValue());await fill(mobile,field(mobile,'设备名称'),'合成手机');await click(mobile,button(mobile,'完成注册'));
  await until(()=>mobile.evaluate(()=>!!WeftMobileCloud.core.state.cloudAuth.sub),'Mobile cloud registration did not finish');report.steps.push('Mobile registration, real file mail, sixty-second resend deadline and bundled legal reading');
}
async function approveMobile() {
  const desktop=currentDesktop;
  if(await button(desktop,'← 返回对话').count()) await button(desktop,'← 返回对话').click();
  await button(desktop,'允许').first().click();if(optionPhase()==='legacy'){await button(mobile,'设置与账户').waitFor({timeout:60000});report.steps.push('Legacy local desktop approves the real pending host device; phone exchanges its own cloud session');return;}const dialog=desktop.getByRole('dialog',{name:'可信交付',exact:true});await dialog.waitFor();
  const material=processOnly(await dialog.getByRole('textbox',{name:'可信交付码',exact:true}).inputValue());assert.match(material,/^wmt1\./);
  await fill(mobile,field(mobile,'已登录设备的可信交付码'),material);await click(mobile,button(mobile,'接收可信交付'));
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();if(relayCallback)await mobile.locator('#assistant-view').waitFor();else await until(async()=>await button(mobile,'设置与账户').isVisible().catch(()=>false)||await mobile.locator('#chat-page').isVisible().catch(()=>false)||await mobile.locator('#assistant-view').isVisible().catch(()=>false),'Approved phone did not enter its conversation');
  report.steps.push('Real desktop approves the waiting phone and recipient imports trusted host delivery');
}
async function nativeDeviceActions() {
  await openSettings(mobile,'设备');
  const current=mobile.getByRole('group',{name:'合成手机',exact:true});
  await click(mobile,current.getByRole('button',{name:'改名',exact:true}));
  await fill(mobile,field(mobile,'设备名称'),'合成手机已改名');await click(mobile,button(mobile,'保存名称'));
  await mobile.getByRole('group',{name:'合成手机已改名',exact:true}).waitFor();
  report.steps.push('Native current-device rename through visible group, field and button names');
  const desktop=currentDesktop;
  await openSettings(desktop,'设备');await button(desktop,'添加设备').click();
  const pairing=field(desktop,'配对码');await pairing.waitFor();
  await until(async()=>!!await pairing.inputValue(),'Desktop did not create one-time pairing material');
  try {
    // One-time pairing material stays in this process and UI input only. No
    // screenshot or report is taken while either pairing input is populated.
    const material=processOnly(await pairing.inputValue());assert.equal(await pairing.evaluate(node=>node.readOnly),true);
    const redemptions=requests.filter(row=>row.path==='/personal/v1/cloud/pairings/redeem'&&row.status===200).length;
    await fill(mobile,field(mobile,'输入电脑的配对码'),material);await click(mobile,button(mobile,'配对连接'));
    await until(()=>requests.filter(row=>row.path==='/personal/v1/cloud/pairings/redeem'&&row.status===200).length>redemptions,'Native pairing did not redeem through the real host');
    if(device){await button(mobile,'设置与账户').waitFor();assert.equal(await mobile.evaluate(()=>state.page),'home');}else await mobile.locator('#assistant-view').waitFor();
    report.steps.push('Native manual pairing redeems real one-time desktop code and adopts host session');
  }finally {
    await mobile.getByLabel('输入电脑的配对码',{exact:true}).evaluate(node=>{node.value='';}).catch(()=>{});
    await button(desktop,'关闭配对码').click();
  }
}
async function mobileEmailChange() {
  await openSettings(mobile,'账户');await click(mobile,button(mobile,'换绑邮箱'));await fill(mobile,field(mobile,'新邮箱'),changedEmail);
  const since=Date.now();await click(mobile,button(mobile,'发送验证码'));await fill(mobile,field(mobile,'验证码'),await latestCode(changedEmail,since));await click(mobile,button(mobile,'确认换绑'));
  await login(mobile,changedEmail,password);await button(mobile,'设置与账户').waitFor();report.steps.push('Email change, real verification mail and remembered-device reauthentication');
}
async function mobileRecovery() {
  await openSettings(mobile,'账户');await click(mobile,button(mobile,'退出登录'));await mobile.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
  await click(mobile,button(mobile,'忘记密码？'));await fill(mobile,field(mobile,'邮箱'),changedEmail);const since=Date.now();await click(mobile,button(mobile,'发送验证码'));await confirmMail(mobile,changedEmail,since);
  await fill(mobile,field(mobile,'新密码'),resetPassword);await fill(mobile,field(mobile,'确认密码'),resetPassword);await click(mobile,button(mobile,'重设密码'));
  await mobile.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();assert.equal(await field(mobile,'邮箱').inputValue(),changedEmail);
  report.steps.push('Recovery changes real cloud password and prefills synthetic email');
  const desktop=currentDesktop;await desktop.reload();await desktop.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();await login(desktop,changedEmail,resetPassword);await button(desktop,'新对话').waitFor();
  const before=Date.now();await login(mobile,changedEmail,resetPassword);await confirmMail(mobile,changedEmail,before);await mobile.getByText('在你已登录的设备上允许这台设备',{exact:true}).waitFor();await approveMobile();
}

try {
  const hostPort=await freePort(),hostOrigin=`http://127.0.0.1:${hostPort}`;
  mobileOrigin=`http://127.0.0.1:${await freePort()}`;
  const wslRoot=execFileSync('wsl.exe',['-d','Ubuntu','--exec','wslpath','-a',repository],{encoding:'utf8',windowsHide:true}).trim();
  infra=spawn('wsl.exe',['-d','Ubuntu','--exec','sh','-lc',`cd '${wslRoot}' && /tmp/weftmate-s1d-node/bin/node tests/evidence/fx-16/runners/relay-infra.mjs`],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  infraMeta=await new Promise((done,reject)=>{const lines=createInterface({input:infra.stdout});lines.once('line',s=>{try{done(JSON.parse(s));}catch(e){reject(e);}});infra.once('exit',()=>reject(Error('infra exited')));});
  const addr=execFileSync('wsl.exe',['-d','Ubuntu','--exec','hostname','-I'],{encoding:'utf8',windowsHide:true}).trim().split(/\s+/)[0];
  relayBridge=createServer(socket=>{relaySockets.add(socket);socket.on("close",()=>relaySockets.delete(socket));const upstream=connect(infraMeta.ports.front,addr);socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.pipe(upstream).pipe(socket);});await new Promise(r=>relayBridge.listen(0,'127.0.0.1',r));relayPort=relayBridge.address().port;
  const configuration=await startCloud(hostOrigin);
  if(optionPhase()==='legacy')await prepareLegacy();
  if(process.argv.includes('--cloud-smoke')) {
    const since=Date.now();const response=await fetch(`${configuration.origin}/personal/v1/cloud/auth/registration/request`,{method:'POST',headers:{origin:hostOrigin,'content-type':'application/json'},body:JSON.stringify({email})});assert.equal(response.status,200);assert.match(await latestCode(email,since),/^\d{6}$/);report.steps.push('Real cloud and file-mail smoke');
  }else {
    const env={...cleanEnvironment(),WEFTMATE_RELAY_ENABLED:"true",WEFTMATE_RELAY_DEVELOPMENT_TLS:"true",WEFTMATE_FRPC_FILE:join(repository,".local/frp/frp_0.71.0_windows_amd64/frpc.exe"),WEFTMATE_RELAY_CA_FILE:"\\\\wsl.localhost\\Ubuntu"+infraMeta.root.replaceAll("/","\\")+"\\cert.pem",QA3_RELAY_PORT:String(relayPort),WEFTMATE_CLOUD_ISSUER:configuration.issuer,WEFTMATE_CLOUD_WEB_CLIENT_ID:'weftmate-web',WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK:'true',WEFTMATE_BASELINE_TRACE:join(profile,'requests.jsonl'),WEFTMATE_FX9_BASELINE:optionPhase()==='before'?'true':'false'};
    application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:[join(repository,'tests/evidence/fx-16/runners/relay-bootstrap.mjs'),'--personal-host',`--access-port=${hostPort}`,`--user-data-dir=${profile}`,'--force-device-scale-factor=1'],env,timeout:90000});
    await installMainNetworkObserver();currentDesktop=await until(()=>application.windows().find(page=>page.url().includes('/personal/v1/ui')),'Desktop main window did not open',90000);observe(currentDesktop);await currentDesktop.evaluate(async()=>fetch('/personal/v1/onboarding',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({step:'first',completed:true})}));await currentDesktop.reload();await currentDesktop.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
    await application.evaluate(({ipcMain},origin)=>{ipcMain.removeHandler('wm:desktop:identity');ipcMain.handle('wm:desktop:identity',()=>({deviceName:'合成电脑',localOrigin:origin,clientId:'weftmate-web'}));},hostOrigin);
    await currentDesktop.reload();await currentDesktop.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
    if(device) await startAndroid(hostOrigin,configuration);else await startMobileWeb(hostOrigin);
    await mobile.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
    assert.equal(await mobile.getByText('配对码',{exact:true}).filter({visible:true}).count(),0);assert.equal(await mobile.getByText('电脑地址',{exact:true}).filter({visible:true}).count(),0);
    await systemThemeShots(mobile,'login','login');await click(mobile,button(mobile,'显示密码'));assert.equal(await field(mobile,'密码').getAttribute('type'),'text');await click(mobile,button(mobile,'隐藏密码'));assert.equal(await field(mobile,'密码').getAttribute('type'),'password');
    await login(mobile,`missing-${run}@example.com`,randomBytes(20).toString('base64url'));await mobile.getByRole('alert').filter({hasText:'邮箱或密码'}).waitFor();
    await mobileRegistration();
    if(optionPhase()==='legacy')await bindLegacyDesktop();else {const before=Date.now();await login(currentDesktop,email,password);await confirmMail(currentDesktop,email,before);await button(currentDesktop,'新对话').waitFor();}
    await mobile.reload();await mobile.getByText('在你已登录的设备上允许这台设备',{exact:true}).waitFor();await systemThemeShots(mobile,'waiting');await approveMobile();
    if(device) {
    await openSettings(mobile,'设备');await mobile.getByText(/可执行任务/).filter({visible:true}).first().waitFor();await systemThemeShots(mobile,'devices');
    const exchanges=requests.filter(row=>row.path==='/personal/v1/auth/cloud-session'&&row.status===200).length;
    await click(mobile,button(mobile,'连接').first());
    await until(()=>requests.filter(row=>row.path==='/personal/v1/auth/cloud-session'&&row.status===200).length>exchanges,'Mobile Connect did not exchange real host session');
    await until(async()=>await button(mobile,'设置与账户').isVisible().catch(()=>false)||await mobile.locator('#assistant-view').isVisible().catch(()=>false),'Connected phone did not enter conversation');

    }
    if(!device)await mobile.goto(hostOrigin+'/personal/v1/ui/');
    if(optionPhase()==='second')await secondDesktopAttempt();
    report.steps.push('Approved phone adopts the real host session before relay login');
    const relay=await until(async()=>{const status=await currentDesktop.evaluate(async()=>await(await fetch('/personal/v1/status')).json());return status.relay?.state==='online'&&status.relay;},'Relay online timeout',90000);
    cloud.stdin.end();await new Promise(r=>cloud.once('exit',r));for(const socket of cloudSockets)socket.destroy();await new Promise(r=>cloudProxy.close(r));relayCallback=relay.baseUrl;await startCloud(hostOrigin);
    const cookies=await mobile.context().cookies();report.cookieDiagnostics=cookies.map(c=>({name:c.name,domain:c.domain,path:c.path}));await browser.close();
    for(let retry=0;retry<30;retry++){report.relayProbe=await new Promise(done=>{const r=httpsRequest({hostname:'127.0.0.1',port:relayPort,servername:new URL(relay.baseUrl).hostname,path:'/personal/v1/status',headers:{host:new URL(relay.baseUrl).hostname,cookie:cookies.map(c=>c.name+'='+c.value).join('; ')},rejectUnauthorized:false},res=>{res.resume();res.on('end',()=>done({status:res.statusCode}));});r.on('error',e=>done({error:e.code}));r.end();});if(report.relayProbe.status===200)break;await sleep(1000);}
    browserProxy=createServer(socket=>{relaySockets.add(socket);socket.on("close",()=>relaySockets.delete(socket));socket.once('data',head=>{const upstream=connect(relayPort,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');const cut=head.indexOf('\r\n\r\n')+4;if(head.length>cut)upstream.write(head.subarray(cut));socket.pipe(upstream).pipe(socket);});socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());});});await new Promise(r=>browserProxy.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({headless:true,channel:'msedge',args:[`--proxy-server=http://127.0.0.1:${browserProxy.address().port}`,'--proxy-bypass-list=127.0.0.1,localhost','--disable-features=LocalNetworkAccessChecks']});
    mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});
    observe(mobile);
    if(process.argv.includes('--ui-debug'))await mobile.route('**/personal/v1/ui/app.js',async route=>{let source=await readFile(join(repository,'src/personal-access-ui/app.js'),'utf8');source=source.replace('ui.loadAttachmentHasher =',`globalThis.__qa4DebugState=()=>({identityGeneration:core.state.identityGeneration,historyGeneration:core.state.historyGeneration,sessions:core.state.sessions.map(s=>({title:s.title,sessionId:s.sessionId,chatId:s.chatId,archived:s.archived})),listed:core.sessionList().map(s=>({title:s.title,sessionId:s.sessionId})),phone:core.phoneConversations().map(r=>({title:core.phoneDisplayTitle(r),id:r.id,boundSession:core.phoneBinding(r.id)?.sessionId})),selectedSessionId:core.state.selectedSessionId,selectedChatId:core.state.selectedChatId,domRows:[...document.querySelectorAll('#session-list button')].map(b=>({label:b.textContent,row:b.closest('[data-session-id]')?.dataset.sessionId}))});ui.loadAttachmentHasher =`);await route.fulfill({status:200,contentType:'text/javascript',body:source});});
    const cloudJar=new Map();await mobile.route(configuration.origin+'/personal/v1/cloud/**',async route=>{const request=route.request(),headers={...request.headers(),cookie:[...cloudJar].map(([k,v])=>k+'='+v).join('; ')};delete headers.host;delete headers['content-length'];const r=await fetch(request.url(),{method:request.method(),headers,body:request.postDataBuffer()||undefined,redirect:'manual'});for(const cookie of r.headers.getSetCookie()){const first=cookie.split(';')[0],i=first.indexOf('=');cloudJar.set(first.slice(0,i),first.slice(i+1));}const h=Object.fromEntries(r.headers);delete h['set-cookie'];await route.fulfill({status:r.status,headers:h,body:Buffer.from(await r.arrayBuffer())});});
    const relayRequests=[];mobile.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/personal/v1'))relayRequests.push({host:new URL(r.url()).hostname,path:new URL(r.url()).pathname});});
    await writeFile(join(evidence,'relay-probe.json'),JSON.stringify(report.relayProbe));
    await mobile.goto(relay.baseUrl+'/personal/v1/ui/');await mobile.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();const relayLoginAt=Date.now();await login(mobile,email,password);await confirmMail(mobile,email,relayLoginAt);await mobile.getByText('在你已登录的设备上允许这台设备',{exact:true}).waitFor();await approveMobile();await mobile.locator('#assistant-view').waitFor();
    report.relay={state:relay.state,realFrp:true,realHAProxy:true,syntheticCAOnly:true,cloudHTTPFixtureCookieTransport:"process cookie jar; cloud identity signatures and relay host requests unchanged",randomFrontPort:true,identity:'fresh real cloud login at exact registered relay origin; desktop approved relay browser',requests:relayRequests};
    await (await import('./android-task-flow.mjs')).run({desktop:currentDesktop,mobile,profile,evidence,report,shot});await writeFile(join(evidence,'requests.jsonl'),await readFile(join(profile,'requests.jsonl')));if(process.argv.includes('--visual-smoke')) report.visualOnly=true;
    else {
      if(device)await nativeDeviceActions();
      await mobileEmailChange();await mobileRecovery();
      await openSettings(mobile,'账户');await click(mobile,button(mobile,'退出所有其他设备'));const logout=mobile.getByRole('dialog',{name:'退出所有其他设备',exact:true});await click(mobile,logout.getByRole('button',{name:'确认',exact:true}));await logout.waitFor({state:'hidden'});
      await currentDesktop.reload();await currentDesktop.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();report.steps.push('Logout other devices revokes real desktop login');
      await click(mobile,button(mobile,'注销账号'));await mobile.getByText('云端账号数据全部删除且不可恢复，本机的对话与记忆仍留在设备上',{exact:true}).waitFor();await fill(mobile,field(mobile,'密码'),resetPassword);await click(mobile,button(mobile,'确认注销'));await mobile.getByRole('heading',{name:'登录 WeftMate',exact:true}).waitFor();
      const cleared=await mobile.evaluate(async()=>{
        if(globalThis.weftNative)return (await call('cloud.app.status')).credentialPresent===false;
        const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('weftmate-cloud-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        if(!database.objectStoreNames.contains('credentials')){database.close();return false;}
        const values=await new Promise((resolve,reject)=>{const request=database.transaction('credentials').objectStore('credentials').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});database.close();return !values.some(value=>value?.refreshToken);
      });assert.equal(cleared,true,'Cloud refresh credential survived account deletion');report.steps.push('Account deletion notice and cleared protected cloud credentials');
    }
    assert.deepEqual(pageErrors,[]);
    if(!device&&!process.argv.includes('--visual-smoke'))for(const path of ['/auth/registration/complete','/auth/recovery/complete','/auth/email/change/confirm','/auth/logout/others','/auth/account/delete'])assert.ok(requests.some(row=>row.path==='/personal/v1/cloud'+path&&row.status===200),'Missing real successful route '+path);
  }
  report.flowCompleted=true;report.passed=!(report.issues?.length);
}catch(error){
  if(mobile)await writeFile(join(evidence,'ui-selection-diagnostic.json'),JSON.stringify(await mobile.evaluate(()=>globalThis.__qa4DebugState?.()??{debugUnavailable:true}).catch(()=>({closed:true})),null,2));
  await mobile?.screenshot({path:join(evidence,'failure-mobile.png')}).catch(()=>{});await currentDesktop?.screenshot({path:join(evidence,'failure-desktop.png')}).catch(()=>{});
  if(mobile) console.error(redact((await mobile.locator('body').innerText()).slice(-1600)));
  if(device)console.error(JSON.stringify({event:'native.errors',errors:report.nativeErrors||[]}));
  report.passed=false;report.error=redact(error.message||error);report.pageErrors=pageErrors.map(redact);report.failedRequests=failedRequests;throw new Error(report.error);
}finally{
  await writeFile(join(evidence,'partial.json'),JSON.stringify(report,null,2));for(const socket of cloudSockets)socket.destroy();for(const socket of relaySockets)socket.destroy();
  await collectMainRequests().catch(()=>{});mainObserverInstalled=false;
  await browser?.close().catch(()=>{});await application?.close().catch(()=>{});
  if(device&&appInstalled){
    try{adbRun('shell','run-as',packageName,'touch','files/lg1b-probe.done');await until(()=>instrumentation?.exitCode!==null,'Probe cleanup timeout',15000);}catch{}
    if(debugPort)try{adbRun('forward','--remove',`tcp:${debugPort}`);}catch{}
    for(const port of reversePorts)try{adbRun('reverse','--remove',`tcp:${port}`);}catch{}
    for(const name of [...(probeInstalled?[packageName+'.test']:[]),packageName])try{adbRun('uninstall',name);}catch{}
    if(originalNightMode)adbRun('shell','cmd','uimode','night',originalNightMode);
    report.nativeCleanup={applicationRemoved:!adbRun('shell','pm','list','packages',packageName).includes(packageName),reverseRemoved:reversePorts.every(port=>!adbRun('reverse','--list').includes(`tcp:${port}`)),forwardRemoved:!debugPort||!adbRun('forward','--list').includes(`tcp:${debugPort}`),probePassed:/OK \(1 test\)/.test(instrumentationLog),originalNightMode,nightModeRestored:adbRun('shell','cmd','uimode','night').trim().split(/:\s*/).at(-1)===originalNightMode};
  }
  if(cloud&&cloud.exitCode===null){if(process.platform==='win32')cloud.stdin.end();else cloud.kill('SIGTERM');await until(()=>cloud.exitCode!==null,'Cloud cleanup timeout',15000).catch(()=>cloud.kill());}
  browserProxy?.close();infra?.stdin.end();await new Promise(r=>infra&&infra.exitCode===null?infra.once('exit',r):r());await new Promise(r=>relayBridge?relayBridge.close(r):r());
  await new Promise(done=>cloudProxy?cloudProxy.close(done):done());
  report.finishedAt=new Date().toISOString();report.surface=surface;report.realNativeBridge=device;report.locators='visible accessible names and roles';report.requests=[...new Map(requests.filter(row=>!row.path.startsWith('/personal/v1/ui')).map(row=>[row.path+':'+row.status,row])).values()];
  await writeFile(join(evidence,process.argv.includes('--cloud-smoke')?'cloud-smoke.json':`${surface}${process.argv.includes('--visual-smoke')?'-visual':''}-verification.json`),JSON.stringify(report,null,2)+'\n');
  try{await writeFile(join(evidence,'requests.jsonl'),await readFile(join(profile,'requests.jsonl')))}catch{}
  await rm(profile,{recursive:true,force:true});
  if(cloudRoot&&process.platform==='win32'){assert.match(cloudRoot,/^\/tmp\/weftmate-fx16-[a-zA-Z0-9]+$/);execFileSync('wsl.exe',['-d',process.env.WEFTMATE_LG1_WSL_DISTRO||'Ubuntu','--exec','rm','-rf','--',cloudRoot],{windowsHide:true});}else if(cloudRoot)await rm(cloudRoot,{recursive:true,force:true});
}
console.log(JSON.stringify({passed:report.passed,phase:report.phase,phoneTask:report.phoneTask?.passed,evidence:'tests/evidence/fx-9/'+report.phase}));

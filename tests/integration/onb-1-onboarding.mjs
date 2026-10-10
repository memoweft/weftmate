import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer as httpServer } from 'node:http';
import { createServer, connect } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const repository=resolve(import.meta.dirname,'../..'), evidence=join(repository,'tests/evidence/onb-1');
const profile=await mkdtemp(join(tmpdir(),'weftmate-onb-1-'));
await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));await mkdir(evidence,{recursive:true});
let cloud,cloudRoot,cloudData,mailDirectory,cloudProxy,application,browser,page,launchEnv,launchArgs;
const mobilePages=[];
const email=`onb-${randomUUID()}@example.com`, password=`Synthetic-${randomUUID()}!`;
const report={startedAt:new Date().toISOString(),steps:[],realElectron:true,paidUsage:[]};
const cleanEnvironment=()=>{const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('WEFTMATE_')||key.startsWith('MEMOWEFT_')||key==='ELECTRON_RUN_AS_NODE')delete env[key];return env;};
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check,message='Condition timeout',ms=60000){const deadline=Date.now()+ms;while(Date.now()<deadline){const value=await check();if(value)return value;await sleep(150);}throw Error(message);}
async function freePort(){const s=createServer();await new Promise(done=>s.listen(0,'127.0.0.1',done));const port=s.address().port;await new Promise(done=>s.close(done));return port;}
async function startCloud(hostOrigin) {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const env = { CLOUD_HOST: '0.0.0.0', CLOUD_PORT: String(port), CLOUD_MAIL_TRANSPORT: 'file',
    CLOUD_MAIL_FROM: 'test@example.com', CLOUD_ISSUER: `${origin}/personal/v1/cloud/oidc`,
    CLOUD_OIDC_CLIENTS: JSON.stringify([{ client_id: 'weftmate-web', application_type: 'web',
      redirect_uris: [`${hostOrigin}/personal/v1/ui/`] }]) };
  if (process.platform === 'win32') {
    const distro = process.env.WEFTMATE_LG1_WSL_DISTRO || 'Ubuntu';
    const linuxNode = process.env.WEFTMATE_LG1_WSL_NODE || '/tmp/weftmate-s1d-node/bin/node';
    cloudRoot = execFileSync('wsl.exe', ['-d', distro, '--exec', 'mktemp', '-d', '/tmp/weftmate-lg-1a-XXXXXXXX'], { encoding: 'utf8', windowsHide: true }).trim();
    assert.match(cloudRoot, /^\/tmp\/weftmate-lg-1a-[a-zA-Z0-9]+$/);
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
    cloudProxy = createServer(socket => {
      const upstream = connect(port, linuxAddress);
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise(done => cloudProxy.listen(port, '127.0.0.1', done));
  } else {
    cloudRoot = await mkdtemp(join(tmpdir(), 'weftmate-lg-1a-cloud-')); cloudData = cloudRoot;
    mailDirectory = join(cloudRoot, 'mail'); env.CLOUD_DATA_DIR = cloudRoot; env.CLOUD_MAIL_DIR = mailDirectory;
    cloud = spawn(process.execPath, [join(repository, 'services/cloud/src/main.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...cleanEnvironment(), ...env } });
  }
  let started = false, failed = false;
  cloud.stderr.on('data', () => {});
  createInterface({ input: cloud.stdout }).on('line', line => {
    try { const event = JSON.parse(line); if (event.event === 'service.started') started = true; if (event.event === 'service.start_failed') failed = true; } catch { /* provider diagnostics */ }
  });
  await until(() => { if (failed || cloud.exitCode !== null) throw Error('Real cloud entrypoint failed to start'); return started; }, 'Real cloud readiness timeout', 30000);
  const health = await fetch(`${origin}/healthz`); assert.equal(health.status, 200); await health.text();
  report.steps.push('Real cloud entrypoint health'); return { origin, issuer: env.CLOUD_ISSUER };
}
async function latestCode(recipient, since) {
  return until(async () => {
    const names = await readdir(mailDirectory).catch(() => []);
    const messages = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => readFile(join(mailDirectory, name), 'utf8').then(JSON.parse)));
    const message = messages.filter(value => value.to === recipient && Date.parse(value.createdAt) >= since && /\b\d{6}\b/.test(value.text)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return message?.text.match(/\b\d{6}\b/)?.[0];
  }, 'File mail verification code timeout');
}

const model=httpServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/v1/models')res.end(JSON.stringify({data:[{id:'onb-local-fixture'}]}));else{report.unselectedInference=(report.unselectedInference||0)+1;res.writeHead(404).end('{}');}});await new Promise(done=>model.listen(0,'127.0.0.1',done));
const modelAddress=`http://127.0.0.1:${model.address().port}/v1`;
const button=(name,target=page)=>target.getByRole('button',{name,exact:true}).filter({visible:true});
const field=(name,target=page)=>target.getByRole('textbox',{name,exact:true}).filter({visible:true});
async function api(path,body,method=body?'POST':'GET'){return page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken||''},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});}
async function shot(name){
 for(const theme of ['light','dark']){
  await application.evaluate(({nativeTheme},theme)=>{nativeTheme.themeSource=theme},theme);await page.emulateMedia({colorScheme:theme});await until(()=>page.evaluate(theme=>document.documentElement.dataset.theme===theme,theme),'Rendered theme did not match capture');await sleep(300);await page.mouse.move(0,0);
  const png=await application.evaluate(async({desktopCapturer,BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate');const handle=w.getNativeWindowHandle(),id=handle.length===8?handle.readBigUInt64LE().toString():handle.readUInt32LE().toString();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1800,height:1400}});const source=sources.find(s=>s.id.split(':')[1]===id);if(!source||source.thumbnail.isEmpty())throw Error('Native capture missing');return source.thumbnail.toPNG().toString('base64');});
  await writeFile(join(evidence,name.replace(/-light$/,'')+'-'+theme+'.png'),Buffer.from(png,'base64'));
 }
 await application.evaluate(({nativeTheme})=>{nativeTheme.themeSource='light'});await page.emulateMedia({colorScheme:'light'});
}
async function restart(){await application.evaluate(({app})=>app.quit());await application.close();application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:launchArgs,env:launchEnv,timeout:90000});page=await application.firstWindow({timeout:90000});page.setDefaultTimeout(30000);await page.waitForURL('**/personal/v1/ui*');}

try{
 const hostPort=await freePort(),origin=`http://127.0.0.1:${hostPort}`;
 const config=process.argv.includes('--offline')?null:await startCloud(origin);
 const env={...cleanEnvironment(),...(config?{WEFTMATE_CLOUD_ISSUER:config.issuer,WEFTMATE_CLOUD_WEB_CLIENT_ID:'weftmate-web',WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK:'true'}:{})};
 launchEnv=env;launchArgs=['.','--personal-host',`--access-port=${hostPort}`,`--user-data-dir=${profile}`,'--force-device-scale-factor=1'];
 application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:launchArgs,env,timeout:90000});
 page=await application.firstWindow({timeout:90000});page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('UI error:',e.message)});
 await page.waitForURL('**/personal/v1/ui*');
 await page.getByRole('heading',{name:'你好，我是 WeftMate',exact:true}).waitFor();await shot('desktop-welcome-light');
 await button('继续').click();await page.getByRole('heading',{name:'从这台电脑开始',exact:true}).waitFor();await shot('desktop-account-light');
 if(config){
  await button('还没有账号？注册').click();
  await field('邮箱').fill(email);const since=Date.now();await button('发送验证码').click();const code=await latestCode(email,since);
  await field('验证码').fill(code);await button('验证').click();await page.getByLabel('设置密码',{exact:true}).fill(password);await page.getByLabel('确认密码',{exact:true}).filter({visible:true}).fill(password);await field('设备名称').fill('合成引导电脑');await button('完成注册').click();
 }else{
  await button('先离线使用这台电脑').click();await field('账户名').fill('ONBFixture');await page.getByLabel('密码',{exact:true}).filter({visible:true}).fill('synthetic-onb-1-password');await page.getByLabel('确认密码',{exact:true}).filter({visible:true}).fill('synthetic-onb-1-password');await field('这台设备的名称').fill('合成引导电脑');await button('创建账户').click();
 }
 await page.getByText('账户已准备好，可以继续。',{exact:true}).waitFor();await button('继续').click();await page.getByRole('heading',{name:'选一个一起工作的模型',exact:true}).waitFor();await shot('desktop-model-light');
 await restart();await page.getByRole('heading',{name:'选一个一起工作的模型',exact:true}).waitFor();report.steps.push('actual process exit/relaunch restores interrupted model step');
 await page.getByLabel('补充服务地址（可选）',{exact:true}).fill(modelAddress);await button('发现本机 / 局域网模型').click();await button('选择 onb-local-fixture').waitFor();assert.equal(report.unselectedInference||0,0);report.steps.push('read-only discovery; no automatic registration or inference');
 await button('选择 onb-local-fixture').click();await button('测试连接').click();await until(()=>button('保存并使用这个模型').isEnabled());await shot('desktop-discovery-light');
 await button('跳过这步').click();await page.getByRole('heading',{name:'越聊，越了解你',exact:true}).waitFor();await shot('desktop-memory-light');await page.reload();await page.getByRole('heading',{name:'越聊，越了解你',exact:true}).waitFor();report.steps.push('authenticated reload resumes memory step');
 await button('返回').click();await page.getByRole('heading',{name:'选一个一起工作的模型',exact:true}).waitFor();
 const mimo=process.env.MIMO_API_KEY;
 if(mimo){await page.getByLabel('粘贴密钥',{exact:true}).fill(mimo);await button('测试连接').click();await until(()=>button('保存并使用这个模型').isEnabled());await shot('desktop-mimo-check-light');await button('保存并使用这个模型').click();await page.getByText('模型已保存，可以继续。',{exact:true}).waitFor({timeout:120000});}
 await button('继续').click();await button('继续').click();await page.getByRole('heading',{name:'把过去带过来',exact:true}).waitFor();assert.equal(await button('导入历史 · 即将支持').isDisabled(),true);await shot('desktop-import-light');
 await button('继续').click();await page.getByRole('heading',{name:'手机上，随时接着聊',exact:true}).waitFor();await shot('desktop-phone-light');
 if(config){
  await button('生成二维码 / 配对码').click();await page.getByRole('img',{name:'连接这台电脑的二维码',exact:true,includeHidden:true}).waitFor();await page.getByRole('textbox',{name:'手机配对码',exact:true,includeHidden:true}).evaluate(n=>n.style.visibility='hidden');await page.getByRole('img',{name:'连接这台电脑的二维码',exact:true,includeHidden:true}).evaluate(n=>n.style.visibility='hidden');await shot('desktop-pair-light');await page.getByRole('textbox',{name:'手机配对码',exact:true,includeHidden:true}).evaluate(n=>n.style.visibility='');await page.getByRole('img',{name:'连接这台电脑的二维码',exact:true,includeHidden:true}).evaluate(n=>n.style.visibility='');
  const code=await page.getByRole('textbox',{name:'手机配对码',exact:true,includeHidden:true}).inputValue();const qrUrl=origin+'/personal/v1/ui/#pair='+code.slice(4);
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:390,height:844}}),mobile=await context.newPage();mobilePages.push(mobile);mobile.setDefaultTimeout(30000);mobile.on('response',async r=>{if(r.status()>=400)console.log('Phone failure',new URL(r.url()).pathname,r.status(),(await r.json().catch(()=>({})))?.error?.code)});
  await mobile.goto(qrUrl);await field('邮箱',mobile).fill(email);await mobile.getByLabel('密码',{exact:true}).filter({visible:true}).fill(password);let since=Date.now();await button('登录',mobile).click();
  await field('验证码',mobile).fill(await latestCode(email,since));await button('验证',mobile).click();
  await mobile.getByRole('textbox',{name:'输入消息',exact:true}).waitFor({timeout:60000});
  await mobile.screenshot({path:join(evidence,'mobile-web-qr-connected-light.png')});await mobile.emulateMedia({colorScheme:'dark'});await mobile.screenshot({path:join(evidence,'mobile-web-qr-connected-dark.png')});
  // Possession of the one-time QR code is the existing approval path. Also
  // exercise explicit foreground approval for a new device without that code.
  const context2=await browser.newContext({viewport:{width:390,height:844}}),remote=await context2.newPage();remote.setDefaultTimeout(30000);await remote.goto(origin+'/personal/v1/ui/');
  await field('邮箱',remote).fill(email);await remote.getByLabel('密码',{exact:true}).filter({visible:true}).fill(password);since=Date.now();await button('登录',remote).click();
  await field('验证码',remote).fill(await latestCode(email,since));await button('验证',remote).click();await remote.getByRole('heading',{name:'在你已登录的设备上允许这台设备',exact:true}).waitFor();
  await remote.screenshot({path:join(evidence,'mobile-web-pair-waiting-light.png')});await remote.emulateMedia({colorScheme:'dark'});await remote.screenshot({path:join(evidence,'mobile-web-pair-waiting-dark.png')});
  await button(/允许 /).first().click();const trust=page.getByRole('dialog',{name:'可信交付',exact:true});await trust.waitFor();
  const material=await trust.getByRole('textbox',{name:'可信交付码',exact:true}).inputValue();await field('已登录设备的可信交付码',remote).fill(material);await button('接收可信交付',remote).click();
  await trust.getByRole('button',{name:'关闭',exact:true}).click();await remote.getByRole('textbox',{name:'输入消息',exact:true}).waitFor({timeout:60000});
  await remote.screenshot({path:join(evidence,'mobile-web-pair-connected-dark.png')});await remote.emulateMedia({colorScheme:'light'});await remote.screenshot({path:join(evidence,'mobile-web-pair-connected-light.png')});
  report.steps.push('390x844 QR URL: same cloud account, code verification, desktop approval, trusted recipient and connection');
 }

 await button('跳过这步').click();await page.getByRole('heading',{name:'现在，说出第一句话',exact:true}).waitFor();await shot('desktop-first-light');
 if(mimo){
  await button('开始聊天').click();await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
  await button('帮我设一个提醒，先问我提醒内容和时间。').click();assert.match(await field('输入消息').inputValue(),/提醒/);
  await field('输入消息').fill('这是合成验收。不要调用工具，只回复「引导完成」。');await button('发送').click();
  await until(async()=>{const chats=(await api('/chats/main')).body.chat;const value=(await api(`/chats/${chats.chatId}/events?limit=50`)).body;return value.items?.some(row=>row.type==='assistant.message'&&row.data?.text?.includes('引导完成'));},'Real MiMo first response',180000);
  await shot('desktop-first-message-light');report.paidUsage=(await api('/usage')).body.total;report.steps.push('first main chat message sent once to real MiMo and replied');
  await restart();await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'你好，我是 WeftMate',exact:true}).isVisible(),false);report.steps.push('completed installation does not reopen onboarding');
  await button('账户菜单').click();await button('设置').click();await button('重新查看引导').click();await page.getByRole('heading',{name:'你好，我是 WeftMate',exact:true}).waitFor();
  for(let index=0;index<6;index++){await button('跳过这步').click();await page.reload();await page.getByRole('heading',{name:['从这台电脑开始','选一个一起工作的模型','越聊，越了解你','把过去带过来','手机上，随时接着聊','现在，说出第一句话'][index],exact:true}).waitFor();if(index>0){await button('返回').click();await button('跳过这步').click();}}
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,640));await shot('desktop-narrow-first-light');
  await button('跳过这步').click();await page.getByRole('heading',{name:'现在，说出第一句话',exact:true}).waitFor({state:'hidden'});report.steps.push('settings replay; every step skipped, intermediate steps back/forward; narrow 480x640');
 } else { assert.equal(await button('开始聊天').isDisabled(),true);await button('跳过这步').click();await page.getByText('先添加一个模型，就能开始聊天。',{exact:true}).waitFor();report.steps.push('model skip returns to home with configuration hint and chat remains gated'); }
 assert.deepEqual(errors,[]);report.steps.push('fresh-install welcome/account/model/memory/import/phone/first');report.passed=true;
}catch(error){for(const [index,p] of mobilePages.entries()){console.log('Phone visible state',await p.getByRole('heading').allTextContents(),await p.getByRole('alert').allTextContents());await p.screenshot({path:join(evidence,`failure-mobile-${index}.png`)}).catch(()=>{});}await page?.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{
 if(application){await application.evaluate(({app})=>app.quit()).catch(()=>{});await application.close().catch(()=>{});}await browser?.close();
 model.closeAllConnections();await new Promise(done=>model.close(done));
 if(cloud){cloud.stdin.end();await until(()=>cloud.exitCode!==null,'Own cloud process cleanup',15000).catch(()=>cloud.kill());}
 await new Promise(done=>cloudProxy?cloudProxy.close(done):done());
 if(cloudRoot)execFileSync('wsl.exe',['-d','Ubuntu','--exec','rm','-rf','--',cloudRoot],{windowsHide:true});
 await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');await rm(profile,{recursive:true,force:true});
}

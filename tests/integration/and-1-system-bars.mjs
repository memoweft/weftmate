import { execFileSync, spawn } from 'node:child_process';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { systemBarDifference, assertSystemBars } from '../../scripts/nightly/system-bars.mjs';

const adb = 'D:/Software/MuMuPlayer/nx_main/adb.exe', serial = '127.0.0.1:7555', pkg = 'com.memoweft.weftmate.mobile.and1';
const out = new URL('../evidence/and-1/', import.meta.url);
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 15000 });
const delay = ms => new Promise(done => setTimeout(done, ms));
const records = [], forwards = [], reverse = [];
const originalTheme = command('shell', 'cmd', 'uimode', 'night').toString().trim().split(/:\s*/).at(-1);
const originalIme = command('shell', 'settings', 'get', 'secure', 'default_input_method').toString().trim();
const originalNavigation = command('shell', 'cmd', 'overlay', 'list').toString();
const originalRotation = command('shell','settings','get','system','user_rotation').toString().trim();
const originalAccelerometer = command('shell','settings','get','system','accelerometer_rotation').toString().trim();
let browser, probe, fixture, secondFixture, projectionFixture;
await mkdir(out, { recursive: true });
try {
  const packages = command('shell', 'pm', 'list', 'packages', 'weftmate').toString().split('\n').filter(line => line && !line.trim().endsWith('.test') && !line.includes(pkg));
  if (packages.length) throw Error('MuMu is occupied by another test app');
  for (const file of ['debug/app-debug.apk', 'androidTest/debug/app-debug-androidTest.apk']) command('install', '-r', 'apps/android/app/build/outputs/apk/' + file);
  command('shell','pm','clear',pkg);
  command('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
  probe = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.memoweft.weftmate.mobile.SystemBarsProbeTest#inspectBars', pkg + '.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true });
  probe.stdout.on('data', v => process.stdout.write(v)); probe.stderr.on('data', v => process.stderr.write(v));
  let pid;
  for (let i = 0; i < 100; i++) { try { pid = command('shell','pidof',pkg).toString().trim(); if (pid) break; } catch {} await delay(200); }
  const port = command('forward','tcp:0','localabstract:webview_devtools_remote_' + pid).toString().trim(); forwards.push(port);
  for (let i = 0; i < 100; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { noDefaults: true }); break; } catch {} await delay(200); }
  let page;for(let i=0;i<100;i++){page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets'));if(page)break;await delay(100)} page.setDefaultTimeout(15000);page.on('pageerror',error=>console.log('Native page error:',error.message));
  const evaluate=page.evaluate.bind(page);page.evaluate=(...args)=>Promise.race([evaluate(...args),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('AND-1 evaluation exceeded 20 seconds')),20000);timer.unref()})]);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.booted && document.documentElement.dataset.nativeInsets === 'true');
  const info = () => JSON.parse(command('shell','run-as',pkg,'cat','files/and1-window.json').toString());
  const shot = async (scene, theme, expectedPass = true) => {
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); await delay(350);
    const native = info(), png = command('exec-out','screencap','-p');
    const difference = expectedPass ? assertSystemBars(png, { statusHeight: native.statusHeight }) : systemBarDifference(png, { statusHeight: native.statusHeight });
    const dom = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, appearance: state.appearance,
      browserThemeColor: document.querySelector('meta[name="theme-color"]')?.content,
      topbar: document.querySelector('.topbar').getBoundingClientRect().toJSON(),
      composer: document.querySelector('.composer-dock').getBoundingClientRect().toJSON(),
      appPadding: {top:getComputedStyle(document.getElementById('app')).paddingTop,bottom:getComputedStyle(document.getElementById('app')).paddingBottom},
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      safe: Object.fromEntries(['top','right','bottom','left'].map(side => [side, getComputedStyle(document.documentElement).getPropertyValue('--safe-' + side).trim()])) }));
    if (expectedPass && native.darkStatusIcons !== (dom.theme === 'light')) throw Error('Native status icons disagree with the rendered theme: ' + scene);
    if(expectedPass && parseFloat(dom.appPadding.top)*dom.viewport.dpr < native.statusHeight-1)throw Error('Page content overlaps the status bar: '+scene);
    if(native.imeHeight>0 && (parseFloat(dom.appPadding.bottom)!==0 || (dom.composer.bottom*dom.viewport.dpr > native.height-native.imeHeight+2)))throw Error('Keyboard content overlaps or has duplicate bottom insets');
    const file = `android-${scene}-${theme}.png`; await writeFile(new URL(file,out),png);
    records.push({ scene, theme, file, native, dom, difference }); console.log(`${scene}/${theme}: delta=${difference.delta.toFixed(2)} icons=${native.darkStatusIcons?'dark':'light'}`);
  };
  // Actual page and real native bridge: the historical disagreeing theme now synchronizes.
  command('shell','cmd','uimode','night','no'); await page.evaluate(() => applyTheme('dark')); await shot('theme-mismatch-fixed','dark');
  for (const theme of ['light','dark']) { await page.evaluate(theme => applyTheme(theme),theme); await shot('login',theme); }
  fixture = await startTimelineCandidate({ daily: true, logicalMobile: true, goals: true, sidebar: true, interactive: true, historyCount: 0 });
  const hostPort = new URL(fixture.origin).port; command('reverse',`tcp:${hostPort}`,`tcp:${hostPort}`); reverse.push(hostPort);
  const main = (await fixture.request('/chats/main')).chat, host = (await fixture.request('/status')).hostId;
  let seeded = (await fixture.request('/commands', {requestId:crypto.randomUUID(),kind:'chat.message',chatId:main.chatId,targetDeviceId:host,modelProfileId:'local',text:'合成系统栏验证'})).command;
  for(let i=0;i<100&&seeded.state!=='accepted_by_dsh';i++){await delay(20);seeded=(await fixture.request('/commands/'+seeded.commandId)).command;}
  fixture.seedMainHistory(seeded.sessionId,12);
  const account = await page.evaluate(async input => call('auth.login', input), { origin: fixture.origin, ...fixture.credentials, deviceName: 'AND-1 合成手机' });
  // Keep the actual asset-loader page, native bars and preferences. Only host data
  // projections use the repository's deterministic gallery fixture.
  projectionFixture=fixture;
  await page.exposeFunction('__and1Bridge',async request=>{
    const response=await fetch(projectionFixture.mobileUrl+'bridge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
    const data=await response.json();return {id:request.id,ok:!data.error,result:data.result,error:data.error};
  });
  await page.evaluate(async()=>{
    const post=window.weftNative.postMessage.bind(window.weftNative);
    window.weftNative.postMessage=raw=>{
      const request=JSON.parse(raw);
      if(['settings.appearance','events.subscribe','app.ready','app.activity','offline.identity','auth.login'].includes(request.method))return post(raw);
      window.__and1Bridge(request).then(result=>androidBridge.receive(result));
    };
    // The cloud login was captured above; authenticated scenes use the existing host fixture.
    globalThis.WeftMobileCloud={route:()=>false,active:false};
    document.body.classList.remove('cloud-auth-active');document.getElementById('cloud-auth-page').classList.remove('active');
    await boot();await uiCore.selectMainChat();page('chat');
  });
  await page.waitForFunction(()=>state.booted&&state.loggedIn);
  const hiddenNavigation=command('shell','getprop','qemu.hw.mainkeys').toString().trim()==='1';
  for (const mode of hiddenNavigation?['mumu-hidden-navigation']:['threebutton','gestural']) {
    let navigationAvailable=!hiddenNavigation;
    try { if(!hiddenNavigation)command('shell','cmd','overlay','enable-exclusive','--category','com.android.internal.systemui.navbar.'+mode); await delay(500); }
    catch { navigationAvailable=false; }
    if (page.isClosed()) {
      for(let i=0;i<100;i++){page=browser.contexts()[0].pages().find(p=>!p.isClosed()&&p.url().includes('appassets'));if(page)break;await delay(200)}
      await page.waitForFunction(()=>typeof state!=='undefined'&&state.booted);
      await page.evaluate(async()=>{await uiCore.selectMainChat();page('chat')});
    }
    for (const theme of ['light','dark']) {
      await page.evaluate(async theme=>applyAppearancePreference(await call('settings.appearance',{value:theme})),theme);
      await page.evaluate(async () => { closeDrawer();await uiCore.selectMainChat();page('chat'); });
      await shot(mode+'-main',theme);
      await page.evaluate(id=>selectSharedSession(id),fixture.sessionId);await shot(mode+'-side-chat',theme);await page.evaluate(async()=>{await uiCore.selectMainChat();page('chat')});
      await page.getByRole('tab',{name:/^动态(?:，|$)/}).click();await shot(mode+'-activity',theme);
      await page.getByRole('tab',{name:/^目标(?:，|$)/}).click();await shot(mode+'-goals',theme);
      await page.getByRole('tab',{name:/^成果库(?:，|$)/}).click();await shot(mode+'-library',theme);
      await page.evaluate(async () => { await uiCore.selectMainChat();page('chat');openDrawer(); });await shot(mode+'-drawer',theme);await page.evaluate(()=>closeDrawer());
      await page.evaluate(()=>page('settings'));await shot(mode+'-settings',theme);
      await page.evaluate(()=>page('appearance'));await shot(mode+'-appearance',theme);
      await page.evaluate(async()=>{await uiCore.selectMainChat();page('chat')});
      await page.getByRole('button',{name:'搜索主对话',exact:true}).click();await shot(mode+'-search',theme);
      await page.evaluate(()=>{document.querySelector('.main-chat-search button[aria-label="关闭主对话搜索"]')?.click();document.activeElement?.blur()});await page.evaluate(async()=>{await uiCore.selectMainChat();page('chat')});
      await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();await shot(mode+'-bottom-menu',theme);await page.evaluate(()=>closeAttachmentMenu());
      // Synthetic artwork displayed by the real image viewer, with no private image input.
      await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;const ctx=canvas.getContext('2d');ctx.fillStyle='#5594c6';ctx.fillRect(0,0,600,400);ctx.fillStyle='#f7db87';ctx.beginPath();ctx.arc(300,180,80,0,2*Math.PI);ctx.fill();WeftContent.openGallery([{url:canvas.toDataURL(),name:'合成图片'}]);});
      await shot(mode+'-gallery',theme);await page.getByRole('button',{name:'关闭图片画廊',exact:true}).click();await shot(mode+'-gallery-return',theme);
      await page.evaluate(()=>openTimelinePreview(conversationTaskContext(),async()=>({text:'# 合成文件预览\n\n系统栏、安全区与页面颜色验证。'}),'合成预览.md'));await shot(mode+'-file-preview',theme);await page.evaluate(()=>closeResourcePage());
      const keyboard=pkg+'.test/com.memoweft.weftmate.mobile.Ui2vTestIme';command('shell','ime','enable',keyboard);command('shell','ime','set',keyboard);
      await page.locator('#draft').evaluate(n=>n.blur());await delay(200);await page.locator('#draft').click();
      const box=await page.locator('#draft').boundingBox(),scale=await page.evaluate(()=>devicePixelRatio);
      command('shell','input','tap',String(Math.round((box.x+box.width/2)*scale)),String(Math.round((box.y+box.height/2)*scale)));
      for(let i=0;i<30&&info().imeHeight<=0;i++)await delay(200);
      if(info().imeHeight<=0)throw Error('Keyboard evidence requires actual IME insets');await shot(mode+'-keyboard',theme);command('shell','input','keyevent','4');await delay(200);
      await page.evaluate(()=>page('connect'));await shot(mode+'-pairing',theme);
      records.at(-1).navigationAvailable=navigationAvailable;
    }
  }
  for (const system of ['no','yes']) for (const selected of ['light','dark','system']) {
    command('shell','cmd','uimode','night',system);await page.evaluate(async selected=>applyAppearancePreference(await call('settings.appearance',{value:selected})),selected);await delay(300);
    const expected=selected==='dark'||selected==='system'&&system==='yes'?'dark':'light';await shot('appearance-'+selected+'-system-'+system,expected);
  }
  command('shell','cmd','uimode','night','no');
  await page.evaluate(async()=>{await call('settings.appearance',{value:'dark'});applyTheme('dark')});await shot('account-a-saved','dark');
  secondFixture=await startTimelineCandidate({daily:true,logicalMobile:true,goals:true,interactive:true,historyCount:0});
  const secondPort=new URL(secondFixture.origin).port;command('reverse',`tcp:${secondPort}`,`tcp:${secondPort}`);reverse.push(secondPort);
  await page.evaluate(async input=>call('auth.login',input),{origin:secondFixture.origin,...secondFixture.credentials,deviceName:'AND-1 合成账户 B'});
  projectionFixture=secondFixture;await page.evaluate(async()=>{uiCore.resetLogicalSession?.();await boot();page('chat')});await shot('account-b-default','light');
  await page.evaluate(async()=>{await call('settings.appearance',{value:'light'});applyTheme('light')});
  await page.evaluate(async input=>call('auth.login',input),{origin:fixture.origin,...fixture.credentials,deviceName:'AND-1 合成账户 A'});
  projectionFixture=fixture;await page.evaluate(async()=>{uiCore.resetLogicalSession?.();await boot();page('chat')});await shot('account-a-restored','dark');
  await page.evaluate(async()=>{await call('settings.appearance',{value:'system'});applyTheme('system')});
  command('shell','input','keyevent','3');command('shell','cmd','uimode','night','no');command('shell','am','start','-n',pkg+'/com.memoweft.weftmate.mobile.HybridActivity');await delay(500);await shot('background-system-change','light');
  command('shell','settings','put','system','accelerometer_rotation','0');command('shell','settings','put','system','user_rotation','1');await delay(500);await shot('landscape','light');command('shell','settings','put','system','user_rotation','0');
  // Before capture is deliberately retained and must be rejected by the automated metric.
  const before = await import('node:fs/promises').then(fs=>fs.readFile(new URL('before-dark-page-light-native.png',out)));
  records.push({scene:'before',difference:systemBarDifference(before,{statusHeight:31})});
} finally {
  await writeFile(new URL('measurements.json',out),JSON.stringify(records,null,2)+'\n');
  await browser?.close().catch(()=>{});
  if(probe){try{command('shell','run-as',pkg,'touch','files/and1-probe.done');await delay(500)}catch{}if(probe.exitCode===null)probe.kill();}
  for(const port of forwards)try{command('forward','--remove','tcp:'+port)}catch{}
  for(const port of reverse)try{command('reverse','--remove','tcp:'+port)}catch{}
  try{command('shell','settings','put','system','user_rotation',originalRotation);command('shell','settings','put','system','accelerometer_rotation',originalAccelerometer);command('shell','ime','set',originalIme);command('shell','cmd','uimode','night',originalTheme)}catch{}
  const active=/\[x\] (com\.android\.internal\.systemui\.navbar\.\w+)/.exec(originalNavigation)?.[1];if(active)try{command('shell','cmd','overlay','enable-exclusive','--category',active)}catch{}
  if(fixture){await fixture.close();await rm(fixture.root,{recursive:true,force:true});}
  if(secondFixture){await secondFixture.close();await rm(secondFixture.root,{recursive:true,force:true});}
}


// Production Electron shell, real profile API/storage and synthetic images only.
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {managedMkdtempSync,disposeManagedTemp} from '../helpers/managed-temp.mjs';
import {startFixture} from './ux-4-fixture.mjs';
import {feedbackUiSession} from '../helpers/feedback-ui-session.mjs';

const baseline=process.argv.includes('--baseline');
const output=resolve(process.env.WEFTMATE_SETTINGS2_OUTPUT||'.local/evidence/settings-2');
await mkdir(output,{recursive:true});
const profile=managedMkdtempSync('weftmate-settings2-electron-',{prune:false});
const bootstrap=join(profile,'settings2-shell.mjs');
await writeFile(bootstrap,`import {createRequire} from 'node:module';const {app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');app.setName('WeftMate Settings2 Test');app.setAppUserModelId('com.memoweft.weftmate.test.settings2');app.disableHardwareAcceleration();await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
let app,page,fixture;
let sequence=0;
const report={baseline,checks:[],images:[],layouts:[],errors:[]};
const capture=async name=>{
  console.log('capture',name);
  await page.evaluate(async()=>{await document.fonts.ready;for(let n=0;n<2;n++){for(const a of document.getAnimations())if(Number.isFinite(a.effect.getTiming().iterations))a.finish();await new Promise(requestAnimationFrame);}});
  const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'));
};
const open=async id=>{await page.evaluate(id=>WeftSettingsNavigation.open(id),id);await page.locator(`.settings-category[data-category="${id}"]`).waitFor();};
async function launch(){
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  Object.assign(env,{REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-settings2'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.stack));
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.showInactive();win.webContents.setBackgroundThrottling(false);});
  if(baseline)await page.route('**/personal/v1/ui/components/account.js',route=>route.fulfill({body:execFileSync('git',['show','825edad9e:src/personal-access-ui/components/account.js'],{encoding:'utf8',windowsHide:true}),contentType:'text/javascript'}));
  await feedbackUiSession(page,fixture,{native:true});await page.locator('#transcript .message.user,#transcript .main-chat-row').first().waitFor();
  await page.evaluate(()=>WeftReplyMotion.setVisibility(false));
}
const select=async(file)=>{
  await page.locator('#profile-avatar-file').setInputFiles(file);
  await page.waitForFunction(()=>!__feedbackSessionCore.state.avatarChecking);
};
const save=async()=>{await page.locator('#profile-save').click();await page.waitForFunction(()=>!__feedbackSessionCore.state.profileSaving);assert.equal(await page.locator('#profile-error').innerText(),'');};
const avatarVisible=async()=>{
  await page.waitForFunction(()=>{const image=document.querySelector('#profile-avatar-image');return document.querySelector('#profile-status').textContent!=='正在读取资料…'&&!image.hidden&&image.complete&&image.naturalWidth>0;});
  assert.equal(await page.locator('#profile-avatar-image').isVisible(),true);
};
async function motion(name,action){
  const firstFrame=sequence;
  await page.evaluate(()=>{globalThis.__settingsFrames=[];globalThis.__settingsSampling=true;const start=performance.now();const frame=time=>{
    __settingsFrames.push({time:time-start,animations:document.getAnimations().filter(a=>a.playState==='running').map(a=>({target:a.effect.target?.id||a.effect.target?.className,duration:a.effect.getTiming().duration})),visible:[...document.querySelectorAll('.settings-category:not([hidden])')].map(p=>p.dataset.category),dialogs:[...document.querySelectorAll('dialog')].map(d=>({id:d.id,open:d.open,display:getComputedStyle(d).display,opacity:Number(getComputedStyle(d).opacity),direction:getComputedStyle(d).flexDirection,columns:getComputedStyle(d).gridTemplateColumns}))});
    if(time-start<500)requestAnimationFrame(frame);else __settingsSampling=false;
  };requestAnimationFrame(frame);});
  await action();await page.waitForFunction(()=>!__settingsSampling);
  const frames=await page.evaluate(()=>__settingsFrames);await writeFile(join(output,`motion-${name}.json`),JSON.stringify(frames,null,2));
  (report.motionCases??=[]).push({name,firstFrame,lastFrame:sequence-1});return frames;
}
try{
  fixture=await startFixture();await launch();await open('account');
  // Noise forces a genuinely large encoded PNG/JPEG, rather than padding a tiny file.
  const images=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
    const context=canvas.getContext('2d'),pixels=context.createImageData(1024,1024);let seed=17;
    for(let i=0;i<pixels.data.length;i+=4){for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)|0;pixels.data[i+c]=seed>>>24;}pixels.data[i+3]=255;}
    context.putImageData(pixels,0,0);
    const result=[];for(const type of ['image/png','image/jpeg','image/webp'])result.push({type,data:canvas.toDataURL(type,.95).split(',')[1]});
    context.clearRect(0,0,1024,1024);context.fillStyle='#26a67b';context.fillRect(256,256,512,512);
    result.push({type:'image/png',transparent:true,data:canvas.toDataURL().split(',')[1]});return result;
  });
  const files=[];
  for(const [i,image]of images.entries()){
    const path=join(profile,`synthetic-${i}.${image.type.split('/')[1]}`);const bytes=Buffer.from(image.data,'base64');await writeFile(path,bytes);files.push(path);
    if(!image.transparent)assert.ok(bytes.length>128*1024,`${image.type} fixture exceeds old selection limit`);
    report.images.push({type:image.type,sourceBytes:bytes.length,transparent:!!image.transparent});
  }
  if(baseline){await select(files[0]);assert.match(await page.locator('#profile-avatar-status').innerText(),/128 KiB/);assert.equal(await page.locator('#profile-save').isDisabled(),true);await capture('baseline-avatar-rejected');report.checks.push('baseline reproduces >128KiB PNG rejection');}
  else {
    for(const [i,file]of files.entries()){
      await select(file);assert.equal(await page.locator('#profile-avatar-status').innerText(),'新头像待保存。');
      const draft=await page.evaluate(()=>__feedbackSessionCore.state.profileDraftAvatar);assert.ok(Buffer.from(draft.dataBase64,'base64').length<=128*1024);
      await save();const readback=await fixture.request('/auth/me');assert.deepEqual(readback.account.avatar,draft);
      if(images[i].transparent)assert.equal(await page.evaluate(async a=>{const image=new Image();image.src=`data:${a.mimeType};base64,${a.dataBase64}`;await image.decode();const c=document.createElement('canvas'),ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,1,1).data[3];},draft),0);
      await page.getByRole('button',{name:'关闭设置',exact:true}).click();await open('account');
      await avatarVisible();
      report.images[i].storedBytes=Buffer.from(draft.dataBase64,'base64').length;report.images[i].storedType=draft.mimeType;
    }
    const svg=join(profile,'synthetic-avatar.svg');
    const svgSource='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><script>globalThis.__avatarScriptRan=true</script><image href="https://avatar.invalid/private.png"/><rect x="160" y="120" width="320" height="240" fill="#267ea6"/>'+Array.from({length:4000},(_,i)=>`<circle cx="${180+i%80*3}" cy="${140+Math.floor(i/80)%40*4}" r="1" fill="#26a67b"/>`).join('')+'</svg>';
    report.svgSourceBytes=Buffer.byteLength(svgSource);assert.ok(report.svgSourceBytes>128*1024);await writeFile(svg,svgSource);
    const external=[];page.on('request',request=>{if(request.url().includes('avatar.invalid'))external.push(request.url());});
    await select(svg);assert.equal(await page.locator('#profile-avatar-status').innerText(),'新头像待保存。');await save();assert.deepEqual(external,[]);assert.equal(await page.evaluate(()=>globalThis.__avatarScriptRan),undefined);
    const stored=(await fixture.request('/auth/me')).account.avatar;assert.equal(stored.mimeType,'image/webp');
    const pixel=await page.evaluate(async avatar=>{const image=new Image();image.src=`data:${avatar.mimeType};base64,${avatar.dataBase64}`;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d');x.drawImage(image,0,0);return {width:c.width,height:c.height,alpha:x.getImageData(0,0,1,1).data[3]};},stored);
    assert.equal(pixel.alpha,0);assert.ok(pixel.width<=384);assert.equal(pixel.width/pixel.height,4/3);report.checks.push('large PNG/JPEG/WebP and SVG normalize, save, reopen; SVG scripts/external resources inactive; transparency/aspect retained');
    await select({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('broken image')});assert.match(await page.locator('#profile-avatar-status').innerText(),/无法|有效/);assert.deepEqual((await fixture.request('/auth/me')).account.avatar,stored);await avatarVisible();
    await select(files[0]);await page.locator('#profile-cancel').click();assert.equal(await page.locator('#profile-save').isDisabled(),true);assert.deepEqual((await fixture.request('/auth/me')).account.avatar,stored);
    await page.locator('#profile-avatar-file').setInputFiles([]);assert.equal(await page.locator('#profile-save').isDisabled(),true);
    await app.close();app=null;await launch();await open('account');assert.deepEqual((await fixture.request('/auth/me')).account.avatar,stored);await avatarVisible();await capture('avatar-svg-restarted');
    await page.locator('#profile-avatar-remove').click();await save();assert.equal((await fixture.request('/auth/me')).account.avatar,null);report.checks.push('invalid image preserves prior avatar; cancel, empty picker, restart and removal');
    // A real EXIF orientation tag must rotate the decoded image before resizing.
    const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=80;c.getContext('2d').fillRect(0,0,160,80);return c.toDataURL('image/jpeg').split(',')[1];});
    const raw=Buffer.from(jpeg,'base64'),exif=Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000','hex');
    await select({name:'oriented.jpg',mimeType:'image/jpeg',buffer:Buffer.concat([raw.subarray(0,2),exif,raw.subarray(2)])});
    const orientation=await page.evaluate(async()=>{const a=__feedbackSessionCore.state.profileDraftAvatar,i=new Image();i.src=`data:${a.mimeType};base64,${a.dataBase64}`;await i.decode();return [i.naturalWidth,i.naturalHeight];});assert.deepEqual(orientation,[80,160]);
    await page.locator('#profile-cancel').click();report.checks.push('JPEG EXIF orientation retained');
    const smallSvg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="9" fill="#267ea6"/></svg>');
    await select({name:'small-vector.svg',mimeType:'image/svg+xml',buffer:smallSvg});
    const vectorSize=await page.evaluate(async()=>{const a=__feedbackSessionCore.state.profileDraftAvatar,i=new Image();i.src=`data:${a.mimeType};base64,${a.dataBase64}`;await i.decode();return [i.naturalWidth,i.naturalHeight];});
    const vectorAvatar=await page.evaluate(()=>__feedbackSessionCore.state.profileDraftAvatar);
    report.smallSvg={sourcePixels:[24,24],sourceBytes:smallSvg.length,storedPixels:vectorSize,storedBytes:Buffer.from(vectorAvatar.dataBase64,'base64').length,storedType:vectorAvatar.mimeType};
    assert.deepEqual(vectorSize,[384,384],'small vectors rasterize at avatar resolution');await save();assert.deepEqual((await fixture.request('/auth/me')).account.avatar,vectorAvatar);
    await app.close();app=null;await launch();await open('account');await avatarVisible();assert.deepEqual((await fixture.request('/auth/me')).account.avatar,vectorAvatar);await capture('small-svg-restarted');report.checks.push('24px SVG rasterizes at avatar resolution, saves and survives restart');
  }
  await open('personalization');await page.locator('#personalization-preferredName:not(:disabled)').waitFor();await capture(baseline?'baseline-personalization':'personalization');
  if(!baseline){
    const ids=await page.locator('.settings-navigation button').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.category,name:n.textContent})));
    for(const [width,height,zoom]of [[1280,800,1],[900,700,1],[1280,800,1.5],[620,760,1]])for(const theme of ['light','dark']){
      await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);},{width,height,zoom});
      await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);
      for(const {id,name}of ids){await open(id);await capture(`${width}-${zoom}-${theme}-${id}`);const metrics=await page.locator(`.settings-category[data-category="${id}"]`).evaluate(panel=>({scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth,empty:!panel.textContent.trim()}));assert.ok(metrics.scrollWidth<=metrics.clientWidth+1,`${id} overflow at ${width}/${zoom}/${theme}`);assert.equal(metrics.empty,false);report.layouts.push({id,name,width,zoom,theme,...metrics});}
    }
    report.checks.push('all 21 registered settings pages in light/dark, wide/narrow and native 150% zoom');
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(1);w.setContentSize(1280,800);});
    await page.evaluate(()=>{WeftDesktop.setAppearance({theme:'light'});WeftReplyMotion.setPreference('full');});
    const cdp=await page.context().newCDPSession(page),writes=[],screencast=[];
    await mkdir(join(output,'motion-frames'),{recursive:true});
    cdp.on('Page.screencastFrame',event=>{const frame=sequence++;screencast.push({frame,timestamp:event.metadata.timestamp});writes.push(writeFile(join(output,'motion-frames',`${String(frame).padStart(4,'0')}.jpg`),Buffer.from(event.data,'base64')));void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId});});
    await cdp.send('Page.startScreencast',{format:'jpeg',quality:65,maxWidth:1280,maxHeight:800,everyNthFrame:1});
    const navigation=await motion('category',()=>open('personalization'));assert.ok(navigation.some(f=>f.animations.length));
    const summary=page.locator('.settings-editor > summary').filter({hasText:'自定义语气说明'});
    await summary.focus();await motion('editor-open',()=>page.keyboard.press('Enter'));
    await page.locator('#personalization-toneInstructions').fill('先给出结论，再说明理由。'.repeat(30));
    await page.locator('#personalization-fixedInstructions').evaluate(field=>{field.closest('details').open=true;});
    await page.locator('#personalization-fixedInstructions').fill('合成的长期说明。'.repeat(30));
    await capture('long-editors-focused');await summary.focus();await motion('editor-close',()=>page.keyboard.press('Enter'));
    await page.locator('#personalization-fixedInstructions').evaluate(field=>{field.closest('details').open=false;});
    const aligned=await page.locator('.settings-editor > summary').evaluateAll(nodes=>nodes.slice(0,2).map(n=>({left:n.firstElementChild.getBoundingClientRect().left,right:n.lastElementChild.getBoundingClientRect().right})));
    assert.ok(Math.abs(aligned[0].left-aligned[1].left)<1&&Math.abs(aligned[0].right-aligned[1].right)<1);await capture('summaries-aligned');
    await motion('select-open',()=>page.getByRole('combobox',{name:'回复语气',exact:true}).click());await motion('select-close',()=>page.keyboard.press('Escape'));
    await open('connectors');await page.getByRole('tab',{name:'技能',exact:true}).waitFor();await motion('capability-tab',()=>page.getByRole('tab',{name:'技能',exact:true}).click());
    await open('appearance');await motion('advanced-open',()=>page.locator('.appearance-advanced > summary').click());await motion('advanced-close',()=>page.locator('.appearance-advanced > summary').click());
    await open('models');await motion('model-dialog-open',()=>page.locator('#account-model-add').click());
    const exit=await motion('model-dialog-close',()=>page.keyboard.press('Escape'));
    assert.ok(exit.some(f=>f.dialogs.some(d=>d.id==='account-model-dialog'&&!d.open&&d.display!=='none'&&d.opacity>0)),'native overlay paints a visible exit after logical close');
    assert.ok(exit.every(f=>f.dialogs.filter(d=>d.id==='account-model-dialog'&&d.display!=='none').every(d=>d.direction==='column')),'exit preserves the vertical form layout');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'account-model-add','nested dialog restores its trigger focus');
    await motion('rapid-categories',()=>page.evaluate(()=>{for(const id of ['appearance','general','about','personalization'])WeftSettingsNavigation.open(id);}));
    assert.deepEqual(await page.locator('.settings-category:not([hidden])').evaluateAll(nodes=>nodes.map(n=>n.dataset.category)),['personalization']);
    await page.evaluate(()=>WeftReplyMotion.setPreference('reduce'));
    const reduced=await motion('reduced-category',()=>open('general'));assert.ok(reduced.every(f=>f.animations.length===0));
    await page.evaluate(()=>WeftReplyMotion.setPreference('full'));await motion('settings-close',()=>page.getByRole('button',{name:'关闭设置',exact:true}).click());await motion('settings-open',()=>open('personalization'));
    await cdp.send('Page.stopScreencast');await Promise.all(writes);await writeFile(join(output,'screencast.json'),JSON.stringify(screencast,null,2));await cdp.detach();assert.ok(sequence>10);report.motionFrames=sequence;
    report.checks.push('aligned long/empty summaries; keyboard editors; select, capability tab, advanced, model dialog and settings open/close; rapid interruption; reduced motion; continuous screencast');
  }
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;if(page)await capture('failure').catch(()=>{});throw error;}
finally{await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await app?.close();await fixture?.close();disposeManagedTemp(profile,{log(){}});}
console.log(JSON.stringify({checks:report.checks,images:report.images,layouts:report.layouts.length}));

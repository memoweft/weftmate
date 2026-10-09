/** FIX-8: production Electron window, isolated synthetic host and phone records. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from '../../../../tests/integration/timeline-ui-candidate.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
import { syntheticCloudBinding } from '../../../../tests/helpers/synthetic-cloud-binding.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
const before = process.argv.includes('--before');
const baselineRevision = 'f787c3c';
const root = resolve('.'), evidence = join(root, 'tests/evidence/qa-2/legacy');
mkdirSync(evidence, {recursive:true});
const env = {...process.env}, checks = [], errors = [];
function contrast(foreground,background){const luminance=color=>color.match(/\d+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,index)=>sum+n*[.2126,.7152,.0722][index],0);const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
for(const key of Object.keys(env)) if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
for(const theme of ['light','dark']) {
  const cloud=await syntheticCloudBinding();
  const fixture = await startTimelineCandidate({historyCount:110,interactive:true,inlineProgress:true,composer:true,windowChrome:true,daily:true,baseTime:Date.now()-60000});
  const phoneFixture=await startTimelineCandidate({historyCount:0,interactive:true,inlineProgress:true,composer:true,windowChrome:true,daily:true,baseTime:Date.now()-15000});
  fixture.origin=await fixture.restartWithCloud(cloud.configuration);
  checks.push({theme,legacyCloud:await cloud.bind(fixture.request)});
  const conversationId = 'conversation-'+randomUUID();
  await fixture.request('/sync/capabilities',{sharedConversations:1,nativeVersionCode:11});
  await fixture.request('/sync/events',{events:[
    {eventId:'event-'+randomUUID(),conversationId,clientSeq:1,kind:'conversation.created',occurredAt:new Date().toISOString(),payload:{title:'合成手机对话'}},
    {eventId:'event-'+randomUUID(),conversationId,clientSeq:2,kind:'message.created',occurredAt:new Date().toISOString(),payload:{messageId:'message-'+randomUUID(),role:'user',text:'合成手机历史'}},
    {eventId:'event-'+randomUUID(),conversationId,clientSeq:3,kind:'turn.finished',occurredAt:new Date().toISOString(),payload:{turnId:'turn-'+randomUUID(),status:'completed'}},
  ]});
  const profile = mkdtempSync(join(tmpdir(),'weftmate-fix-8-'));
  writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  let app,browser,desktop,closing=false;
  try {
    app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['.','--personal-host','--access-port=0',`--user-data-dir=${profile}`,'--force-device-scale-factor=1'],env,timeout:90000});
    desktop=await app.firstWindow({timeout:90000});
    await desktop.waitForURL(url=>url.pathname.startsWith('/personal/v1/ui'));
    await desktop.route('**/personal/v1/**',async route=>{try{const u=new URL(route.request().url());const response=await route.fetch({url:fixture.origin+u.pathname+u.search,headers:{...route.request().headers(),origin:fixture.origin}});await route.fulfill({response});}catch(error){if(!closing)errors.push(error.message);}});
    const baselineAssets=['ui-core/composer.js','ui-core/phone.js','ui-core/sessions.js','components/messages.js','components/shell.js','components/usage.js','styles.css','native-desktop.css'];
    async function baseline(page){if(before)for(const asset of baselineAssets)await page.route('**/personal/v1/ui/'+asset,route=>route.fulfill({contentType:asset.endsWith('.css')?'text/css':'text/javascript',body:execFileSync('git',['show',`${baselineRevision}:${asset.startsWith('ui-core/')?'src/':'src/personal-access-ui/'}${asset}`],{cwd:root})}));}
    await baseline(desktop);
    await app.evaluate(({BrowserWindow,nativeTheme},theme)=>{nativeTheme.themeSource=theme;BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate').setContentSize(1200,800);},theme);
    const appearance=theme=>localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme,accent:'neutral',fontSize:'15'}));
    await desktop.addInitScript(appearance,theme);await desktop.reload();
    await desktop.getByRole('button',{name:'离线使用这台电脑',exact:true}).click();
    await desktop.getByRole('textbox',{name:'本地账户名',exact:true}).fill(fixture.credentials.username);
    await desktop.getByLabel('离线密码',{exact:true}).filter({visible:true}).fill(fixture.credentials.password);
    await desktop.getByRole('button',{name:'登录',exact:true}).click();
    browser=await chromium.launch({headless:true});
    const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await baseline(phone);
    await phone.addInitScript(appearance,theme);await phone.goto(phoneFixture.origin+'/personal/v1/ui');await localUiSession(phone,phoneFixture.credentials);
    async function shot(page,surface,name){
      const path=join(evidence,`${before?'before':'after'}-${surface}-${theme}-${name}.png`);
      if(surface!=='desktop')return page.screenshot({path});
      const png=await app.evaluate(async({BrowserWindow,desktopCapturer})=>{
        const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate');win.show();win.focus();
        const handle=win.getNativeWindowHandle(),id=handle.length===8?handle.readBigUInt64LE().toString():handle.readUInt32LE().toString();
        const {width,height}=win.getBounds();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width,height}});
        const source=sources.find(s=>s.id.split(':')[1]===id);if(!source||source.thumbnail.isEmpty())throw Error('Native capture unavailable');return source.thumbnail.toPNG().toString('base64');
      });writeFileSync(path,Buffer.from(png,'base64'));
    }
    for(const [surface,page] of [['desktop',desktop],['phone-web',phone]]) {
      page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
      console.log('surface',theme,surface,await page.evaluate(()=>({screen:[...document.querySelectorAll('main > section')].filter(n=>!n.hidden).map(n=>n.id),title:document.getElementById('assistant-title').textContent,send:document.getElementById('send-message').getAttribute('aria-label'),hint:document.getElementById('model-hint').textContent,loginError:document.getElementById('cloud-auth-error')?.textContent})));
      await page.getByRole('button',{name:'停止回复',exact:true}).waitFor();
        await page.getByRole('button',{name:'停止回复',exact:true}).click();
        await page.getByRole('status').filter({hasText:before?'停止请求已提交':'已停止'}).waitFor();
      await shot(page,surface,'stop');
      const presentation=await page.locator('#toast').evaluate(node=>{const s=getComputedStyle(node),t=node.getBoundingClientRect(),c=document.getElementById('message-form').getBoundingClientRect();return {text:node.textContent,color:s.color,background:s.backgroundColor,overlaps:t.left<c.right&&t.right>c.left&&t.top<c.bottom&&t.bottom>c.top};});
      presentation.contrast=contrast(presentation.color,presentation.background);
      checks.push({surface,theme,stop:presentation});
      if(!before){assert.equal(presentation.text,'已停止');assert.equal(presentation.overlaps,false);assert.ok(presentation.contrast>=4.5);}
    }
    await desktop.getByRole('button',{name:'合成手机对话',exact:true}).click();
    await desktop.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
    await shot(desktop,'desktop','phone-conversation');
    await desktop.getByRole('button',{name:'新对话 Ctrl N',exact:true}).click();
    await shot(desktop,'desktop','new-from-phone');
    const state=await desktop.evaluate(()=>({placeholder:document.getElementById('message-text').placeholder,isPhone:document.getElementById('conversation-pane').classList.contains('is-phone'),older:!document.getElementById('load-older').hidden,title:document.getElementById('assistant-title').textContent}));
    checks.push({surface:'desktop',theme,newFromPhone:state});
    if(before){
      await desktop.getByRole('button',{name:'项目进度报告',exact:true}).click();await desktop.keyboard.press('Control+n');
      await desktop.route('**/personal/v1/commands',async route=>{
        const response=await route.fetch({url:fixture.origin+'/personal/v1/commands',headers:{...route.request().headers(),origin:fixture.origin}});const body=await response.json();
        if(body.command?.kind==='session.create'){
          while(['pending','dispatching'].includes(body.command.state)){await new Promise(done=>setTimeout(done,30));body.command=(await fixture.request('/commands/'+body.command.commandId)).command;}
        }
        await route.fulfill({response,json:body});
      });
      const text=`合成普通首条 ${theme}`;await desktop.getByRole('textbox',{name:'输入消息',exact:true}).fill(text);await desktop.getByRole('button',{name:'发送',exact:true}).click();
      await desktop.waitForFunction(()=>!document.getElementById('message-text').value);
      await desktop.getByRole('button',{name:new RegExp('^'+text)}).waitFor();await shot(desktop,'desktop','first-title');
      checks.push({theme,ordinaryFirstTitle:await desktop.evaluate(()=>({title:document.getElementById('assistant-title').textContent,selected:document.querySelector('#session-list .is-current')?.textContent}))});
    }else{
      assert.equal(state.isPhone,false);assert.equal(state.older,false);assert.equal(state.title,'新对话');assert.equal(state.placeholder,'向 WeftMate 说说你的目标');
      await desktop.getByRole('button',{name:'自动',exact:true}).waitFor();assert.equal(await desktop.getByRole('button',{name:'本对话用量',exact:true}).isVisible(),false);
      const input=desktop.getByRole('textbox',{name:'输入消息',exact:true}),first=`合成首条 ${theme}`;
      await input.fill(first);await desktop.getByRole('button',{name:'发送',exact:true}).click();
      await desktop.waitForFunction(()=>!document.getElementById('message-text').value);
      await desktop.getByRole('button',{name:new RegExp('^'+first)}).waitFor();await desktop.waitForFunction(text=>document.getElementById('assistant-title').textContent===text,first);
      assert.equal(await desktop.getByRole('button',{name:'本对话用量',exact:true}).isVisible(),true);
      assert.equal(await desktop.getByRole('button',{name:'加载更早内容',exact:true}).isVisible(),false);
      await shot(desktop,'desktop','first-message');
      await desktop.getByRole('button',{name:'项目进度报告',exact:true}).click();
      await desktop.getByRole('button',{name:'加载更早内容',exact:true}).waitFor();await desktop.getByRole('button',{name:'加载更早内容',exact:true}).press('Enter');
      await desktop.waitForFunction(()=>document.getElementById('load-older').hidden);await shot(desktop,'desktop','switch-history');
      await desktop.getByRole('button',{name:new RegExp('^'+first)}).click();
      await desktop.waitForFunction(text=>document.getElementById('assistant-title').textContent===text,first);
      await desktop.keyboard.press('Control+n');
      assert.equal(await desktop.getByRole('button',{name:'本对话用量',exact:true}).isVisible(),false);
      assert.equal(await desktop.getByRole('button',{name:'加载更早内容',exact:true}).isVisible(),false);await shot(desktop,'desktop','keyboard-new');
      const second=`合成普通桌面对话 ${theme}`;await input.fill(second);await desktop.getByRole('button',{name:'发送',exact:true}).click();
      await desktop.getByRole('button',{name:new RegExp('^'+second)}).waitFor();
      for(let n=1;n<=2;n++){const text=`合成排队 ${n}`;await input.fill(text);await desktop.getByRole('button',{name:'发送',exact:true}).click();await desktop.getByRole('article',{name:`排队任务 ${text}`,exact:true}).waitFor();}
      await desktop.getByRole('button',{name:'停止回复',exact:true}).click();
      await desktop.getByRole('status').filter({hasText:'已停止当前回复，还有 2 条排队消息会继续'}).waitFor();await shot(desktop,'desktop','stop-queued');
      await desktop.getByRole('button',{name:'合成手机对话',exact:true}).click();await desktop.keyboard.press('Control+n');
      assert.equal(await input.getAttribute('placeholder'),'向 WeftMate 说说你的目标');
      checks.push({theme,entries:{phoneToDraft:true,firstSend:true,sessionSwitch:true,historyPagination:true,desktopKeyboardDraft:true,phoneKeyboardDraft:true,usageOnlyForSession:true,queuedStopCount:2}});
      await phone.keyboard.press('Control+n');const phoneInput=phone.getByRole('textbox',{name:'输入消息',exact:true});
      await phoneInput.fill('合成手机网页新回复');await phone.getByRole('button',{name:'发送',exact:true}).click();await phone.waitForFunction(()=>!document.getElementById('message-text').value);
      for(let n=1;n<=2;n++){const text=`合成手机排队 ${n}`;await phoneInput.fill(text);await phone.getByRole('button',{name:'发送',exact:true}).click();await phone.getByRole('article',{name:`排队任务 ${text}`,exact:true}).waitFor();}
      await phone.getByRole('button',{name:'停止回复',exact:true}).click();await phone.getByRole('status').filter({hasText:'已停止当前回复，还有 2 条排队消息会继续'}).waitFor();await shot(phone,'phone-web','stop-queued');
      checks.push({theme,surface:'phone-web',queuedStopCount:2});
    }
    phoneFixture.progress.text('用于复制的合成回复');
    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    if(before)await mobile.route('**/styles.css',route=>route.fulfill({contentType:'text/css',body:execFileSync('git',['show',`${baselineRevision}:apps/mobile-ui/www/styles.css`],{cwd:root})}));
    await mobile.goto(phoneFixture.mobileUrl);await mobile.getByRole('button',{name:before?'项目进度报告':'合成手机排队 2',exact:true}).click();
    await mobile.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await mobile.getByRole('button',{name:'复制回复',exact:true}).last().click();await mobile.getByRole('button',{name:'已复制',exact:true}).waitFor();await shot(mobile,'mobile-ui','copy-toast');
    const copyPresentation=await mobile.getByRole('button',{name:'已复制',exact:true}).evaluate(node=>{const s=getComputedStyle(node),t=node.getBoundingClientRect(),c=document.getElementById('draft').getBoundingClientRect();return {color:s.color,background:s.backgroundColor,overlaps:t.top<c.bottom&&t.bottom>c.top};});
    copyPresentation.contrast=contrast(copyPresentation.color,copyPresentation.background);checks.push({theme,surface:'mobile-ui',copyToast:copyPresentation});
    if(!before){assert.ok(copyPresentation.contrast>=4.5);assert.equal(copyPresentation.overlaps,false);}
    console.log(theme,JSON.stringify(checks.filter(c=>c.theme===theme)));
  } catch(error) {console.error('FIX-8 verification failed:',error.message);console.log('synthetic diagnostics',fixture.operations.slice(-4),await desktop?.evaluate(()=>({title:document.getElementById('assistant-title').textContent,draft:document.getElementById('message-text').value,operation:document.getElementById('operation-status').textContent,transcript:document.getElementById('transcript').textContent.slice(0,160)})));throw error;}
  finally {closing=true;for(const page of app?.windows()||[])await page.unrouteAll({behavior:'ignoreErrors'});await browser?.close();await app?.close();await fixture.close();await phoneFixture.close();await cloud.close();assert.ok(fixture.root.startsWith(join(tmpdir(),'weftmate-m0-3-')));rmSync(fixture.root,{recursive:true,force:true});assert.ok(phoneFixture.root.startsWith(join(tmpdir(),'weftmate-m0-3-')));rmSync(phoneFixture.root,{recursive:true,force:true});assert.ok(profile.startsWith(join(tmpdir(),'weftmate-fix-8-')));rmSync(profile,{recursive:true,force:true});}
}
assert.deepEqual(errors,[]);writeFileSync(join(evidence,before?'before.json':'checks.json'),JSON.stringify({syntheticOnly:true,baselineRevision,before,checks,errors},null,2)+'\n');

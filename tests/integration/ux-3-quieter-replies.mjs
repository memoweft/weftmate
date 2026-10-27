import { evidencePath } from '../helpers/evidence-path.mjs';
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {managedMkdtemp,disposeManagedTemp} from '../helpers/managed-temp.mjs';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
const out=evidencePath('ux-3/quieter-replies');await mkdir(out,{recursive:true});
const report={synthetic:true,modelRequests:0,hiddenProductionDesktop:true,shots:[],checks:[],errors:[]};
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
let fixture,app,browser,profile;
const wait=ms=>new Promise(done=>setTimeout(done,ms));
try{
 const fixtureOptions={daily:true,sidebar:true,inlineProgress:true,historyCount:0,logicalMobile:false,baseTime:Date.now()-15000};
 fixture=await startTimelineCandidate(fixtureOptions);fixture.progress.finish();
 const scenes=[];
 async function scene(key,title,fill,reason='completed'){
  const source=await fixture.newOutputSource(title);await fixture.request(`/sessions/${source.sessionId}/metadata`,{title},'PATCH');
  await fill(source);fixture.progress.finish(reason);await fixture.request(`/sessions/${source.sessionId}/events`);scenes.push({...source,key,title});
 }
 const names=['季度总结-v1.md','季度总结-v2.docx','季度总结-v2.pdf','文件索引.csv','整理说明.txt'];
 await scene('five','整理合成文件',async source=>{
  for(const name of names){const path=join(fixture.root,name);await writeFile(path,'合成成果，供界面验收使用。\n');await fixture.registerOutput(path,source);}
  fixture.progress.text('整理好了，文件都在下面。');
 });
 await scene('single','单个合成成果',async source=>{const path=join(fixture.root,'整理结果.md');await writeFile(path,'# 整理结果\n\n合成文件已整理。\n');await fixture.registerOutput(path,source);fixture.progress.text('整理结果.md 已做好。');});
 await scene('recovered','换办法完成',async()=>{
  fixture.progress.call('grep','synthetic-search',{pattern:'合成关键词'});fixture.progress.result('synthetic-search','No matches (exit code 1)',true);
  fixture.progress.text('我再检查文件名。');fixture.progress.call('pwsh','synthetic-retry',{command:'Write-Output synthetic-complete'});fixture.progress.result('synthetic-retry','已找到合成文件。');fixture.progress.text('已整理完成。');
 });
 await scene('interrupted','中断的合成操作',async()=>{fixture.progress.call('pwsh','synthetic-interrupt',{command:'Write-Output synthetic-job'});fixture.progress.result('synthetic-interrupt','Command interrupted by user (SIGINT).',true);fixture.progress.text('已停止这次操作。');},'aborted');
 await scene('failed','未完成的合成操作',async()=>{fixture.progress.call('write','synthetic-failed',{file_path:'合成输出.md'});fixture.progress.result('synthetic-failed','Synthetic output folder unavailable.',true);fixture.progress.text('输出文件夹暂时不可用。可以指定另一个文件夹，我会接着整理。');},'error');
 await scene('continuing','正在继续的合成操作',async()=>{fixture.progress.call('grep','synthetic-live-search',{pattern:'合成关键词'});fixture.progress.result('synthetic-live-search','No matches.',true);},'unknown');
 profile=await managedMkdtemp('weftmate-ux3-quieter-');
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/ux-3-quieter-desktop-entry.mjs'],env:{...env,UX3_PROFILE:profile,UX3_ORIGIN:fixture.origin,UX3_LIBRARY_TOKEN:fixture.libraryDesktopToken,UX3_THEME:'light'}});
 const desktop=await app.firstWindow();await localUiSession(desktop,fixture.credentials,undefined,{nativeIdentity:{origin:fixture.origin,libraryDesktopToken:fixture.libraryDesktopToken}});
 browser=await chromium.launch({headless:true});
 const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await phone.goto(fixture.mobileUrl);await phone.waitForFunction(()=>state.booted&&state.loggedIn);
 for(const p of [desktop,phone]){p.setDefaultTimeout(15000);p.on('pageerror',error=>report.errors.push(error.message));await p.emulateMedia({reducedMotion:'reduce'});}
 const surfaces=[['desktop',desktop],['phone-390',phone]];
 async function select(p,surface,source){
  if(surface==='desktop'){await p.locator(`.session-row[data-session-id="${source.sessionId}"]`).locator('button').first().click();}
  else await p.evaluate(id=>selectSharedSession(id),source.sessionId);
  await p.waitForFunction(()=>!!document.querySelector('.execution-block,.artifact-summary'));
  const endings={five:'整理好了，文件都在下面。',single:'整理结果.md 已做好。',recovered:'已整理完成。',interrupted:'已停止这次操作。',failed:'输出文件夹暂时不可用。可以指定另一个文件夹，我会接着整理。'};
  if(endings[source.key])await p.getByText(endings[source.key],{exact:true}).waitFor();
 }
 async function shot(p,surface,theme,key){await p.mouse.move(5,5);await wait(350);const file=`${surface}-${theme}-${key}.png`;if(surface.startsWith('desktop')){await app.evaluate(async({BrowserWindow})=>{await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})});await wait(150);const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await writeFile(join(out,file),Buffer.from(png,'base64'));}else await p.screenshot({path:join(out,file)});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,file);report.shots.push({file,surface,theme,systemBars:surface.startsWith('desktop')?'production Electron custom titlebar':'web viewport; native Android system bars not captured'});console.log(file);}
 for(const theme of ['light','dark']){
  for(const [surface,p]of surfaces){await p.evaluate(({surface,theme})=>{if(surface==='desktop')document.documentElement.dataset.theme=theme;else applyTheme(theme);},{surface,theme});
   for(const source of scenes.filter(s=>s.key!=='continuing')){
    await select(p,surface,source);
    if(source.key==='five'){
     await p.getByText('这次整理出 5 个文件',{exact:true}).waitFor();assert.equal(await p.locator('.artifact-summary').count(),1);assert.equal(await p.locator('.artifact-file-row:visible').count(),3);
     await shot(p,surface,theme,'five-collapsed');
     const fold=p.getByRole('button',{name:'还有 2 个',exact:true});await fold.focus();await fold.press('Enter');assert.equal(await p.locator('.artifact-file-row:visible').count(),5);
     await shot(p,surface,theme,'five-expanded');
     const more=p.getByRole('button',{name:'更多操作 季度总结-v2.docx',exact:true});await more.focus();await more.press('Enter');await p.getByRole('menu').waitFor();await shot(p,surface,theme,'file-menu');await p.getByRole('menu').press('Escape');assert.equal(await more.evaluate(node=>node===document.activeElement),true);
     await p.getByRole('button',{name:'收起文件',exact:true}).click();await p.getByRole('button',{name:'打开成果 季度总结-v1.md',exact:true}).click();await p.getByText('合成成果，供界面验收使用。',{exact:false}).first().waitFor();
     if(surface==='desktop')await p.getByRole('button',{name:'收起右侧面板',exact:true}).click();else await p.getByRole('button',{name:'返回对话',exact:true}).click();
     report.checks.push(`${surface} ${theme}: five files / fold / keyboard menu / preview`);
    }else if(source.key==='single'){
     await p.getByText('文件已做好',{exact:true}).waitFor();assert.equal(await p.locator('.artifact-file-row:visible').count(),1);assert.equal(await p.getByRole('button',{name:'还有 2 个',exact:true}).count(),0);await shot(p,surface,theme,'single');
    }else if(source.key==='recovered'){
     await p.getByText(/中途有 1 步重试/).waitFor();assert.equal(await p.locator('.has-failure').count(),0);await shot(p,surface,theme,'recovered');
     const group=p.locator('.execution-block').first();await group.locator('summary').first().click();await p.getByText(/执行失败/).first().waitFor();await shot(p,surface,theme,'recovered-details');
    }else if(source.key==='interrupted'){
     await p.getByText('已中断',{exact:true}).first().waitFor();assert.equal(await p.locator('.has-failure').count(),0);await shot(p,surface,theme,'interrupted');
    }else if(source.key==='failed'){
     await p.locator('.has-failure').waitFor();await p.getByText(/未能完成：/).waitFor();await shot(p,surface,theme,'failed');
    }
    assert.doesNotMatch(await p.locator('body').innerText(),/已读回核验|第 \d+ 步失败/);
   }
  }
 }
 await phone.setViewportSize({width:360,height:780});await select(phone,'phone-360',scenes[0]);await phone.evaluate(()=>applyTheme('dark'));await shot(phone,'phone-360','dark','five-collapsed');await phone.getByRole('button',{name:'还有 2 个',exact:true}).click();await shot(phone,'phone-360','dark','five-expanded');
 await select(desktop,'desktop',scenes[0]);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,780));await shot(desktop,'desktop-480','dark','five-collapsed');
 // Exercise the shared main-chat presentation separately from native side conversations.
 const mainChat=(await fixture.request('/chats/main')).chat,mainGoal='主对话整理合成文件';
 let mainCommand=(await fixture.request('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:mainChat.chatId,modelProfileId:'local',text:mainGoal,targetDeviceId:(await fixture.request('/status')).hostId})).command;
 while(mainCommand.state!=='accepted_by_dsh'){await wait(20);mainCommand=(await fixture.request(`/commands/${mainCommand.commandId}`)).command;}
 const mainSource={sessionId:mainCommand.sessionId,receiptId:mainCommand.receiptId,text:mainGoal};
 fixture.progress.call('grep','main-search',{pattern:'合成关键词'});fixture.progress.result('main-search','No matches.',true);fixture.progress.text('再整理合成文件。');
 for(const name of names){const path=join(fixture.root,`主对话-${name}`);await writeFile(path,'主对话合成成果。');await fixture.registerOutput(path,mainSource);}
 fixture.progress.text('主对话文件已整理完成。');fixture.progress.finish();await fixture.request(`/sessions/${mainSource.sessionId}/events`);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
 await desktop.unroute('**/personal/v1/status');
 await desktop.addInitScript(()=>{let api;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>api,set(value){api=value;const create=value.create;value.create=(...args)=>{const core=create(...args);globalThis.__ux3Core=core;return core;};}});});
 await localUiSession(desktop,fixture.credentials,undefined,{mainChat:true});await desktop.waitForFunction(()=>globalThis.__ux3Core?.state.mainChat?.chatId);await desktop.evaluate(()=>__ux3Core.selectMainChat());
 fixtureOptions.logicalMobile=true;await phone.reload();await phone.waitForFunction(()=>state.logicalChats&&state.loggedIn);await phone.evaluate(()=>selectMobileTab('chat'));
 for(const [surface,p] of surfaces){await p.evaluate(surface=>{if(surface==='desktop')document.documentElement.dataset.theme='light';else applyTheme('light');},surface);await p.getByText('主对话文件已整理完成。',{exact:true}).waitFor();await p.getByText('这次整理出 5 个文件',{exact:true}).waitFor();assert.equal(await p.locator('.artifact-summary').count(),1);assert.equal(await p.locator('.has-failure').count(),0);
  await shot(p,surface,'light','main-five-collapsed');await p.getByRole('button',{name:/更多操作 主对话-季度总结-v1.md/}).click();await p.getByRole('menu').waitFor();assert.equal(await p.getByRole('menuitem',{name:'下载',exact:true}).count(),1);await shot(p,surface,'light','main-file-menu');await p.getByRole('menu').press('Escape');await p.getByRole('button',{name:'在成果库中查看全部',exact:true}).click();await p.getByRole('button',{name:'预览 主对话-季度总结-v1.md',exact:true}).waitFor();report.checks.push(`${surface}: main chat groups output once and keeps recovered steps neutral`);
 }
 assert.deepEqual(report.errors,[]);report.completed=true;
}finally{
 await browser?.close();await app?.close();await fixture?.close();if(profile)disposeManagedTemp(profile);if(fixture)disposeManagedTemp(fixture.root);
 await writeFile(join(out,'acceptance.json'),JSON.stringify(report,null,2)+'\n');
}


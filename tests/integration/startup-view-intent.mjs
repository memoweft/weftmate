// First-session delivery is gated; navigation uses real user controls, not sleeps.
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {managedMkdtempSync,disposeManagedTemp} from '../helpers/managed-temp.mjs';
import {evidencePath} from '../helpers/evidence-path.mjs';
import {nativeFixtureFetchOptions} from '../helpers/local-ui-session.mjs';
import {startFixture} from './ux-4-fixture.mjs';
const output=process.env.WEFTMATE_STARTUP_INTENT_OUTPUT||evidencePath('startup-view-intent');await mkdir(output,{recursive:true});
const report={node:process.version,cases:[],errors:[]};let app,page,fixture,scope;
const snapshot=()=>page.evaluate(()=>({view:__startupCore.state.currentView,refreshing:__startupCore.state.refreshing,selected:__startupCore.state.selectedSessionId,chat:__startupCore.state.selectedChatId,main:__startupCore.state.mainChat?.chatId,draft:__startupCore.state.newConversation,mode:__startupCore.state.newConversationMode,dialog:document.querySelector('#settings-dialog').open,history:__startupCore.state.historyEvents.size,logicalLoading:__startupCore.state.logicalHistoryLoading,assistantHidden:document.querySelector('#assistant-view').hidden}));
async function capture(name){const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'));}
try{
 for(const branch of ['legacy','logical','work-chat','work-work']){
  scope=managedMkdtempSync('weftmate-startup-intent-',{prune:false});fixture=await startFixture();
  const bootstrap=join(scope,'startup-intent-shell.mjs');await writeFile(bootstrap,`import{createRequire}from'node:module';const{app}=createRequire(${JSON.stringify(new URL('../../package.json',import.meta.url).href)})('electron');app.setName('WeftMate Startup Intent Test');app.setAppUserModelId('com.memoweft.weftmate.test.startupintent');app.disableHardwareAcceleration();await import(${JSON.stringify(new URL('../../scripts/review-gallery/electron.mjs',import.meta.url).href)});`);
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];Object.assign(env,{REVIEW_PROFILE:scope,REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1',WEFTMATE_TEST_HOST_NAME:'synthetic-startup-intent'});
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[bootstrap,'--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));
  await app.evaluate(async({BrowserWindow,ipcMain})=>{await __reviewDesktop.ready;const w=BrowserWindow.getAllWindows()[0];w.showInactive();w.webContents.setBackgroundThrottling(false);for(const name of ['wm:desktop:update-state','wm:desktop:update-check','wm:desktop:update-restart'])ipcMain.removeHandler(name);const state={layers:[{layer:'app',currentVersion:'21',availableVersion:'26',status:'downloaded',releaseNotes:'合成更新说明'}],canRestart:true,channel:'preview'};for(const name of ['wm:desktop:update-state','wm:desktop:update-check'])ipcMain.handle(name,()=>state);ipcMain.handle('wm:desktop:update-restart',()=>{throw Error('Startup test must not request installation');});});
  await page.goto('about:blank');
  await page.route('**/personal/v1/ui/app.js',async route=>{const body=await readFile(new URL('../../src/personal-access-ui/app.js',import.meta.url),'utf8');await route.fulfill({contentType:'text/javascript',body:body.replace('ui.loadAttachmentHasher =','globalThis.__startupCore=core;ui.loadAttachmentHasher =')});});
  await page.route('**/personal/v1/status',async route=>{const response=await route.fetch(nativeFixtureFetchOptions(route,fixture)),body=await response.json();const capabilities=branch==='legacy'?{}:{...body.personalCapabilities,...(branch==='logical'?{workAndChat:0}:{})};await route.fulfill({response,json:{...body,personalCapabilities:capabilities}});});
  if(branch==='work-work')await page.addInitScript(owner=>{if(location.protocol!=='about:')localStorage.setItem(`weftmate-conversation-mode:${owner}`,'work');},fixture.auth.account.ownerId);
  let release,hit;const gate=new Promise(r=>release=r),reached=new Promise(r=>hit=r);let delivered=0;
  await page.route('**/personal/v1/**',async route=>{const url=new URL(route.request().url());const match=branch==='legacy'?url.pathname==='/personal/v1/sessions'&&url.searchParams.get('archived')==='all':url.pathname==='/personal/v1/chats/main';if(!match||route.request().method()!=='GET')return route.fallback();const response=await route.fetch(nativeFixtureFetchOptions(route,fixture));hit();await gate;await route.fulfill({response});delivered++;});
  await page.goto(fixture.origin+'/personal/v1/ui');await reached;await page.waitForFunction(()=>__startupCore.state.device?.authKind==='desktop'&&__startupCore.state.currentView==='assistant');
  const item={branch,before:await snapshot()};assert.equal(item.before.refreshing,true);assert.equal(item.before.assistantHidden,false);
  await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.settings-navigation button[data-category=about]').click();await page.locator('.settings-update-actions > button').waitFor();item.opened=await snapshot();await capture(branch+'-settings-open');
  release();await page.waitForFunction(branch=>{const c=__startupCore;return !c.state.refreshing&&(branch==='legacy'?!!c.state.selectedSessionId:branch==='logical'?c.state.selectedChatId===c.state.mainChat?.chatId&&!c.state.logicalHistoryLoading:c.state.newConversation===true);},branch);
  item.restored=await snapshot();assert.equal(item.restored.dialog,true,'late automatic restore must preserve user-opened settings');assert.equal(item.restored.view,'account');assert.ok(delivered>0);
  if(branch==='legacy')assert.ok(item.restored.history>0,'legacy initial history still loads behind settings');
  if(branch.startsWith('work-'))assert.equal(item.restored.mode,branch==='work-work'?'work':'chat');
  await page.locator('[data-update-layer=app] .settings-update-notes > summary').click();assert.equal(await page.locator('[data-update-layer=app] .settings-update-notes').evaluate(n=>n.open),true);await capture(branch+'-restored-settings');
  if(branch==='legacy')await page.evaluate(id=>__startupCore.selectSession(id),fixture.source);
  else if(branch==='logical')await page.evaluate(()=>__startupCore.selectMainChat());
  else await page.evaluate(()=>__startupCore.startSidebarConversation());
  await page.waitForFunction(()=>__startupCore.state.currentView==='assistant'&&!document.querySelector('#settings-dialog').open);item.explicit=await snapshot();assert.equal(item.explicit.dialog,false,'explicit user navigation must still open chat');report.cases.push(item);
  await app.close();app=null;await fixture.close();fixture=null;disposeManagedTemp(scope,{log(){}});scope=null;
 }
 assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;if(page){report.last=await snapshot().catch(()=>null);await capture('failure').catch(()=>{});}throw error;}
finally{await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await app?.close();await fixture?.close();if(scope)disposeManagedTemp(scope,{log(){}});}
console.log(JSON.stringify(report));

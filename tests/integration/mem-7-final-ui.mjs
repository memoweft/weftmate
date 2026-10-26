import { evidencePath } from '../helpers/evidence-path.mjs';
/** Presentation verification only. Real Core/model acceptance is acceptance.json. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {checkPhoneHistoryPresentation} from '../helpers/history-message-scenarios.mjs';
const repo=resolve(import.meta.dirname,'../..'),out=evidencePath('mem-7'),root=await mkdtemp(join(tmpdir(),'weftmate-mem7-ui-'));
await mkdir(out,{recursive:true});
const styles=[...(await readFile(join(repo,'src/personal-access-ui/index.html'),'utf8')).matchAll(/<link rel="stylesheet"[^>]+>/g)].map(m=>m[0].replace('/personal/v1/ui/ui-core/','/core/').replace('/personal/v1/ui/','/desktop/')).join('');
const html=`<!doctype html><html lang="zh-CN" class="weftmate-desktop" data-native-platform="win32"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<script>globalThis.WeftUiComponents={factories:{}}</script><script src="/desktop/icons.js"></script><script src="/desktop/popovers.js"></script><script src="/desktop/components/main-chat.js"></script><script src="/desktop/message-actions.js"></script><script src="/core/human-format.js"></script><script src="/desktop/history-import-view.js"></script><body><main class="settings-body" id="view"></main></body></html>`;
const server=createServer(async(req,res)=>{const p=new URL(req.url,'http://synthetic.invalid').pathname;try{if(p==='/'){res.setHeader('content-type','text/html');res.end(html);return;}const [kind,...parts]=p.slice(1).split('/');assert.ok(['desktop','core','phone'].includes(kind)&&!parts.includes('..'));const file=join(repo,kind==='desktop'?'src/personal-access-ui':kind==='core'?'src/ui-core':'apps/mobile-ui/www',...parts);res.setHeader('content-type',(file.endsWith('.js')||file.endsWith('.mjs'))?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(file));}catch{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"code":"SYNTHETIC_VISUAL_ONLY"}}');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;let app,browser;const report={presentationOnly:true,modelRequests:0,screenshots:[]};
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[resolve(repo,'tests/integration/desktop-ui-1.cjs'),origin],env:{...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host'}});const page=await app.firstWindow();await page.waitForLoadState('networkidle');await page.waitForFunction(()=>globalThis.WeftHistoryImportView&&globalThis.WeftUiComponents.factories.mainChat);
 for(const width of [1200,480])for(const theme of ['light','dark']){
  await app.evaluate(({BrowserWindow},width)=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(480,640);w.setContentSize(width,900);},width);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.waitForFunction(width=>innerWidth===width,width);
  await page.evaluate(()=>{
   const target=document.querySelector('#view');target.replaceChildren();
   const core={state:{ownerId:'synthetic-account',identityGeneration:1,selectedChatId:'synthetic-phone',sessions:[]},inMainChat:()=>false,readMessageFeedback:()=>[],messageBusy:()=>false,messageSource:async()=>({kind:'side'}),accessApi:async()=>({groups:[]})};
   const ui={element:(tag,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;}};
   globalThis.visualMain=WeftUiComponents.factories.mainChat(core,ui);
   const row=document.createElement('article');row.className='message assistant';row.textContent='手机合成历史仍然可见。';target.append(row);
   const draft=document.createElement('textarea');draft.hidden=true;target.append(draft);
   WeftMessageActions.create({core,draft:()=>draft,sessionId:()=> 'synthetic-phone',notice:()=>{}}).bind(row,{seq:7,type:'assistant.message',data:{text:'手机合成历史仍然可见。',phoneSource:true}});
  });
  await checkPhoneHistoryPresentation(page);
  const name=`ui-final-electron-${width}-${theme}-phone-history-actions.png`;await writeFile(join(out,name),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')),'base64'));report.screenshots.push({file:name,surface:'Electron presentation fixture',width,theme});
  await page.evaluate(()=>document.querySelector('#view').replaceChildren());
  await page.evaluate(()=>{const job={id:'synthetic-large',app:'phone',appName:'手机上的对话',deviceName:'合成手机',state:'awaiting_confirmation',createdAt:'2025-04-01T00:00:00Z',from:'2025-02-01T00:00:00Z',to:'2025-03-12T00:00:00Z',conversationCount:40,total:40,processed:0,memoryCount:0,usage:{requests:0,inputTokens:0,outputTokens:0,cost:null,unknownRequests:0},estimate:{modelName:'MiMo',profileId:'synthetic-cloud',local:false,inputTokens:[50000,180000],outputTokens:[6000,30000],cost:null,seconds:[120,420]}};globalThis.visualImport=WeftHistoryImportView({target:document.querySelector('#view'),owner:()=> 'synthetic-account',desktop:{},request:async()=>({ownerId: 'synthetic-account',imports:[job]})});});
  await page.getByRole('button',{name:'查看预计用量',exact:true}).waitFor();assert.ok(await page.getByText('等你确认',{exact:false}).count());const confirm=`ui-final-electron-${width}-${theme}-large-confirmation.png`;await page.waitForTimeout(300);await writeFile(join(out,confirm),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')),'base64'));report.screenshots.push({file:confirm,surface:'Electron presentation fixture',width,theme});await page.getByRole('button',{name:'查看预计用量',exact:true}).click();const estimate=`ui-final-electron-${width}-${theme}-large-estimate.png`;await page.waitForTimeout(300);await writeFile(join(out,estimate),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')),'base64'));report.screenshots.push({file:estimate,surface:'Electron presentation fixture',width,theme});await page.evaluate(()=>{document.querySelector('dialog[open]').close();visualImport.destroy();});
 }
 browser=await chromium.launch({channel:process.env.CI?undefined:'chrome',headless:true});const context=await browser.newContext();const phone=await context.newPage();await phone.goto(origin+'/phone/index.html');await phone.waitForFunction(()=>typeof renderPhoneMemoryReplica==='function'&&globalThis.WeftOffline&&typeof state!=='undefined');
 await phone.evaluate(async origin=>{await WeftPhone.start({origin,accountId:'synthetic-final-ui',deviceId:'synthetic-phone',email:'visual@example.com'},{authorized:async()=>({devices:[{isCurrent:true,revoked:false}],hosts:[]})});page('memory');},origin);
 for(const [width,height] of [[360,780],[390,844]])for(const theme of ['light','dark']){await phone.setViewportSize({width,height});await phone.evaluate(t=>applyTheme(t),theme);await phone.getByText('记忆在电脑上形成。连上电脑后，这里会显示 WeftMate 记得的事。',{exact:true}).waitFor();assert.equal(await phone.getByRole('switch').count(),0);const name=`ui-final-phone-${width}-${theme}-memory-empty.png`;await phone.screenshot({path:join(out,name)});report.screenshots.push({file:name,surface:'web viewport, system bars excluded',width,height,theme});}
 report.passed=true;
}finally{await browser?.close();await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});await writeFile(join(out,'final-ui.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,modelRequests:0,screenshots:report.screenshots.length}));

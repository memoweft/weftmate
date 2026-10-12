/** Synthetic POLISH-1 before/after captures: production Electron and mobile assets. */
import assert from 'node:assert/strict';
import {chromium,_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {managedMkdtemp,managedTempRoot} from '../helpers/managed-temp.mjs';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {loadNativeReviewSession} from '../helpers/review-native-session.mjs';
import {readFileSync} from 'node:fs';
import {statisticalInsight} from '../../src/personal-access/daily-digest.mjs';
import {existsSync} from 'node:fs';
const summaries=Array.from({length:7},(_,i)=>({day:`2026-10-${String(5+i).padStart(2,'0')}`,tasks:{completed:1,items:[]},outputs:{count:0,items:[]},usage:{hourlyTurns:[0,1,0,0,0,0]},conversations:{items:[]}}));
const before=process.argv.includes('--before'),out=resolve('tests/evidence/polish-1',before?'before':'after');
await mkdir(out,{recursive:true});
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
const f=await startTimelineCandidate({historyCount:0,interactive:true,composer:true,inlineProgress:true,sidebar:true});
f.progress.text('报告已完成，相关测试通过。');f.progress.finish();
const weekly=statisticalInsight(summaries);if(before)weekly.text=weekly.text.replace('这周每天','周一、周二、周三、周四、周五、周六、周日');
const activityPage={items:[{id:'synthetic-week',type:'memory.report',title:'这周回顾',summary:'完成 7 件事',at:new Date().toISOString(),source:{usageWeek:'2026-10-12'},weeklyInsight:{from:'2026-10-05',to:'2026-10-12',text:weekly.text,sources:[],mode:'statistics'},actions:[],state:'completed',read:false}],timeZone:'Asia/Shanghai',unreadCount:1,actionableCount:0,nextCursor:null};
const browser=await chromium.launch({headless:true}),report={synthetic:true,modelRequests:0,systemBars:false,checks:[],screenshots:[]};
let app,profile;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function shot(p,prefix,scene){await pause(180);const name=`${prefix}-${scene}.png`;await p.screenshot({path:join(out,name)});report.screenshots.push(name);}
async function baseline(p,mobile){if(!before)return;await p.route('**/*',async route=>{const path=new URL(route.request().url()).pathname;let file=mobile?resolve('.local/polish-baseline/mobile','.'+(path==='/'?'/index.html':path)):resolve('.local/polish-baseline/desktop',path.replace(/^\/personal\/v1\/ui\/?/,'')||'index.html');if(!mobile&&path.includes('/ui/ui-core/'))file=resolve('.local/polish-baseline/core',path.split('/ui/ui-core/')[1]);if(/\.(js|css|html)$/.test(file)&&existsSync(file)){let body=readFileSync(file);if(mobile&&file.endsWith('index.html'))body=body.toString().replace('<script defer src="app.js">','<script defer src="bridge.js"></script><script defer src="app.js">');if(file.endsWith('app.js')&&!mobile)body=body.toString().replace('const ui = globalThis.WeftUiComponents.createContext();','const ui = globalThis.WeftUiComponents.createContext();globalThis.__polishui=ui;').replace('ui.loadAttachmentHasher =','globalThis.__ux7core=core;ui.loadAttachmentHasher =');return route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}await route.fallback();});}
async function activityRoute(p,mobile){if(mobile)await p.route('**/bridge',async route=>{const input=route.request().postDataJSON();if(input.method==='host.business'&&input.params.path.startsWith('/personal/v1/activity?'))return route.fulfill({json:{result:activityPage}});await route.fallback();});else await p.route('**/personal/v1/activity?*',route=>route.fulfill({json:activityPage}));}
async function capture(p,surface,width,theme){
 const mobile=surface==='phone-web',prefix=`${surface}-${width}-${theme}`;
 console.log('Capture',prefix);
 await p.evaluate(({mobile,theme})=>{document.documentElement.dataset.theme=theme;if(mobile){state.appearance=theme;applyTheme(theme);}else WeftDesktop.setAppearance({theme});},{mobile,theme});
 if(mobile){
  await p.evaluate(()=>{state.model={...state.model,displayName:'MiMo v2.6 Flash'};for(const row of state.sharedSessions||[])row.modelDisplayName='MiMo v2.6 Flash';for(const row of uiCore.state.sessions||[])row.modelDisplayName='MiMo v2.6 Flash';updateComposer();});
  await shot(p,prefix,'l-composer');if(!before){const label=await p.locator('#model-label').textContent();assert.equal(label,'MiMo v2.6 Flash');report.checks.push(prefix+' l: full model name');}await p.locator('#approval-mode-button').click();await shot(p,prefix,'l-mode-menu-open');await p.evaluate(()=>closeApprovalModeMenu());
  await p.evaluate(()=>{page('home');openDrawer();});await shot(p,prefix,'m-sidebar');if(!before){const position=await p.evaluate(()=>{const footer=document.querySelector('.drawer-footer').getBoundingClientRect(),profile=$('profile-link').getBoundingClientRect(),scroll=document.querySelector('.drawer-scroll');return {gap:profile.top-footer.bottom,overflow:getComputedStyle(scroll).overflowY,height:scroll.clientHeight};});assert.ok(Math.abs(position.gap)<20);assert.equal(position.overflow,'auto');report.checks.push(prefix+' m: footer attached above account');}
  await p.evaluate(()=>{closeDrawer();state.username='local-owner';state.profile={displayName:'local-owner'};page('settings');});await shot(p,prefix,'n-account');if(!before){assert.equal(await p.getByText('local-owner',{exact:true}).count(),0);assert.ok(await p.getByText('只在这台电脑上用',{exact:true}).count());report.checks.push(prefix+' n: readable local account');}
  await p.evaluate(()=>page('appearance'));await shot(p,prefix,'ab-appearance');await (before?p.getByRole('combobox',{name:'浅色强调色',exact:true}):p.locator('.appearance-swatches').first()).scrollIntoViewIfNeeded();await shot(p,prefix,'b-colors');if(before){await p.getByRole('combobox',{name:'浅色强调色',exact:true}).click();await shot(p,prefix,'b-colors-menu-open');await p.keyboard.press('Escape');}
  await p.evaluate(()=>page('notifications'));await shot(p,prefix,'u-notifications');
  if(!before){await p.evaluate(()=>page('reviewHealth'));await shot(p,prefix,'u-review-health');await p.getByRole('button',{name:'清空回顾',exact:true}).click();await shot(p,prefix,'u-clear-review-open');await p.getByRole('button',{name:'取消',exact:true}).click();await p.evaluate(()=>page('healthData'));assert.equal(await p.evaluate(()=>state.page),'reviewHealth');}
  await p.evaluate(()=>{page('chat');toast('这条记录已不可查看，请回到对话列表重新打开。',true);});await shot(p,prefix,'s-notice');if(!before){const size=await p.locator('#toast').boundingBox();assert.ok(size.height<=44);report.checks.push(prefix+' s: one-line lightweight notice');}
  if(!before){await p.getByRole('button',{name:'查看提示详情',exact:true}).click();await shot(p,prefix,'s-details-open');await p.getByRole('button',{name:'关闭提示详情',exact:true}).click();await p.evaluate(()=>toast('合成提示自动收起',true));await p.locator('#toast').waitFor({state:'hidden',timeout:6000});}
  if(!before){await p.locator('#conversation-more').click();await shot(p,prefix,'l-context-menu-open');await p.getByRole('menuitem',{name:'背景信息',exact:true}).click();await shot(p,prefix,'l-context-details-open');await p.getByRole('button',{name:'知道了',exact:true}).click();}
  await p.evaluate(()=>{closeToast();page('activity');});await p.getByText('这周回顾',{exact:true}).waitFor();await shot(p,prefix,'r-weekly');
 }else{
  await shot(p,prefix,'l-composer');
  await p.evaluate(()=>{__ux7core.state.personalCapabilities.activity=1;__polishui.openActivity();});await p.getByText('这周回顾',{exact:true}).waitFor();await shot(p,prefix,'r-weekly');
  await p.evaluate(()=>WeftSettingsNavigation.open('appearance'));await shot(p,prefix,'ab-appearance');await (before?p.getByRole('combobox',{name:'浅色强调色',exact:true}):p.locator('.appearance-swatches').first()).scrollIntoViewIfNeeded();await shot(p,prefix,'b-colors');
  await p.evaluate(()=>WeftSettingsNavigation.open('notifications'));await shot(p,prefix,'u-notifications');
  if(!before){await p.evaluate(()=>WeftSettingsNavigation.open('reviewHealth'));await shot(p,prefix,'u-review-health');}
  await p.evaluate(async()=>{document.querySelector('#settings-dialog').close();await __ux7core.selectSession(__ux7core.state.selectedSessionId);});
  // A queued native receipt and the eventual message/turn share identity.
  await p.evaluate(()=>{__ux7core.stopAssistantRefresh();__polishui.closeFixedPage?.();const list=document.querySelector('#transcript');list.replaceChildren();const events=[{seq:900,sessionId:'synthetic',type:'task.queued',data:{taskId:'receipt-demo',receiptId:'receipt-demo',text:'请整理这周的进展。',summary:'请整理这周的进展。'}},{seq:901,sessionId:'synthetic',type:'user.message',data:{receiptId:'receipt-demo',text:'请整理这周的进展。'}},{seq:902,sessionId:'synthetic',type:'task.started',data:{taskId:'turn-2',receiptId:'receipt-demo',turn:2}},{seq:903,sessionId:'synthetic',type:'assistant.message',data:{text:'本周进展已整理。'}},{seq:904,sessionId:'synthetic',type:'task.ended',data:{taskId:'turn-2',receiptId:'receipt-demo',reason:'completed'}}];WeftTimeline.render(events,list,{});const user=document.createElement('li');user.className='message user';user.innerHTML='<div class="message-text">请整理这周的进展。</div>';list.append(user);const reply=document.createElement('li');reply.className='message assistant';reply.textContent='本周进展已整理。';list.append(reply);});
  await shot(p,prefix,'ow-queue-completed');
  if(!before)assert.equal(await p.locator('#transcript').getByText('排队中',{exact:true}).count(),0);
 }
 if(!before){
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,prefix+' overflow');
  if(mobile){await p.evaluate(()=>{page('appearance');});const switchRow=p.locator('.appearance-motion-row');assert.ok(await switchRow.count());const geometry=await switchRow.evaluate(row=>{const label=row.querySelector('label'),input=row.querySelector('input');return {label:label.getBoundingClientRect().y,input:input.getBoundingClientRect().y};});assert.ok(Math.abs(geometry.label-geometry.input)<32);const swatches=p.getByRole('group',{name:'浅色强调色',exact:true});assert.equal(await swatches.getByRole('button').count(),4);await swatches.getByRole('button',{name:'紫色',exact:true}).click();assert.equal(await swatches.getByRole('button',{name:'紫色',exact:true}).getAttribute('aria-pressed'),'true');await p.getByRole('switch',{name:'减少动态效果',exact:true}).check();assert.equal(await p.evaluate(()=>WeftReplyMotion.preference),'reduce');await p.getByRole('button',{name:'恢复跟随系统',exact:true}).click();assert.equal(await p.evaluate(()=>WeftReplyMotion.preference),'system');report.checks.push(prefix+' a/b: appearance switch and swatches saved');}
  report.checks.push(prefix+' layout and state assertions');
 }
}
try{
 for(const [width,height]of [[360,780],[390,844]])for(const theme of ['light','dark']){
  const p=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,colorScheme:theme});p.setDefaultTimeout(15000);p.on('pageerror',e=>console.log('pageerror',e.message));
  await activityRoute(p,true);await baseline(p,true);await p.goto(f.mobileUrl);await p.waitForFunction(()=>state.booted&&state.loggedIn).catch(async error=>{console.log('boot diagnostic',await p.evaluate(()=>({booted:state.booted,loggedIn:state.loggedIn,connection:state.connection,page:state.page,text:document.body.innerText.slice(0,500)})));throw error;});await p.evaluate(async id=>{await selectSharedSession(id);closeDrawer();},f.sessionId);await p.waitForFunction(()=>!state.sharedLoading);
  await capture(p,'phone-web',width,theme);await p.close();
 }
 profile=await managedMkdtemp(join(managedTempRoot(),'weftmate-polish-1-'));
 const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,WEFTMATE_TEST_HOST_NAME:'synthetic-host',REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light',REVIEW_LIBRARY_TOKEN:f.libraryDesktopToken}});
 const p=await app.firstWindow();p.setDefaultTimeout(8000);
 await p.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('src/personal-access-ui/app.js','utf8').replace('const ui = globalThis.WeftUiComponents.createContext();','const ui = globalThis.WeftUiComponents.createContext();globalThis.__polishui=ui;').replace('ui.loadAttachmentHasher =','globalThis.__ux7core=core;ui.loadAttachmentHasher =')}));
 await activityRoute(p,false);await baseline(p,false);await loadNativeReviewSession(p,f);await p.locator('#message-text:not([disabled])').waitFor();
 for(const width of [1200,480])for(const theme of ['light','dark']){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);await capture(p,'electron',width,theme);}
 await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log('POLISH-1 screenshots',report.screenshots.length);
}finally{await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await browser.close();await f.close();for(const path of [profile,f.root].filter(Boolean))await rm(path,{recursive:true,force:true});}

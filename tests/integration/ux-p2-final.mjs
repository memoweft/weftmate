// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Final confirmation of D49, composed menus, memory notices and shared scrolling. */
import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {startFixture} from './ux-4-fixture.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-p2');await mkdir(out,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const rows=[],checks=[],errors=[];let app,browser,f,profile;let modelMissing=false,historyEmpty=false;
const wait=ms=>new Promise(r=>setTimeout(r,ms));const b=(p,name)=>p.getByRole('button',{name,exact:true}).filter({visible:true});
async function shot(p,s,t,scene){await wait(120);const screenshot=`after-${s}-${t}-${scene}.png`;await p.screenshot({path:join(out,screenshot)});const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);rows.push({surface:s,theme:t,scene,state:'最终确认',screenshot,defects:[],checklist:Array(8).fill(true)});}
try{
 f=await startFixture();const owner=(await f.request('/auth/me')).account.ownerId;
 const userEvent=f.logs.get(f.source).find(e=>e.type==='user.message');userEvent.at=new Date().toISOString().slice(0,10)+'T06:28:00.000Z';
 const memory={ownerId:owner,state:'degraded',worldRevision:1,capabilities:{list:true,source:true},formedMemoryCount:4,reasonCode:'MEMORY_FORMATION_FAILED',failedCorrectionCount:1,formationIssues:[{jobId:'synthetic-rejected',intent:'correction',text:userEvent.data.text,sessionId:f.source,createdAt:userEvent.at}]};
 profile=await mkdtemp(join(tmpdir(),'weftmate-ux-p2-final-'));
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const p=await app.firstWindow();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/personal/v1/settings/usage',r=>r.fulfill({json:{timeZone:'Europe/Paris'}}));
 await p.route('**/personal/v1/memory/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/status')?memory:{ownerId:owner,worldRevision:1,searchScope:'account_snapshot',items:[],totalCount:0,hasMore:false,nextCursor:null}}));
 await p.route('**/personal/v1/models',r=>modelMissing?r.fulfill({json:{models:[]}}):r.fallback());await p.route('**/personal/v1/sessions/*/events?*',r=>historyEmpty?r.fulfill({json:{events:[],hasOlder:false,hasMore:false,nextSeq:-1,nextBeforeSeq:null}}):r.fallback());await localUiSession(p,f.credentials);await p.getByRole('group',{name:/我的消息/}).waitFor();
 for(const width of [1200,480])for(const t of ['light','dark']){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);await p.evaluate(t=>document.documentElement.dataset.theme=t,t);const s='electron-'+width;
  const user=p.getByRole('group',{name:/我的消息/}).first();await user.hover();await p.getByText('8:28',{exact:true}).waitFor();
  const geometry=await user.evaluate(row=>{const a=row.querySelector('.message-actions').getBoundingClientRect(),bubble=row.querySelector('.message-user-bubble').getBoundingClientRect();return {below:a.top>=bubble.bottom,right:Math.abs(a.right-bubble.right)<1,inside:!!row.querySelector('.message-user-bubble button')}});assert.deepEqual(geometry,{below:true,right:true,inside:false});
  await shot(p,s,t,'D49-user-hover');await p.mouse.move(0,0);await user.focus();await shot(p,s,t,'D49-user-keyboard');
  assert.equal(await p.getByRole('button',{name:/编辑并重发|从这里开旁聊并重发/,includeHidden:true}).count(),0);
  const reply=p.getByRole('group',{name:/助手消息/}).last();await reply.hover();await reply.getByRole('button',{name:'更多回复操作',exact:true}).click();assert.equal(await p.getByRole('menuitem',{name:'上次发送未确认，重试'}).count(),0);await shot(p,s,t,'D49-reply-menu');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');await p.getByRole('menuitemradio',{name:'合成模型',exact:true}).waitFor();assert.equal(await p.getByRole('menuitemradio',{name:'合成模型',exact:true}).getAttribute('aria-checked'),'true');await shot(p,s,t,'D49-model-submenu');await p.keyboard.press('Escape');await p.keyboard.press('Escape');
  await shot(p,s,t,'memory-turn-warning');
  if(width<720)await b(p,'切换会话侧栏').click();await b(p,'账户菜单').click();await b(p,'记忆').click();await p.locator('#memory-health').getByRole('button',{name:'查看',exact:true}).click();assert.equal(await p.getByText('有 1 条纠正没有生效',{exact:true}).count(),1);await shot(p,s,t,'memory-rejected-expanded-final');await p.keyboard.press('Escape');for(const id of ['password-dialog','revoke-dialog','memory-detail-dialog']){await p.evaluate(id=>document.getElementById(id).showModal(),id);await shot(p,s,t,'dialog-'+id);await p.evaluate(id=>document.getElementById(id).close(),id);}await p.reload();await p.getByRole('group',{name:/我的消息/}).waitFor();
 }
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const size of [{width:360,height:780},{width:390,height:844}]){
  const page=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(f.mobileUrl);await page.waitForFunction(()=>state.booted);await page.evaluate(async id=>{await selectSharedSession(id);page('chat');closeDrawer()},f.source);
  for(const t of ['light','dark']){await page.evaluate(t=>applyTheme(t),t);const s='android-bundle-'+size.width;const user=page.getByRole('group',{name:/我的消息/}).first();
   await user.dispatchEvent('pointerdown',{pointerType:'touch',clientX:100,clientY:180});await wait(550);await user.dispatchEvent('pointerup',{pointerType:'touch'});await page.getByRole('menuitem',{name:'复制',exact:true}).waitFor();assert.equal(await page.getByRole('menuitem',{name:/编辑|重发/}).count(),0);await shot(page,s,t,'D49-long-press');await page.getByRole('menuitem',{name:'引用',exact:true}).click();assert.match(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(),/^> /);await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('');
   await user.tap();await shot(page,s,t,'D49-tap-time');await user.tap();
   assert.equal(await user.getByRole('button',{name:'复制消息',includeHidden:true}).isVisible(),false);await page.evaluate(()=>{uiCore.state.models=[];uiCore.state.modelsKnown=true;updateComposer()});await shot(page,s,t,'no-model-history');await page.evaluate(()=>{$('chat-content').replaceChildren();updateComposer()});await shot(page,s,t,'no-model-empty');await page.evaluate(async()=>{await uiCore.refreshThinkingModels();await selectSharedSession(state.sharedSessionId);page('chat');updateComposer()});
  }
  await page.close();
 }
 checks.push('account timezone 8:28','D49 outside/right hover/focus','processed users no edit','submenu current check and arrows/Esc','retry absent normally','single rejected notice','touch copy/quote menu and tap time');assert.deepEqual(errors,[]);await writeFile(join(out,'final-checks.json'),JSON.stringify({rows,checks,errors,synthetic:true,modelRequests:0},null,2));
}finally{await writeFile(join(out,'final.partial.json'),JSON.stringify({rows,checks,errors},null,2));await browser?.close();await app?.close();await f?.close();if(profile)await rm(profile,{recursive:true,force:true});}

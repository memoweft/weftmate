/** Supplement baseline: serve original HEAD presentation, never edit/revert sources. */
import {_electron,chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/evidence/ux-p1'),ref=process.env.UX_P1_BASE_REF||'99e75a74a3da8f3d7baa235d5e4c6169a6b6e7e9';
const f=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile:true,interactive:true,inlineProgress:true,historyCount:0});
let app,browser,profile;
try{
 const host=(await f.request('/status')).hostId,main=(await f.request('/chats/main')).chat;
 let cmd=(await f.request('/commands',{requestId:randomUUID(),targetDeviceId:host,kind:'chat.message',chatId:main.chatId,modelProfileId:'local',text:'合成历史'})).command;
 for(let n=0;n<100&&cmd.state!=='accepted_by_dsh';n++){await new Promise(r=>setTimeout(r,20));cmd=(await f.request(`/commands/${cmd.commandId}`)).command}f.seedMainHistory(cmd.sessionId,3200);f.progress.finish('completed');
 const original=path=>execFileSync('git',['show',`${ref}:${path}`],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
 profile=await mkdtemp(join(tmpdir(),'weftmate-ux-p1-baseline-'));const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const p=await app.firstWindow();p.setDefaultTimeout(15000);
 for(const name of ['main-chat.css','styles.css','components/main-chat.js'])await p.route('**/personal/v1/ui/'+name,r=>r.fulfill({body:original('src/personal-access-ui/'+name),contentType:name.endsWith('css')?'text/css':'text/javascript'}));
 await localUiSession(p,f.credentials,'UX-P1 baseline',{mainChat:true});await p.waitForFunction(()=>document.querySelector('.main-chat-row'));
 await p.getByRole('button',{name:'加载更早内容',exact:true}).evaluate(n=>n.scrollIntoView({block:'start'}));await p.screenshot({path:join(out,'before-03-desktop-earlier.png')});
 browser=await chromium.launch({headless:true,channel:'chrome'});
 for(const width of [390,360]){const page=await browser.newPage({viewport:{width,height:width===390?844:780},isMobile:true,hasTouch:true});for(const name of ['styles.css','layout.js','main-chat.css','components/main-chat.js'])await page.route('**/'+name,r=>r.fulfill({body:original('apps/mobile-ui/www/'+name),contentType:name.endsWith('css')?'text/css':'text/javascript'}));await page.goto(f.mobileUrl);await page.waitForFunction(()=>typeof state!=='undefined'&&uiCore.inMainChat());
  for(const theme of ['light','dark']){await page.evaluate(t=>{applyTheme(t);$('chat-status').textContent='请先绑定云账户并批准这台设备。'},theme);await page.screenshot({path:join(out,`before-16-web-${width}-${theme}.png`)})}await page.close();
 }
}finally{await browser?.close();await app?.close();await f.close();await rm(f.root,{recursive:true,force:true});if(profile)await rm(profile,{recursive:true,force:true})}

import { outputPath } from './evidence.mjs';
import {chromium} from 'playwright';
import {registerHooks} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const baseline=new Map(['src/personal-access/index.mjs','src/personal-access/http.mjs','src/personal-access/chat-timeline.mjs'].map(p=>[pathToFileURL(resolve(p)).href,execFileSync('git',['show','origin/main:'+p],{encoding:'utf8'})]));
registerHooks({load(url,context,next){if(baseline.has(url))return {...next(url,context),source:baseline.get(url),shortCircuit:true};return next(url,context);}});
const {startTimelineCandidate}=await import('../timeline-ui-candidate.mjs');
const f=await startTimelineCandidate({daily:true,inlineProgress:true,logicalMobile:true,sidebar:true,historyCount:0});let browser;const report={};
try{
 const main=(await f.request('/chats/main')).chat,events=await f.request(`/chats/${main.chatId}/events`);report.actualOldHost={replyWait:(await f.request('/status')).personalCapabilities.replyWait??null,hasAccountChanges:'accountChanges' in events};
 browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:390,height:844}});let calls=[];
 p.on('request',r=>{if(r.url().endsWith('/bridge')){const m=JSON.parse(r.postData());if(m.params?.path?.includes('/changes?'))calls.push(m.params.path);}});
 await p.goto(f.mobileUrl);await p.waitForFunction(()=>state.booted&&state.loggedIn&&uiCore.state.mainChat);await p.evaluate(()=>uiCore.selectMainChat());await new Promise(r=>setTimeout(r,700));calls=[];await new Promise(r=>setTimeout(r,4500));
 report.changes=calls.length;report.waitParameters=calls.filter(x=>/waitMs=/.test(x)).length;report.accountRevisionParameters=calls.filter(x=>/accountRevision=/.test(x)).length;report.readOutcome=await p.evaluate(()=>uiCore.state.historyReadResult?.kind);
}finally{await browser?.close();await f.close();rmSync(f.root,{recursive:true,force:true});writeFileSync(outputPath('old-host.json'),JSON.stringify(report,null,2));}console.log(report);

import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {harness} from './harness.mjs';
const h=await harness('upgrade',{sourceRepository:resolve('.local/qa-6/old-source')}),report={oldRevision:'f787c3c',newRevision:'480d65e462652a3111d2b40e09f697b2f78b8f8e',realDsh:true,syntheticModel:true,sessions:[]};
try{
 for(let i=0;i<3;i++){const id=await h.session(),text=`QA6旧日用版本会话${i+1}：我偏好测试绿茶。`;await h.send(id,text);report.sessions.push({id,text,before:await h.events(id)});}
 await h.page.screenshot({path:join(h.out,'old-version.png')});await h.app.close();h.app=null;h.sourceRepository=null;await h.launch();
 const chats=(await h.api('/chats')).body.items;const main=await h.api('/chats/main');report.mainStatus=main.status;report.mainKind=main.body.chat?.kind;assert.equal(main.status,200);assert.equal(main.body.chat.kind,'main');
 for(const session of report.sessions){const chat=chats.find(c=>c.activeSessionId===session.id);assert.equal(chat.kind,'side');const events=await h.events(session.id);session.eventsRetained=session.before.every(e=>events.some(a=>a.seq===e.seq&&a.type===e.type&&JSON.stringify(a.data)===JSON.stringify(e.data)));assert.ok(session.eventsRetained);const found=await h.api(`/chats/${chat.chatId}/search?q=${encodeURIComponent(session.text)}`);assert.equal(found.status,200);session.searchHits=found.body.hits.length;assert.ok(session.searchHits>0);}
 await h.page.screenshot({path:join(h.out,'new-version.png')});report.passed=true;
}catch(e){report.error=e.stack;report.passed=false;process.exitCode=1;}finally{await h.close();writeFileSync(join(h.out,'results.json'),JSON.stringify(report,null,2));}

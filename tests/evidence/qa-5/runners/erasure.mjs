import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {harness,pause} from './harness.mjs';
const h=await harness('erasure'),report={startedAt:new Date().toISOString(),realElectron:true,realDsh:true,realCore:true,syntheticModel:true,checks:[]};
const save=()=>writeFileSync(join(h.out,'results.json'),JSON.stringify(report,null,2));
try{
 const unrelated=await h.session();await h.send(unrelated,'我偏好第801种合成茶使用蓝色杯子。');await h.healthy();
 const initial=(await h.api('/sessions')).body.sessions.find(s=>s.sessionId===unrelated);assert.equal(initial.unread,true);
 for(const action of ['forget','forget-title','delete']){
  const token=`第${820+report.checks.length}种QA5茶`,secret=`我偏好${token}使用黄色杯子。`,id=await h.session();
  await h.send(id,secret);await h.healthy();
  if(action==='forget-title')assert.equal((await h.api(`/sessions/${id}/metadata`,{title:secret},'PATCH')).status,200);
  const chats=(await h.api('/chats?limit=100')).body.items,chat=chats.find(c=>c.activeSessionId===id);assert.ok(chat);
  await h.api('/sessions?archived=all');await h.api('/chats?archived=all');
  assert.ok(JSON.stringify(await h.api(`/chats/${chat.chatId}/search?q=${encodeURIComponent(token)}`)).includes(token));
  await h.api(`/chats/${chat.chatId}/events?limit=1`);
  const row={action,checks:[]};report.checks.push(row);save();
  if(action==='delete'){row.erasure=await h.api(`/sessions/${id}`,{forgetMemories:false},'DELETE');assert.equal(row.erasure.status,200);}
  else{const item=(await h.api('/memory/items?kind=cognition')).body.items.find(i=>i.text.includes(token));assert.ok(item,'formal source formed in real Core');const path=`/memory/items/cognition/${encodeURIComponent(item.id)}`;const preview=await h.api(path+'/forget-preview');assert.equal(preview.status,200);row.erasure=await h.api(path,{requestId:randomUUID(),expectedWorldRevision:preview.body.worldRevision,deleteConversationSnippets:true},'DELETE');assert.equal(row.erasure.status,200);}
  const verify=async phase=>{
   const check={phase,lists:true,titleSearch:true,paging:true,fullText:true,unrelatedUnread:true};
   for(const route of ['/sessions','/chats']){
    const list=await h.api(route+'?archived=all');assert.equal(list.status,200);assert.ok(!JSON.stringify(list.body).includes(token),'list source erased');
    const found=await h.api(route+'?archived=all&q='+encodeURIComponent(token));assert.equal(found.status,200);assert.equal((found.body.sessions??found.body.items).length,0);
    let cursor=null;do{const page=await h.api(route+'?archived=all&limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(page.status,200);assert.ok(!JSON.stringify(page.body).includes(token));cursor=page.body.hasMore?page.body.nextCursor:null;}while(cursor);
   }
   const found=await h.api(`/chats/${chat.chatId}/search?q=${encodeURIComponent(token)}`);assert.equal(found.status,action==='delete'?404:200);if(action!=='delete')assert.equal(found.body.hits.length,0);
   assert.equal((await h.api('/sessions')).body.sessions.find(s=>s.sessionId===unrelated).unread,true);
   row.checks.push(check);save();
  };
  await verify('after-erasure');await h.app.close();h.app=null;await h.launch();await h.healthy();await verify('after-restart');row.passed=true;
  await h.page.screenshot({path:join(h.out,action+'-after-restart.png')});save();
 }
 // Generate enough genuine DSH history to span the first history page, then restart.
 for(let i=0;i<32;i++)await h.send(unrelated,`第${i+1}轮合成无关对话，请只回复收到。`);
 await h.healthy();const before=(await h.api('/sessions')).body.sessions.find(s=>s.sessionId===unrelated);const events=await h.events(unrelated);const last=events.filter(e=>['user.message','assistant.message'].includes(e.type)).at(-1);
 await h.app.close();h.app=null;await h.launch();await h.healthy();const after=(await h.api('/sessions')).body.sessions.find(s=>s.sessionId===unrelated);
 report.startup={latestEventAt:last.at,beforeUpdatedAt:before.updatedAt,afterUpdatedAt:after.updatedAt,beforeUnread:before.unread,afterUnread:after.unread,eventCountTail:events.length};
 assert.equal(after.updatedAt,before.updatedAt);assert.equal(after.unread,true);assert.ok(Date.parse(after.updatedAt)>=Date.parse(last.at));report.passed=true;
}catch(e){report.error=e.stack;report.passed=false;await h.page?.screenshot({path:join(h.out,'failure.png')}).catch(()=>{});process.exitCode=1;}finally{await h.close();report.finishedAt=new Date().toISOString();save();}

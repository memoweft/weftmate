import test from 'node:test';
import assert from 'node:assert/strict';
import {rmSync,readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {startTimelineCandidate} from './integration/timeline-ui-candidate.mjs';

test('BL-29 existing chat changes wait for a native delta, wake immediately and retain exact cursor semantics',async()=>{
  const f=await startTimelineCandidate({daily:true,inlineProgress:true});
  try{
    const chat=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
    const sent=await f.request('/commands',{requestId:'bl29-wait-test',kind:'chat.message',chatId:chat.chatId,text:'synthetic',modelProfileId:'local',targetDeviceId:host});
    for(let n=0;n<100;n++){if((await f.request('/commands/'+sent.command.commandId)).command.state==='accepted_by_dsh')break;await new Promise(r=>setTimeout(r,10));}
    f.progress.text('已完成。');f.progress.finish();
    const page=await f.request(`/chats/${chat.chatId}/events?limit=100`),at=Date.now();
    const pending=f.request(`/chats/${chat.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=2000&limit=100`);
    await new Promise(r=>setTimeout(r,100));f.progress.chunk('即时增量。');
    const changed=await pending;assert.ok(Date.now()-at<700,'native event wakes before the timeout');
    assert.equal(changed.liveEvents[0].data.text,'即时增量。');assert.ok(changed.liveRevision>page.liveRevision);
    const stable=await f.request(`/chats/${chat.chatId}/changes?cursor=${changed.nextCursor}&limit=100`);
    assert.equal(stable.liveRevision,changed.liveRevision,'an unchanged read cannot manufacture a new live revision');
    assert.equal(stable.upserts.length,0);
  }finally{await f.close();rmSync(f.root,{recursive:true,force:true});}
});

test('BL-29 empty main chat wait wakes when another device starts its first task',async()=>{
  const f=await startTimelineCandidate({daily:true,inlineProgress:true});
  try{
    const chat=(await f.request('/chats/main')).chat,host=(await f.request('/status')).hostId;
    const page=await f.request(`/chats/${chat.chatId}/events?limit=100`),at=Date.now();
    const waiting=f.request(`/chats/${chat.chatId}/changes?cursor=${page.syncCursor}&liveRevision=${page.liveRevision}&waitMs=2000`);
    await new Promise(r=>setTimeout(r,100));await f.request('/commands',{requestId:'bl29-first-device',kind:'chat.message',chatId:chat.chatId,text:'synthetic',modelProfileId:'local',targetDeviceId:host});
    await waiting;assert.ok(Date.now()-at<700,'account mutation also wakes an empty conversation');
  }finally{await f.close();rmSync(f.root,{recursive:true,force:true});}
});

test('BL-29 native bridge cancels only the waiting read view and reserves an action worker until the physical read returns',async()=>{
  const context:any={WeftUiCore:{},URL,setTimeout,clearTimeout};runInNewContext(readFileSync('src/ui-core/adapters/android-bridge.js','utf8'),context);
  const requests:any[]=[],bridge=context.WeftUiCore.createAndroidBridge({postMessage:raw=>requests.push(JSON.parse(raw))});
  const controller=new AbortController(),pending=bridge.fetch('/personal/v1/chats/chat-test/changes?cursor=c&liveRevision=0&waitMs=15000',{signal:controller.signal});
  assert.equal(bridge.canWaitForReply(),false);controller.abort();const response=await pending;
  assert.equal((await response.json()).error.code,'ABORTED');assert.equal(bridge.canWaitForReply(),false,'a cancelled native HTTP read still occupies one worker');
  const probe=bridge.fetch('/personal/v1/status');assert.equal(requests[1].method,'host.status');
  bridge.receive({id:requests[1].id,ok:true,result:{hostId:'synthetic-host'}});assert.equal((await (await probe).json()).hostId,'synthetic-host');
  bridge.receive({id:requests[0].id,ok:true,result:{upserts:[],liveRevision:0}});for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(bridge.canWaitForReply(),true);assert.equal((await response.json()).error.code,'ABORTED','late physical response cannot replace the cancelled view');
});

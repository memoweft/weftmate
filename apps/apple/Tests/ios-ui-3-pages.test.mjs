import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {createInterface} from 'node:readline';

test('page fixtures exercise real goals, schedules, library, source permissions and pending cleanup', {timeout:30000}, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ios-ui-pages-test-')),metadata=join(directory,'fixture.json');
  const child=spawn(process.execPath,['apps/apple/Tests/apple5_real_host.mjs',metadata],{env:{...process.env,WEFTMATE_IOS_UI_PAGES:'1'},stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:child.stdout});
  let failure='';child.stderr.on('data',chunk=>{failure+=chunk.toString();});
  try {
    const [line]=await once(lines,'line');assert.equal(JSON.parse(line).ready,true);
    const meta=JSON.parse(await readFile(metadata,'utf8'));
    const login=await fetch(meta.origin+'/personal/v1/auth/login',{method:'POST',headers:{origin:meta.origin,'content-type':'application/json'},body:JSON.stringify({username:meta.username,password:meta.password,deviceName:'Synthetic page checks'})});
    assert.equal(login.status,200);const auth=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
    const request=async(path,method='GET',body)=>{
      const result=await fetch(meta.origin+'/personal/v1'+path,{method,headers:{origin:meta.origin,cookie,'x-weftmate-csrf':auth.csrfToken,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      const data=await result.json();assert.equal(result.status,200,path+" "+(data.error?.code??"")+" "+(result.status === 200 ? "" : failure));return data;
    };
    const goals=await request('/goals');assert.equal(goals.items[0].id,'apple5-goal');assert.ok(goals.items[0].source.sessionId);
    assert.ok(goals.items[0].progress); // A display string, never a fabricated percentage.
    const schedules=await request('/schedules');assert.equal(schedules.items[0].timeZone,'UTC');
    const schedule=schedules.items[0],path='/schedules/'+schedule.sessionId+'/'+schedule.id;
    await request(path+'/pause','POST',{requestId:'pages-pause'});
    assert.equal((await request('/schedules')).items[0].state,'paused');
    await request(path+'/resume','POST',{requestId:'pages-resume'});
    assert.equal((await request('/schedules')).items[0].state,'active');
    const library=await request('/library');assert.equal(library.items[0].id,'apple5-file');assert.ok(library.items[0].createdAt);
    const preview=await request('/library/apple5-file/preview');assert.match(preview.text,/合成周末计划/);
    const none=await request('/library?search='+encodeURIComponent('没有这样的文件名'));assert.equal(none.items.length,0);
    const activity=await request('/activity?filter=unread');assert.ok(activity.items.some(row=>row.actions.some(action=>action.kind==='view_library')));
    const memory=await request('/memory/items?kind=cognition&query=');assert.equal(memory.items[0].id,'ios-ui-memory');
    const detail='/memory/items/cognition/ios-ui-memory';
    const sources=await request(detail+'/sources');assert.equal(sources.sources[0].permissions.allowLocalRead,true);assert.match(sources.sources[0].rawContent,/上午/);
    const corrected=await request(detail+'/correct','POST',{requestId:'pages-correct',expectedWorldRevision:memory.worldRevision,text:'周末喜欢留一点时间阅读。'});
    assert.equal(corrected.receipt.state,'applied');
    const muted=await request(detail+'/mute','POST',{requestId:'pages-mute',expectedWorldRevision:corrected.receipt.worldRevision});assert.equal(muted.receipt.state,'applied');
    const scope=await request(detail+'/forget-preview');assert.equal(scope.itemCount,1);assert.equal(scope.evidenceCount,1);
    const removed=await request(detail,'DELETE',{requestId:'pages-delete',expectedWorldRevision:scope.worldRevision,deleteConversationSnippets:false});
    assert.equal(removed.receipt.state,'applied');assert.equal(removed.receipt.storageCleanup.state,'pending');
    assert.equal((await request('/memory/items?kind=cognition&query=')).items.length,0);
    const reconciled=await request('/memory/commands/by-request/pages-delete');assert.equal(reconciled.receipt.storageCleanup.state,'pending');
    const clean=await request('/memory/commands/by-request/pages-delete/retry-cleanup','POST',{});assert.equal(clean.receipt.storageCleanup.state,'complete');
    // Native mutation refreshes use phoneFirst. The synthetic memory adapter is
    // available; the deliberately absent cloud binding must remain the boundary.
    const publicJwk=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'jwk'});
    const sync=await fetch(meta.origin+'/personal/v1/offline/sync',{method:'POST',headers:{origin:meta.origin,cookie,'x-weftmate-csrf':auth.csrfToken,'content-type':'application/json'},body:JSON.stringify({publicJwk,generation:0,hashes:{},phoneFirst:true})});
    assert.equal(sync.status,409,'A supported memory refresh must not falsely mark this reachable host unavailable');
    assert.equal((await sync.json()).error.code,'OFFLINE_CLOUD_REQUIRED');
    assert.equal(failure,'');
  } finally {
    const exited=once(child,'exit');child.stdin.end('stop\n');await exited;lines.close();await rm(directory,{recursive:true,force:true});
  }
});

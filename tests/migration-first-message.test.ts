import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationHost } from './helpers/migration-host.mjs';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('real main gateway and pinned DSH create a fresh main session and answer its first message', {timeout:120000}, async () => {
  const h = await migrationHost();
  try { const result=await h.mainFirst(); assert.ok(result.sessionId); assert.ok(h.requests.length>0); }
  finally { await h.close(); }
});

test('f787c3c native data upgrades with preserved side history and a successful first main message',{timeout:180000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-fx21-upgrade-')),source=join(root,'old');mkdirSync(source);
  let h;
  try {
    execFileSync('git',['archive','f787c3c','--output='+join(root,'old.tar')]);
    execFileSync('tar',['-xf',join(root,'old.tar'),'-C',source]);
    symlinkSync(resolve('node_modules'),join(source,'node_modules'),process.platform==='win32'?'junction':'dir');
    mkdirSync(join(source,'vendor'));symlinkSync(resolve('vendor/dsh-runtime'),join(source,'vendor/dsh-runtime'),process.platform==='win32'?'junction':'dir');
    h=await migrationHost({source,old:true});
    const response=await h.api('/commands',{requestId:crypto.randomUUID(),kind:'session.create',targetDeviceId:h.hostId,modelProfileId:h.modelId});
    const created=await h.receipt(response.body.command);
    const sent=await h.api('/commands',{requestId:crypto.randomUUID(),kind:'session.message',targetDeviceId:h.hostId,sessionId:created.sessionId,text:'旧日用版本的合成历史'});await h.receipt(sent.body.command);
    await new Promise(r=>setTimeout(r,500));await h.app.close();h.app=null;h.source=resolve(process.env.FX21_SOURCE || '.');h.old=false;await h.launch();
    const chats=(await h.api('/chats')).body.items;
    assert.equal(chats.find(c=>c.activeSessionId===created.sessionId)?.kind,'side');
    const history=await h.api('/sessions/'+created.sessionId+'/events?limit=200');
    assert.ok(history.body.events.some(e=>e.type==='user.message'&&e.data.text==='旧日用版本的合成历史'));
    assert.ok((await h.mainFirst()).reply);
  }finally{await h?.close();rmSync(root,{recursive:true,force:true});}
});

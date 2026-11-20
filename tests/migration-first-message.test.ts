import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationHost, until } from './helpers/migration-host.mjs';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync,writeFileSync,readFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {zstdCompressSync} from 'node:zlib';
import {routeForProfile} from '../src/harness-model-routes.ts';
import {releasedV3SessionFormatCodec as codec} from '../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-session-format-v2-to-v3/lib/index.js';

test('real gateway and pinned DSH create a fresh conversation and answer its first message', {timeout:120000}, async () => {
  const h = await migrationHost();
  try { const result=await h.firstMessage(); assert.ok(result.sessionId); assert.ok(h.requests.length>0); }
  finally { await h.close(); }
});

test('f787c3c native data upgrades with preserved side history and a successful first message',{timeout:180000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-fx21-upgrade-')),source=join(root,'old');mkdirSync(source);
  let h;
  try {
    // Stream the archive: GNU tar (Git for Windows) reads a drive-letter archive path as a remote host.
    execFileSync('tar',['-x','-C',source],{input:execFileSync('git',['archive','f787c3c'],{maxBuffer:1<<30})});
    symlinkSync(resolve('node_modules'),join(source,'node_modules'),process.platform==='win32'?'junction':'dir');
    let created;
    h=await migrationHost({source:resolve('.')});
    const initialStore=JSON.parse(readFileSync(join(h.profile,'personal-access','store.json'),'utf8'));
    const initialAccount=Object.values(initialStore.accounts)[0];
    const baseUrl=Object.values(Object.values(initialAccount.accountModels)[0].revisions)[0].baseUrl;
    const initialModelId=h.modelId;
    await h.app.close();h.app=null;
    const {profile,credentials}=h,cwd=join(profile,'dsh-home','workspace'),oldAccess=join(root,'personal-access');
    mkdirSync(cwd,{recursive:true});
    // Match persistence-jsonl's projectKey: collapse separators, escape UTF-16 units, then bound the key.
    const readable=cwd.replace(/[\\/:]+/g,'-').replace(/[^A-Za-z0-9._-]/g,ch=>'~'+ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));
    const projectKey=`--${(readable.replace(/^-+/,'')||'root').slice(0,251)}--`;
    {
      const {createPersonalAccessService}=await import(pathToFileURL(join(source,'src/personal-access/index.mjs')).href);
      const sessionFile=sessionId=>join(profile,'dsh-home','sessions',projectKey,sessionId,'session.v3.jsonl.zstd');
      const service=await createPersonalAccessService({root:oldAccess,port:0,backend:{
        getStatus:async()=>({}),listModels:async()=>[{id:'synthetic-fx21',name:'FX21 合成模型',configured:true}],
        preflight:async()=>({}),cancelSession:async()=>({}),readEvents:async()=>({events:[],nextSeq:0}),
        describeSession:async sessionId=>({sessionId,agentPreset:'personal-remote',modelProfileId:'synthetic-fx21'}),
        createSession:async({sessionId})=>{
          return {sessionId};
        },
        sendMessage:async({sessionId,text})=>{
          const time=Date.now();
          const events=[
            {type:'turn/start',seq:0,time,data:{turn:1}},
            {type:'request/header',seq:1,time,data:{reason:'initial',header:{config:{provider:routeForProfile(initialModelId).provider,model:'synthetic-fx21'}}}},
            {type:'user/message',seq:2,time,surfaceOp:'append',data:{id:crypto.randomUUID(),role:'user',source:{kind:'user',rpcId:crypto.randomUUID()},content:[{type:'text',text}]}},
            {type:'turn/end',seq:3,time,data:{turn:1,reason:{kind:'completed'}}},
          ];
          const header=JSON.stringify(codec.encodeHeader({version:3,id:sessionId,createdAt:time,isSeeded:false,delegationDepth:0,cwd,agentPreset:'personal-remote'},0));
          const lines=events.map(event=>JSON.stringify(codec.encodeEvent(event))).join('\n');
          mkdirSync(join(profile,'dsh-home','sessions',projectKey,sessionId),{recursive:true});
          writeFileSync(sessionFile(sessionId),Buffer.concat([zstdCompressSync(header+'\n'),zstdCompressSync(lines+'\n')]));
          return {accepted:true};
        },
      }});
      try {
        const {origin}=await service.start(),grant=await service.issueSetupGrant();
        const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});
        assert.equal(setup.status,201);
        const auth=await setup.json(),headers={origin,'content-type':'application/json',cookie:setup.headers.get('set-cookie').split(';')[0],'x-weftmate-csrf':auth.csrfToken};
        const api=async(path,body?)=>{
          const response=await fetch(origin+'/personal/v1'+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
          const result=await response.json();assert.equal(response.status,body?202:200,JSON.stringify(result));return result;
        };
        const receipt=command=>until(async()=>{
          const {command:row}=await api('/commands/'+command.commandId);
          assert.ok(!['rejected','failed','uncertain'].includes(row.state),JSON.stringify(row));
          return row.state==='accepted_by_dsh'&&row;
        });
        const {hostId}=await api('/status');
        created=await receipt((await api('/commands',{requestId:crypto.randomUUID(),kind:'session.create',targetDeviceId:hostId,modelProfileId:'synthetic-fx21'})).command);
        await receipt((await api('/commands',{requestId:crypto.randomUUID(),kind:'session.message',targetDeviceId:hostId,sessionId:created.sessionId,text:'旧日用版本的合成历史'})).command);
      }finally{await service.close();}
    }
    rmSync(join(profile,'personal-access'),{recursive:true,force:true});
    cpSync(oldAccess,join(profile,'personal-access'),{recursive:true});
    await h.launch();
    const requestId=crypto.randomUUID();
    const added=await h.api('/account/models',{requestId,name:'FX21 升级后模型',baseUrl,modelId:'synthetic-fx21',apiKey:'synthetic-fx21-key'});
    assert.equal(added.status,202,JSON.stringify(added));
    await until(async()=>(await h.api('/account/models/by-request/'+requestId)).body.operation?.status==='succeeded');
    h.modelId=(await h.api('/models')).body.models.find(m=>m.name==='FX21 升级后模型').id;
    h.hostId=(await h.api('/status')).body.hostId;
    const chats=(await h.api('/chats')).body.items;
    assert.equal(chats.find(c=>c.activeSessionId===created.sessionId)?.kind,'side');
    const history=await h.api('/sessions/'+created.sessionId+'/events?limit=200');
    assert.ok(history.body.events.some(e=>e.type==='user.message'&&e.data.text==='旧日用版本的合成历史'));
    assert.ok((await h.firstMessage()).reply);
  }finally{await h?.close();rmSync(root,{recursive:true,force:true});}
});

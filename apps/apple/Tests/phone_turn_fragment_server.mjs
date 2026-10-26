// Isolated real desktop /offline/sync + /offline/turns routes for Swift and Node.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createOfflineService} from '../../../src/personal-offline/index.mjs';
import {createPhoneHistory} from '../../../src/personal-access/phone-history.mjs';

export async function startPhoneTurnFragmentServer(){
  const root=await mkdtemp(join(tmpdir(),'apple-3-fragments-'));
  const identity={ownerId:'owner-test',hostId:'host-test',deviceId:'device-test'};
  const account={sessions:{},commands:{}},config={generation:1};
  const report={sync:[],turns:[],raw:[],accepted:[],assemblies:[],handovers:[],chats:[]};
  const pausedReplies=new Set();
  const permission={allow_local_read:true,allow_cloud_read:true,allow_inference:true};
  const finishReply=res=>{if(!res.destroyed)res.end('data: '+JSON.stringify({choices:[{delta:{content:config.reply??'合成普通回复。'}}]})+'\n\ndata: [DONE]\n\n');pausedReplies.delete(res);};
  const accepted=new Map(),pieces=new Map();
  const snapshotReport=()=>({...report,history:Object.values(account.phoneHistory??{}).flatMap(c=>c.turns)});
  const ctx={root,rootState:{hostId:identity.hostId},timestamp:Date.now,accountState:()=>account,
    serial:async fn=>fn(),mutate:async(_id,fn)=>fn(account),active:new Set(),pendingPreflights:new Set(),
    authenticate:()=>({...identity,via:'cookie',device:{authKind:'cloud',name:'Synthetic iPhone',scopes:['account:manage','sessions:read']}}),
    modelSelectable:()=>true,service:{currentChatModelProfile:()=>null},backend:{listModels:async()=>[]},
    activity:{record:async()=>{}},
    cloudIdentity:{publishOffline:async(_id,generation)=>({hostId:identity.hostId,accountId:'account-test',generation})},
    memoryManager:{enabled:true,peek:()=> 'connected',query:async()=>({world_revision:config.generation,items:config.memory?[{
      item_id:'tea',object_kind:'cognition',current_state:'current',value:{content:'合成电脑记忆：我喜欢茉莉花茶'},permissions:[permission],
      provenance:[{evidence_id:'source-tea',permissions:permission,currentness_state:'current',evidence:{content_available:true}}],updated_at:'2025-01-01T00:00:00Z'
    }]:[]}),discardOfflinePending:async()=>{}},
    historyImport:{list:()=>({imports:[]}),receivePhone:async(_owner,_device,turns,handover)=>{
      report.handovers.push(handover);
      for(const turn of turns)if(!accepted.has(turn.id)){accepted.set(turn.id,turn);report.accepted.push(turn);}
      return {importId:'synthetic-import',state:'receiving'};
    }},
    readJson:async(req,limit)=>{if(req.raw.length>limit)throw Object.assign(Error('BODY_TOO_LARGE'),{status:413,code:'BODY_TOO_LARGE'});return JSON.parse(req.raw);},
    json:(_res,_status,body)=>body,
  };
  ctx.phoneHistory=createPhoneHistory(ctx,ctx.backend);
  let offline=await createOfflineService(ctx);
  const server=createServer((req,res)=>{handle(req,res).catch(error=>{res.writeHead(error.status??500);res.end(JSON.stringify({error:error.code??error.message}));});});
  async function handle(req,res){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);req.raw=Buffer.concat(chunks);
    const body=req.raw.length?JSON.parse(req.raw):{};
    const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
    if(req.url==='/configure'){
      if(body.restart){await offline.close();offline=await createOfflineService(ctx);}
      if(body.generation&&body.generation!==config.generation){await offline.invalidate(identity.ownerId);pieces.clear();}
      Object.assign(config,body);json({ok:true});return;
    }
    if(req.url==='/release'){for(const reply of pausedReplies)finishReply(reply);json({ok:true});return;}
    if(req.url==='/report'){json(snapshotReport());return;}
    if(req.url==='/v1/chat/completions'){
      if(req.headers.authorization!=='Bearer synthetic-state-key'){res.writeHead(401);json({error:'UNAUTHORIZED'});return;}
      report.chats.push(body);res.writeHead(200,{'content-type':'text/event-stream'});
      if(config.pauseModel){pausedReplies.add(res);res.write('data: '+JSON.stringify({choices:[{delta:{content:'合成中途派生片段'}}]})+'\n\n');}
      else finishReply(res);
      return;
    }
    if(['/personal/v1/auth/login','/personal/v1/auth/me'].includes(req.url)){
      res.setHeader('set-cookie','wm_personal_session='+'a'.repeat(43)+'; HttpOnly');
      json({account:{ownerId:identity.ownerId,username:'synthetic',displayName:'Synthetic'},device:{id:identity.deviceId,name:'Synthetic'},csrfToken:'b'.repeat(43)});return;
    }
    if(req.url==='/personal/v1/status'){json(identity);return;}
    if(req.url==='/personal/v1/offline/sync')report.sync.push(body);
    if(req.url==='/personal/v1/offline/turns'){
      report.turns.push(structuredClone(body));report.raw.push(req.raw.toString('base64'));
    }
    const result=await offline.handle(req,res,new URL(req.url,'http://127.0.0.1'),identity.ownerId);
    if(req.url==='/personal/v1/offline/turns'){
      for(const part of body.turnFragments??[]){
        let row=pieces.get(part.id);if(!row){row=new Map();pieces.set(part.id,row);}
        row.set(part.index,Buffer.from(part.data,'base64'));
        if(row.size===part.count){
          const raw=Buffer.concat(Array.from({length:part.count},(_,i)=>row.get(i)));
          report.assemblies.push({id:part.id,sha256:createHash('sha256').update(raw).digest('hex'),timestamp:JSON.parse(raw).timestamp});
        }
      }
      const part=body.turnFragments?.[0];
      if(config.loseFinal&&part?.index===part?.count-1){config.loseFinal=false;req.socket.destroy();return;}
      if(typeof config.pauseAt==='number'&&config.pauseAt===part?.index){result.fragmentReceipts=[];result.receipts=[];}
      if(config.foreignFragment&&result.fragmentReceipts?.length)result.fragmentReceipts[0].id='foreign-turn';
      if(config.wrongIndex&&result.fragmentReceipts?.length)result.fragmentReceipts[0].index++;
      if(config.wrongDigest&&result.fragmentReceipts?.length)result.fragmentReceipts[0].sha256='0'.repeat(64);
      if(config.prematureTurn&&part)result.receipts=[{id:part.id,state:'synced'}];
      if(config.wrongGeneration)result.generation++;
    }
    json(result);
  }
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {origin:`http://127.0.0.1:${server.address().port}`,report,
    async close(){
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await offline.close();
      try{
        const evidence=process.env.APPLE_FRAGMENT_EVIDENCE_DIR;
        if(evidence){await mkdir(evidence,{recursive:true,mode:0o700});await writeFile(join(evidence,basename(root)+'.json'),JSON.stringify(snapshotReport()),{mode:0o600});}
      }finally{await rm(root,{recursive:true,force:true});}
    }};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const fixture=await startPhoneTurnFragmentServer();
  console.log(JSON.stringify({origin:fixture.origin}));
  process.once('SIGTERM',()=>{fixture.close().then(()=>process.exit());});
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import './helpers/posix-project-fixture.mjs';

process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
const {createPersonalAccessService}=await import('../src/personal-access/index.mjs');

test('MODE-1 new work task accepts steer, supplement and stopped-task resume without rewriting its source',async t=>{
  for(const action of ['steer','supplement','resume'])await t.test(action,async()=>{
    const root=mkdtempSync(join(tmpdir(),'mode1-controls-'));
    const sessions=new Set<string>();let events:any[]=[],sends:any[]=[];
    const backend={
      getStatus:async()=>({runtime:'ready',referenceScan:'ready'}),
      listModels:async()=>[{id:'local',model:'synthetic',configured:true}],preflight:async()=>({ok:true}),
      createSession:async({sessionId}:any)=>{sessions.add(sessionId);return {sessionId};},
      describeSession:async(sessionId:string)=>sessions.has(sessionId)?{sessionId,agentPreset:'personal-remote',modelProfileId:'local',running:action==='steer'}:null,
      sendMessage:async(input:any)=>{sends.push(input);return {accepted:true,receiptId:`receipt-${sends.length}`,
        ...(input.mode==='steer'?{steeredReceiptId:'receipt-1'}:{})};},
      readEvents:async({afterSeq}:any)=>({events:events.filter(e=>afterSeq==null||e.seq>afterSeq),nextSeq:events.at(-1)?.seq??afterSeq??-1,hasMore:false}),
      stopTask:async({receiptIds}:any)=>({status:'unconfirmed',outcomes:receiptIds.map((receiptId:string)=>({receiptId,status:'unconfirmed'}))}),
      cancelSession:async()=>({accepted:true}),
    };
    let service:any=await createPersonalAccessService({root,port:0,backend}),origin='',auth:any={};
    const request=async(path:string,body?:any)=>{const res=await fetch(origin+'/personal/v1'+path,{method:body?'POST':'GET',
      headers:{origin,...auth,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};};
    const settled=async(id:string)=>{for(let i=0;i<100;i++){const r=await request('/commands/'+id);if(!['pending','dispatching'].includes(r.body.command.state))return r.body.command;await new Promise(done=>setTimeout(done,20));}throw Error('command did not settle');};
    try{
      const started=await service.start();origin=started.origin;
      const grant=await service.issueSetupGrant();
      const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},
        body:JSON.stringify({grant:grant.grant,username:'SyntheticModeControl',password:'Synthetic mode control password',deviceName:'SyntheticDesktop'})});
      assert.equal(setup.status,201);auth={cookie:setup.headers.get('set-cookie')!.split(';')[0],'x-weftmate-csrf':(await setup.json()).csrfToken};
      const folder=join(root,'SyntheticProject');mkdirSync(folder);
      const project=await request('/projects',{requestId:'register-project',name:'合成工作',rootPath:folder,permission:'write'});assert.equal(project.status,201,JSON.stringify(project.body));
      const created=await request(`/projects/${project.body.project.projectId}/sessions`,{requestId:'create-session',modelProfileId:'local'});
      assert.equal(created.status,202);const sessionId=created.body.command.sessionId;await settled(created.body.command.commandId);
      const source=await request('/commands',{requestId:'original-work',kind:'session.message',targetDeviceId:started.hostId,sessionId,text:'Synthetic original work'});
      assert.equal(source.status,202);const taskId=source.body.command.commandId;assert.equal((await settled(taskId)).state,'accepted_by_dsh');
      const file=join(root,'store.json'),store=JSON.parse(readFileSync(file,'utf8'));
      const account:any=Object.values(store.accounts)[0],original=structuredClone(account.commands[taskId]);
      events=[{seq:1,type:'turn.started',data:{turn:0}},{seq:2,type:'user.message',data:{text:'Synthetic original work',receiptId:'receipt-1'}}];
      if(action==='resume'){
        const stopped=await request(`/tasks/${taskId}/stop`,{requestId:'stop-original'});assert.equal(stopped.status,202);
        events.push({seq:3,type:'turn.ended',data:{turn:0,reason:'aborted'}});
        assert.equal((await request(`/tasks/${taskId}`)).body.control.canResume,true);
      }
      const response=action==='steer'?await request('/commands',{requestId:'follow-up',kind:'session.message',targetDeviceId:started.hostId,sessionId,text:'Synthetic follow-up',mode:'steer'})
        :await request(`/tasks/${taskId}/${action==='resume'?'resume':'supplements'}`,{requestId:'follow-up',text:'Synthetic follow-up'});
      assert.equal(response.status,202,JSON.stringify(response.body));
      const follow=await settled(response.body.command.commandId);
      assert.equal(follow.state,'accepted_by_dsh',JSON.stringify(follow));assert.equal(follow.rootTaskId,taskId);
      const saved=JSON.parse(readFileSync(file,'utf8')),next:any=Object.values(saved.accounts)[0];
      assert.deepEqual(next.commands[taskId].payload,original.payload);assert.equal(next.commands[taskId].payloadHash,original.payloadHash);
      assert.equal(next.commands[follow.commandId].payload.projectId,project.body.project.projectId);
      assert.equal(sends.at(-1).sessionId,sessionId);
      await service.close();service=await createPersonalAccessService({root,port:0,backend});origin=(await service.start()).origin;
      assert.equal((await request('/commands/'+follow.commandId)).body.command.state,'accepted_by_dsh');
    }finally{await service.close();rmSync(root,{recursive:true,force:true});}
  });
});

process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, lstat, unlink, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { phoneRuntime } from '../services/cloud/test/relay-phone-runtime.mjs';
import { createPersonalAccessService } from './helpers/personal-access-test-service.mjs';
const text = (m: any) => typeof m.content === 'string' ? m.content : (m.content || []).map((p: any) => p.text || '').join('');
async function links(dir: string) { for (const item of await readdir(dir,{withFileTypes:true})) {const path=join(dir,item.name);if((await lstat(path)).isSymbolicLink())await unlink(path);else if(item.isDirectory())await links(path);} }
const until = async (read: () => Promise<any>, label: string) => {const end=Date.now()+30000;while(Date.now()<end){const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+label);};

test('D92 completed chat proposal starts a separate work once, preserves refusal, restart, model and permissions', {timeout:90000}, async () => {
  const root=await mkdtemp(join(tmpdir(),'work-proposal-')),logs:string[]=[];
  let runtime:any,host:any,origin:string,headers:any;
  const respond=(body:any)=>{
    if(!body.tools?.length)return {content:'合成对话'};
    const index=body.messages.findLastIndex((m:any)=>m.role==='user'&&text(m).startsWith('SWITCH_'));
    if(index<0)return {content:'继续对话。'};
    const user=text(body.messages[index]);
    const calls=body.messages.slice(index+1).flatMap((m:any)=>m.tool_calls||[]);
    const name=calls.length===0?'load_tools':calls.length===1?'write':null;
    const args=name==='load_tools'?{names:['write']}:{file_path:'result.txt',content:user};
    return name?{content:'',tool_calls:[{id:'proposal-'+randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'文件已写入。'};
  };
  const api=async(path:string,body?:any,method=body===undefined?'GET':'POST',status?:number)=>{
    const res=await fetch(origin+'/personal/v1'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const value:any=await res.json();if(status)assert.equal(res.status,status,JSON.stringify(value));else assert.ok(res.ok,JSON.stringify({path,value}));return value;
  };
  const command=async(body:any)=>{const {command:c}=await api('/commands',{requestId:randomUUID(),targetDeviceId:hostHostId,...body});return until(async()=>{const {command:v}=await api('/commands/'+c.commandId);if(v.state==='rejected')throw Error(v.errorCode);return v.state==='accepted_by_dsh'&&v;},'command');};
  const events=async(id:string)=>(await api(`/sessions/${id}/events?limit=200`)).events;
  let hostHostId:string;
  try {
    runtime=await phoneRuntime(root,logs,{respond});
    const makeHost=async()=>{host=await createPersonalAccessService({root:join(root,'account'),port:0,backend:runtime.backend});runtime.setHost(host);return host.start();};
    await makeHost();await runtime.start();const started=await host.start();origin=started.origin;hostHostId=started.hostId;
    const grant=await host.issueSetupGrant();
    const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'SyntheticProposal',password:'Synthetic proposal password',deviceName:'synthetic-phone'})});
    assert.equal(setup.status,201);const auth:any=await setup.json();
    headers={origin,cookie:setup.headers.get('set-cookie')!.split(';')[0],'content-type':'application/json','x-weftmate-csrf':auth.csrfToken};
    for(const scenario of ['accept','decline','restart']) {
      const folder=join(root,scenario);await mkdir(folder);
      const project=(await api('/projects',{requestId:randomUUID(),name:'合成目录',rootPath:folder,permission:'write'})).project;
      const creation=await command({kind:'session.create',modelProfileId:'synthetic',...(scenario==='restart'?{temporary:true,recallEnabled:false,autoDeleteDays:7}:{})});
      const id=creation.sessionId;
      if(scenario==='accept')await api(`/sessions/${id}/approval-mode`,{mode:'ask'},'PATCH');
      const source=await command({kind:'session.message',sessionId:id,text:'SWITCH_'+scenario,intent:'queue'});
      const card=await until(async()=>(await api(`/sessions/${id}/approvals`)).approvals.find((r:any)=>r.intent==='work-switch'&&r.status==='pending'),'proposal');
      await until(async()=>(await events(id)).some((e:any)=>e.type==='turn.ended'),'proposal ends before click');
      const before=await events(id);
      assert.equal(before.filter((e:any)=>e.type==='turn.ended').length,1);
      assert.equal(before.some((e:any)=>e.data?.toolName==='write'),false,'computer call is not a public step');
      assert.equal(before.some((e:any)=>e.type==='assistant.message'&&e.data.text==='这件事需要在电脑上做。要切换到工作吗？'),true);
      assert.equal((await api(`/tasks/${source.commandId}`)).replyEvidence.status,'completed');
      await assert.rejects(stat(join(folder,'result.txt')));
      assert.equal((await api('/sessions')).sessions.find((s:any)=>s.sessionId===id).mode,'chat');
      if(scenario==='decline') {
        await api(`/sessions/${id}/approvals/${card.approvalId}`,{requestId:randomUUID(),outcome:'rejected'});
        await command({kind:'session.message',sessionId:id,text:'继续聊聊',intent:'queue'});
        await until(async()=>(await events(id)).filter((e:any)=>e.type==='turn.ended').length===2,'next chat turn');
        await assert.rejects(stat(join(folder,'result.txt')));continue;
      }
      if(scenario==='restart') {
        await runtime.close();await host.close();runtime=await phoneRuntime(root,logs,{respond});
        host=await createPersonalAccessService({root:join(root,'account'),port:0,backend:runtime.backend});runtime.setHost(host);await runtime.start();
        const restarted=await host.start();origin=restarted.origin;headers.origin=origin;
        assert.equal((await api(`/sessions/${id}/approvals`)).approvals.find((r:any)=>r.approvalId===card.approvalId).status,'pending','proposal survives service close and recovery');
      }
      const route=`/sessions/${id}/approvals/${card.approvalId}`;
      await api(route,{requestId:randomUUID(),outcome:'allowed-once'},'POST',409);
      const decision={requestId:randomUUID(),outcome:'allowed-once',workProjectId:project.projectId};
      const answer=await api(route,decision),workId=answer.approval.workSessionId;
      assert.notEqual(workId,id);assert.ok(workId);
      assert.equal((await api(route,decision)).approval.workSessionId,workId,'same decision is idempotent');
      await api(route,{...decision,requestId:randomUUID()},'POST',409);
      let current=await until(async()=>(await api(`/sessions/${id}/approvals`)).approvals.find((r:any)=>r.approvalId===card.approvalId&&r.workCommandId),'first work command');
      if(scenario==='accept') {
        const risk=await until(async()=>(await api(`/sessions/${workId}/approvals`)).approvals.find((r:any)=>r.status==='pending'),'work keeps ask mode');
        assert.notEqual(risk.intent,'work-switch');await assert.rejects(stat(join(folder,'result.txt')));
        await api(`/sessions/${workId}/approvals/${risk.approvalId}`,{requestId:randomUUID(),outcome:'allowed-once'});
      }
      await until(async()=>(await events(workId)).some((e:any)=>e.type==='turn.ended'),'work ends');
      const workEvents=await events(workId);
      assert.equal(await readFile(join(folder,'result.txt'),'utf8'),'SWITCH_'+scenario);
      assert.deepEqual(workEvents.filter((e:any)=>e.type==='user.message').map((e:any)=>e.data.text),['SWITCH_'+scenario]);
      const sessions=(await api('/sessions')).sessions;
      assert.equal(sessions.find((s:any)=>s.sessionId===id).mode,'chat');
      assert.equal(sessions.find((s:any)=>s.sessionId===workId).mode,'work');
      assert.equal(sessions.find((s:any)=>s.sessionId===workId).projectId,project.projectId);
      if(scenario==='restart'){assert.equal(sessions.find((s:any)=>s.sessionId===workId).temporary,true);assert.equal(sessions.find((s:any)=>s.sessionId===workId).recallEnabled,false);}
      assert.equal((await api(`/commands/${current.workCommandId}`)).command.kind,'session.message');
      if(scenario==='accept') {
        await api(`/sessions/${workId}`,{},'DELETE');
        const retained=(await api(`/sessions/${id}/approvals`)).approvals.find((r:any)=>r.approvalId===card.approvalId);
        assert.equal(retained.workSessionId,undefined,'deleting work removes the old proposal link');
        assert.equal(host.getApprovalPolicy({sessionId:id}).conversationMode,'chat');
      }
    }
  } finally {await runtime?.close();await host?.close();await links(root);await rm(root,{recursive:true,force:true});}
});

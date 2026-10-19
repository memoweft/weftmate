import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sourceModelDesktop } from '../helpers/source-model-desktop.mjs';

const fixture=await sourceModelDesktop('527');
const {root,page,api,until,capture,events,send,report,hostId}=fixture;
let failure;
try {
  const folder=join(root,'SyntheticDelete'),txt=join(folder,'txt');await mkdir(txt,{recursive:true});
  const target=join(txt,'approve-delete.txt'),reject=join(txt,'refuse-delete.txt'),keep=join(txt,'keep.txt');
  for(const path of [target,reject,keep])await writeFile(path,'SYNTHETIC_KEEP_CONTENT\n');
  const exists=path=>access(path).then(()=>true,()=>false);
  const project=(await api('/projects',{requestId:randomUUID(),name:'合成删除项目',rootPath:folder,permission:'write'})).project;
  const create=(await api(`/projects/${project.projectId}/sessions`,{requestId:randomUUID(),modelProfileId:'synthetic'})).command;
  const id=await until(async()=>{const command=(await api('/commands/'+create.commandId)).command;return command.state==='accepted_by_dsh'&&command.sessionId;},'work session');
  await api(`/sessions/${id}/approval-mode`,{mode:'ask'},'PATCH');
  await page.evaluate(id=>scenarioCore.selectSession(id),id);
  report.approvals=[];
  const cases=[['approve-delete.txt',target,true],...(process.env.WEFTMATE_CHECK_REJECTION==='1'?[['refuse-delete.txt',reject,false]]:[])];
  for(const [name,file,allowed] of cases){
    const before=(await events(id)).filter(e=>e.type==='turn.ended').length;
    await send(`文件 txt/${name} 确实存在。请删除这一个合成文件，只删除它；按每次询问设置先让我批准删除操作。`);
    let deleteDecisions=0;
    await until(async()=>{
      const approvals=(await api(`/sessions/${id}/approvals`)).approvals;
      for(const row of approvals.filter(row=>row.status==='pending')){
        const deletion=/^\[weftmate:[^\]]*\bdelete\b/.test(row.reason||'');
        const allow=!deletion||allowed;
        if(deletion){deleteDecisions++;assert.equal(await exists(file),true,'file still exists before the deletion decision');await capture(allowed?'before-approve':'before-reject');}
        const button=page.locator('#approval-bar').getByRole('button',{name:allow?/^(批准|仅这一次)$/:/^拒绝$/,exact:true}).first();
        await button.click();report.approvals.push({deletion,allowed:allow,callId:row.callId,toolName:row.toolName,reason:row.reason});
      }
      const rows=await events(id);
      return rows.filter(e=>e.type==='turn.ended').length>before;
    },'approved/rejected deletion ends',120000);
    assert.equal(deleteDecisions,1,'one deletion decision, without a second terminal confirmation');
    assert.equal(await exists(file),!allowed);
    assert.equal(await readFile(keep,'utf8'),'SYNTHETIC_KEEP_CONTENT\n');
    await capture(allowed?'deleted':'rejected-preserved');
  }
  report.deleted=true;report.rejectionChecked=process.env.WEFTMATE_CHECK_REJECTION==='1';report.rejectedPreserved=report.rejectionChecked?true:null;report.untouchedPreserved=true;report.passed=true;
  console.log('527 PASS: approved target deleted; sentinel preserved');
}catch(error){failure=error;await capture('failure').catch(()=>{});console.error(error.message);process.exitCode=1;}
finally{await fixture.close(failure);}

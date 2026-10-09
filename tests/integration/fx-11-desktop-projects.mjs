/** Targeted real main.mjs + fixed DSH + MiMo acceptance. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function verify({desktop, profile, evidence, report, api, model}) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check) {
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){const value=await check();if(value)return value;await pause(250);}
    throw Error('FX-11 desktop condition timed out');
  }
  const hostId=(await api('/status')).body.hostId;
  async function accepted(response) {
    assert.equal(response.status,202,JSON.stringify(response.body));
    return until(async()=>{const row=(await api('/commands/'+response.body.command.commandId)).body.command;
      assert.ok(['pending','dispatching','accepted_by_dsh'].includes(row.state),JSON.stringify(row));return row.state==='accepted_by_dsh'&&row;});
  }
  async function select(id,title) {
    await api('/sessions/'+id+'/metadata',{title},'PATCH');
    await desktop.reload();await desktop.getByRole('button',{name:title,exact:true}).click();
    assert.equal((await api('/sessions/'+id+'/approval-mode',{mode:'ask'},'PATCH')).status,200);
  }
  async function task(id,file,marker) {
    await desktop.locator('#message-text').fill(`请直接使用 write 首次创建 ${file}，内容只写 ${marker}，再用 read 读回核验。不要使用命令工具写文件，不要读取其他文件；如果 write 报错就停止，不要重试。`);
    await desktop.locator('#send-message').click();
    const deadline=Date.now()+240000;let events, approvals=0;
    while(Date.now()<deadline){
      const approve=desktop.getByRole('button',{name:'批准',exact:true});
      if(await approve.isVisible()){await approve.click();approvals++;}
      events=(await api('/sessions/'+id+'/events?limit=200')).body.events;
      if(events.some(e=>e.type==='turn.ended'))break;
      await pause(500);
    }
    assert.ok(events.some(e=>e.type==='turn.ended'),'native turn finished');
    const writes=events.filter(e=>e.type==='step.started'&&e.data.toolName==='write');
    assert.equal(writes.length,1,'exactly one direct write; no fallback or retry');
    const artifact=events.find(e=>e.type==='artifact.created'&&e.data.completedStep?.stepId===writes[0].data.stepId);
    assert.equal(artifact?.data.completedStep.state,'completed');
    assert.ok(approvals>0,'native approvals exercised');
    assert.ok(events.some(e=>e.type==='step.completed'&&e.data.toolName==='read'&&e.data.state==='completed'));
    assert.ok(!events.some(e=>e.type==='step.started'&&['pwsh','shell','bash'].includes(e.data.toolName)));
    const filename=file.split(/[\\/]/).at(-1);
    await until(()=>desktop.getByText(filename,{exact:true}).count());
    const summaries=await desktop.locator('.inline-progress-summary').allTextContents();
    assert.ok(summaries.length);
    assert.doesNotMatch(summaries.join('\n'),/load_tools|todo_write|工具步骤|执行工具/);
    report.scenarios ||= [];
    report.scenarios.push({sessionId:id,fileName:filename,writeCalls:1,firstWrite:'completed',artifactRegistered:true,readCompleted:true,approvals,summaries});
    await writeFile(join(evidence,filename+'.events.json'),JSON.stringify(events,null,2));
    return events;
  }
  const ordinary=(await accepted(await api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:hostId,modelProfileId:model.id}))).sessionId;
  await select(ordinary,'普通对话首次写入');
  const ordinaryFile=join(profile,'ordinary-first.txt').replaceAll('\\','/');
  await task(ordinary,ordinaryFile,'FX11_ORDINARY_FIRST');
  assert.equal((await readFile(ordinaryFile,'utf8')).trim(),'FX11_ORDINARY_FIRST');
  for(const theme of ['light','dark']){await desktop.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await desktop.screenshot({path:join(evidence,'ordinary-progress-'+theme+'.png')});}

  const folder=join(profile,'synthetic-project');await mkdir(folder);
  await desktop.getByRole('button',{name:'新建项目',exact:true}).click();
  const create=desktop.getByRole('dialog',{name:'新建项目',exact:true});
  await create.getByRole('textbox',{name:'电脑上的文件夹',exact:true}).fill(folder);
  await create.getByRole('textbox',{name:'电脑上的文件夹',exact:true}).press('Tab');
  await create.getByRole('textbox',{name:'项目名称',exact:true}).fill('首写验收项目');
  await create.getByRole('textbox',{name:'项目说明',exact:true}).fill('只处理本项目的合成文件。');
  const permission=create.getByRole('combobox',{name:'文件权限',exact:true});
  assert.equal(await permission.evaluate(node=>node.tagName),'BUTTON');
  await permission.scrollIntoViewIfNeeded();
  for(const theme of ['light','dark']){await desktop.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await permission.click();await create.getByRole('option',{name:'只读',exact:true}).waitFor();await desktop.screenshot({path:join(evidence,'create-project-permission-'+theme+'.png')});await desktop.keyboard.press('Escape');}
  await permission.focus();await desktop.keyboard.press('ArrowDown');await desktop.keyboard.press('Home');await desktop.keyboard.press('Enter');
  assert.equal(await permission.innerText(),'只读');
  await permission.click();await create.getByRole('option',{name:'可写',exact:true}).click();
  await create.getByRole('button',{name:'创建项目',exact:true}).click();await create.waitFor({state:'hidden'});
  let project=(await api('/projects')).body.projects.find(p=>p.name==='首写验收项目');assert.equal(project.permission,'write');
  await desktop.getByRole('button',{name:'项目设置 首写验收项目',exact:true}).click();
  const edit=desktop.getByRole('dialog',{name:'项目设置',exact:true}), editedPermission=edit.getByRole('combobox',{name:'文件权限',exact:true});
  for(const theme of ['light','dark']){await desktop.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await editedPermission.click();await desktop.screenshot({path:join(evidence,'edit-project-permission-'+theme+'.png')});await desktop.keyboard.press('Escape');}
  await editedPermission.click();await edit.getByRole('option',{name:'只读',exact:true}).click();
  await edit.getByRole('button',{name:'保存',exact:true}).click();await edit.waitFor({state:'hidden'});
  project=(await api('/projects')).body.projects.find(p=>p.projectId===project.projectId);assert.equal(project.permission,'read-only');
  await desktop.getByRole('button',{name:'项目设置 首写验收项目',exact:true}).click();
  await edit.getByRole('combobox',{name:'文件权限',exact:true}).click();await edit.getByRole('option',{name:'可写',exact:true}).click();
  await edit.getByRole('button',{name:'保存',exact:true}).click();await edit.waitFor({state:'hidden'});
  const created=await accepted(await api('/projects/'+project.projectId+'/sessions',{requestId:randomUUID(),modelProfileId:model.id}));
  await select(created.sessionId,'项目对话首次写入');
  await task(created.sessionId,'project-first.txt','FX11_PROJECT_FIRST');
  assert.equal((await readFile(join(folder,'project-first.txt'),'utf8')).trim(),'FX11_PROJECT_FIRST');
  for(const theme of ['light','dark']){await desktop.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await desktop.screenshot({path:join(evidence,'project-progress-'+theme+'.png')});}
  report.projectPermission={sharedCombobox:true,keyboard:true,newProjectSaved:true,editedReadonly:true,editedWritable:true};
}

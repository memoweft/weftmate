/** Packaged paths and real main gateway. Synthetic account/model, no daily data. */
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {buildWindowsRelease} from '../release/windows.mjs';
import {buildForSmoke} from './installed-build.mjs';
import {keyId} from '../../src/personal-update/manifest.mjs';
import {migrationHost,until} from '../../tests/helpers/migration-host.mjs';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const out=resolve(option('--out','.local/installed-smoke'));mkdirSync(out,{recursive:true});
const temp=mkdtempSync(join(tmpdir(),'weftmate-fx21-install-')),report={synthetic:true,realMain:true,pinnedDsh:true,realInstall:process.argv.includes('--install'),checks:[]};
let h,installed=false,installation=join(temp,'installed'),build;
const run=(command,args)=>new Promise((done,reject)=>{const p=spawn(command,args,{windowsHide:true,stdio:'inherit'});p.once('error',reject);p.once('close',code=>code===0?done():reject(Error(`process exit ${code}`)));});
try {
  let executable=option('--executable');
  const existingInstaller=option('--installer');
  if(existingInstaller){report.installerSha256=createHash('sha256').update(readFileSync(resolve(existingInstaller))).digest('hex');await run(resolve(existingInstaller),['--updated','/S','/currentuser',`/D=${installation}`]);installed=true;executable=join(installation,'WeftMate.exe');}
  if(!executable){
    const signing=join(temp,'signing');mkdirSync(signing);
    const pair=generateKeyPairSync('ed25519'),pub=pair.publicKey.export({type:'spki',format:'pem'});
    const privateFile=join(signing,'private.pem'),keys=join(signing,'keys.json');
    writeFileSync(privateFile,pair.privateKey.export({type:'pkcs8',format:'pem'}));writeFileSync(keys,JSON.stringify({[keyId(pub)]:pub}));
    const previous=process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH;process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH=privateFile;
    const releaseRoot=resolve(option('--build-root',join(temp,'release')));
    build=join(releaseRoot,'0.1.1-preview.21','build');
    try{Object.assign(report,await buildForSmoke(buildWindowsRelease,{version:'0.1.1-preview.21',channel:'preview',output:releaseRoot,'trusted-keys':keys,'test-identity':'fx21qa',...(option('--prebuilt-stage')?{'prebuilt-stage':resolve(option('--prebuilt-stage'))}:{})},join(build,'win-unpacked','WeftMate.exe'),!report.realInstall));}
    finally{if(previous===undefined)delete process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH;else process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH=previous;rmSync(signing,{recursive:true,force:true});}
    build=join(releaseRoot,'0.1.1-preview.21','build');
    const installer=join(build,'WeftMate-Setup-0.1.1-preview.21.exe');
    report.installerSha256=createHash('sha256').update(readFileSync(installer)).digest('hex');
    if(report.realInstall){await run(installer,['--updated','/S','/currentuser',`/D=${installation}`]);installed=true;executable=join(installation,'WeftMate.exe');}
    else executable=join(build,'win-unpacked','WeftMate.exe');
  }
  h=await migrationHost({executable});
  h.page.on('response',async r=>{if(r.url().includes('/commands')){try{const value=await r.json();if(value.command)report.folderCommands=[...(report.folderCommands||[]),{kind:value.command.kind,state:value.command.state,errorCode:value.command.errorCode}];}catch{}}});
  report.packaged=await h.app.evaluate(({app})=>({isPackaged:app.isPackaged,appPath:app.getAppPath()}));assert.equal(report.packaged.isPackaged,true);
  report.main=await h.mainFirst();report.checks.push('fresh-main-created-and-replied');
  await h.page.reload();await h.page.locator('#message-text').waitFor({state:'visible'});
  for(const theme of ['light','dark']){await h.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await h.page.screenshot({path:join(out,`installed-main-${theme}.png`)});}
  const project=join(h.root,'synthetic-project'),exported=join(h.root,'conversation.md');mkdirSync(project);writeFileSync(join(project,'brief.md'),'FX21 synthetic project file\n');
  await h.app.evaluate(({dialog},{project,exported})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});},{project,exported});
  await h.page.reload();await h.page.locator('#message-text').waitFor({state:'visible'});
  await h.page.locator('#attachment-add').click();await h.page.getByRole('menuitem',{name:'选择文件夹',exact:true}).click();
  await h.page.getByRole('button',{name:'在这个文件夹里工作',exact:true}).waitFor();
  for(const theme of ['light','dark']){await h.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await h.page.screenshot({path:join(out,`folder-confirm-${theme}.png`)});}
  await h.page.getByRole('button',{name:'在这个文件夹里工作',exact:true}).click();
  const registered=await until(async()=>{const r=await h.api('/projects');return r.body.projects?.find(p=>p.name==='synthetic-project')||r.body.items?.find(p=>p.name==='synthetic-project');});
  report.project={name:registered.name,permission:registered.permission};report.checks.push('native-folder-picker-substitute-registered-project');
  await until(async()=>{const card=h.page.getByRole('region',{name:'在文件夹里工作',exact:true});const error=h.page.getByText('项目已创建，对话尚未移入，请重试',{exact:true});if(await error.isVisible())throw Error('Folder registered but project conversation failed: '+JSON.stringify(report.folderCommands));return await h.page.locator('.folder-confirm').count()===0;});
  const me=(await h.api('/auth/me')).body;
  const patched=await h.api('/projects/'+registered.projectId,{expectedRevision:registered.revision,permission:'write'},'PATCH');assert.equal(patched.status,200);
  const creation=await h.api(`/projects/${registered.projectId}/sessions`,{requestId:randomUUID(),modelProfileId:h.modelId});const session=await h.receipt(creation.body.command);
  await h.page.reload();await h.page.locator('#assistant-view').waitFor({state:'visible'});
  await h.page.locator(`.session-row[data-session-id="${session.sessionId}"] > button`).first().click();
  assert.equal((await h.api(`/sessions/${session.sessionId}/approval-mode`,{mode:'ask'},'PATCH')).status,200);
  let calls=0;
  h.respond=async input=>{
    if(!input.stream)return {role:'assistant',content:'synthetic provider ready'};
    const tool=['load_tools','read','write'][calls++];
    if(!tool)return {role:'assistant',content:'FX21 synthetic project file 已读取，并保存 approved.md。'};
    const args=tool==='load_tools'?{names:['read','write']}:tool==='read'?{file_path:'brief.md'}:{file_path:'approved.md',content:'FX21 synthetic project file\n'};
    return {role:'assistant',tool_calls:[{index:0,id:'call-'+randomUUID(),type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]};
  };
  const sent=await h.api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:h.hostId,sessionId:session.sessionId,text:'读取合成项目 brief.md，并写 approved.md，等待审批。'});await h.receipt(sent.body.command);
  const decisions=[];
  await until(async()=>{
    const rows=(await h.api(`/sessions/${session.sessionId}/approvals`)).body.approvals||[];
    for(const approval of rows.filter(a=>a.status==='pending'&&!decisions.includes(a.approvalId))){
      assert.equal(existsSync(join(project,'approved.md')),false);
      const approve=h.page.locator(`[data-conversation-approval="${approval.approvalId}"]`).getByRole('button',{name:'批准',exact:true});
      await approve.waitFor({state:'visible',timeout:15000});
      await h.page.mouse.move(900,400);
      for(const theme of ['light','dark']){await h.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await h.page.screenshot({path:join(out,`approval-${decisions.length+1}-${theme}.png`)});}
      await approve.click();
      await until(async()=>{const rows=(await h.api(`/sessions/${session.sessionId}/approvals`)).body.approvals||[];return !rows.some(r=>r.approvalId===approval.approvalId&&r.status==='pending');});
      decisions.push(approval.approvalId);
    }
    return existsSync(join(project,'approved.md'));
  });
  report.approvals=decisions;assert.ok(decisions.length>0);
  assert.equal(readFileSync(join(project,'approved.md'),'utf8'),'FX21 synthetic project file\n');
  const task=await until(async()=>{const r=await h.api('/tasks/'+sent.body.command.commandId);return r.body.replyEvidence?.status==='completed'&&r.body;});
  report.readProof=h.requests.some(r=>r.messages?.some(m=>m.role==='tool'&&String(m.content).includes('FX21 synthetic project file')));
  assert.ok(report.readProof,'real native read result must reach the synthetic provider');report.checks.push('native-project-read-and-approved-write');
  // Export through the installed native bridge; only the system dialog result is replaced.
  const history=(await h.api(`/sessions/${report.main.sessionId}/events?limit=200`)).body.events;
  const markdown=history.filter(e=>['user.message','assistant.message'].includes(e.type)).map(e=>`## ${e.type==='user.message'?'本人':'WeftMate'}\n\n${e.data.text}`).join('\n\n');
  const exportedResult=await h.page.evaluate(async ({ownerId,markdown})=>window.weftmateDesktop.exportConversation({contentType:'text/markdown',bytes:new Uint8Array(new TextEncoder().encode(markdown)),ownerId}),{ownerId:me.account.ownerId,markdown});
  assert.ok(exportedResult.exported,JSON.stringify(exportedResult));assert.ok(readFileSync(exported,'utf8').includes('首条消息成功'));report.checks.push('native-conversation-export-written');
  for(const theme of ['light','dark']){await h.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await h.page.screenshot({path:join(out,`installed-project-${theme}.png`)});}
  await h.page.locator('#account-menu-trigger').click();await h.page.locator('#rail-account').click();
  await h.page.getByRole('button',{name:'助手',exact:true}).click();
  await h.page.locator('#personalization-nextSuggestionsEnabled').waitFor();
  const switches=await h.page.locator('.personalization-form input.settings-switch').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
  assert.ok(switches.length>0&&switches.every(s=>s.width===44&&s.height===26),JSON.stringify(switches));
  assert.equal(await h.page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).count(),0);
  for(const theme of ['light','dark']){await h.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await h.page.screenshot({path:join(out,`assistant-settings-${theme}.png`)});}
  await h.page.locator('#personalization-nextSuggestionsEnabled').click();
  await h.page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).waitFor({state:'visible'});
  report.switches=switches;report.checks.push('assistant-switch-size-and-save-toast');
  await h.page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await h.page.getByText('已同步 · 从下一次回复开始生效',{exact:true}).waitFor({state:'hidden'});
  await h.app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());w.setBounds({width:480,height:780});});
  await h.page.waitForTimeout(100);
  const desktopGeometry=await h.page.locator('#send-message').evaluate(n=>({bottom:n.getBoundingClientRect().bottom,height:innerHeight,pageHeight:document.documentElement.scrollHeight}));
  assert.ok(desktopGeometry.bottom<=desktopGeometry.height,JSON.stringify(desktopGeometry));report.desktop480=desktopGeometry;
  for(const theme of ['light','dark']){await h.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await h.page.screenshot({path:join(out,`desktop-480-${theme}.png`)});}
  report.smokePassed=true;report.passed=report.buildPassed!==false;
  if(!report.passed)process.exitCode=1;
}catch(error){report.error=error.stack;report.passed=false;process.exitCode=1;}
finally{
  if(h)report.modelCalls=h.requests.map(r=>({stream:r.stream,toolResponses:r.messages?.filter(m=>m.role==='tool').map(m=>({name:m.name,content:String(m.content).slice(0,1000)}))}));
  await h?.close();
  if(installed){const uninstaller=join(installation,'Uninstall WeftMate.exe');await run(uninstaller,['/S',`_?=${installation}`]);report.uninstalled=true;}
  rmSync(temp,{recursive:true,force:true});
  writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));
}

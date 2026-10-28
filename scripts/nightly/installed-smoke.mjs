/** Packaged paths and real main gateway. Synthetic account/model, no daily data. */
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync,readdirSync} from 'node:fs';
import {managedMkdtempSync} from '../../tests/helpers/managed-temp.mjs';
import {join,resolve,parse} from 'node:path';
import {UUID} from 'builder-util-runtime';
import {buildWindowsRelease} from '../release/windows.mjs';
import {buildForSmoke} from './installed-build.mjs';
import {keyId} from '../../src/personal-update/manifest.mjs';
import {migrationHost,until} from '../../tests/helpers/migration-host.mjs';
import {redactBuildMachineIdentity} from '../windows-package-policy.mjs';
import {createProcessEvidence} from '../../tests/helpers/process-evidence.mjs';
import {installedSmokeFailureSummary} from './installed-smoke-diagnostics.mjs';
import {createInstalledSmokeResponder,installedSmokePrompt,installedSmokeRequestKind} from './installed-smoke-provider.mjs';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const testIdentity=option('--test-identity','fx21qa');assert.match(testIdentity,/^[a-z0-9]+$/);
const out=resolve(option('--out','.local/installed-smoke'));mkdirSync(out,{recursive:true});
// Match the Windows CI fixture's isolated system-drive temp placement: native
// folder dialogs display literal paths, so a user-profile TEMP leaks in PNGs.
const temp=managedMkdtempSync('weftmate-fx21-install-'),report={synthetic:true,realMain:true,pinnedDsh:true,realInstall:process.argv.includes('--install'),checks:[]};
let h,installed=false,installation=join(temp,'installed'),build,executable;
const started=Date.now();
const runnerEvidence=createProcessEvidence({outputDir:join(out,'runner-processes'),commandRoots:[temp],executables:[process.execPath],startedAt:started});
const hostLogRows=profile=>readdirSync(join(profile,'logs')).filter(name=>/^host-\d{4}-\d\d-\d\d(?:-\d+)?\.jsonl$/.test(name)).flatMap(name=>readFileSync(join(profile,'logs',name),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));
const installedExecutable=()=>{const files=readdirSync(installation).filter(name=>/^WeftMate(?:-[a-z0-9]+)?\.exe$/.test(name));assert.equal(files.length,1);return join(installation,files[0]);};
report.testIdentity=testIdentity;
const testGuid=UUID.v5(`com.memoweft.weftmate.${testIdentity}`,UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
const hasTestInstallation=()=>{
  const result=runnerEvidence.runSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::Out.Write((Test-Path -LiteralPath $env:WEFTMATE_SMOKE_REGISTRY_PATH).ToString())'],{encoding:'utf8',windowsHide:true,env:{...process.env,WEFTMATE_SMOKE_REGISTRY_PATH:`HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${testGuid}`}});
  assert.equal(result.status,0);return result.stdout.trim()==='True';
};
const run=async(command,args)=>{const handle=runnerEvidence.spawn(command,args);handle.child.stdout?.pipe(process.stdout,{end:false});handle.child.stderr?.pipe(process.stderr,{end:false});const result=await handle.done;if(result.decimal!==0||result.spawnErrorCode)throw Error(`process exit ${result.decimal} (${result.hexadecimal}) ${result.meaning} ${result.spawnErrorCode||''}`);};
try {
  executable=option('--executable');
  const existingInstaller=option('--installer');
  if(existingInstaller){report.installerSha256=createHash('sha256').update(readFileSync(resolve(existingInstaller))).digest('hex');await run(resolve(existingInstaller),['--updated','/S','/currentuser',`/D=${installation}`]);installed=true;executable=installedExecutable();}
  if(!executable){
    const signing=join(temp,'signing');mkdirSync(signing);
    const pair=generateKeyPairSync('ed25519'),pub=pair.publicKey.export({type:'spki',format:'pem'});
    const privateFile=join(signing,'private.pem'),keys=join(signing,'keys.json');
    writeFileSync(privateFile,pair.privateKey.export({type:'pkcs8',format:'pem'}));writeFileSync(keys,JSON.stringify({[keyId(pub)]:pub}));
    const previous=process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH;process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH=privateFile;
    const releaseRoot=resolve(option('--build-root',join(temp,'release')));
    build=join(releaseRoot,'0.1.1-preview.21','build');
    try{Object.assign(report,await buildForSmoke(buildWindowsRelease,{version:'0.1.1-preview.21',channel:'preview',output:releaseRoot,'trusted-keys':keys,'test-identity':testIdentity,'isolate-test-executable':'true',...(option('--memory-runtime-mode')?{'memory-runtime-mode':option('--memory-runtime-mode')} : {}),...(option('--memory-runtime-dir')?{'memory-runtime-dir':resolve(option('--memory-runtime-dir'))}:{}),...(option('--prebuilt-stage')?{'prebuilt-stage':resolve(option('--prebuilt-stage'))}:{})},join(build,'win-unpacked',`WeftMate-${testIdentity}.exe`),!report.realInstall));report.buildSeconds=(Date.now()-started)/1000;}

    finally{if(previous===undefined)delete process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH;else process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH=previous;rmSync(signing,{recursive:true,force:true});}
    build=join(releaseRoot,'0.1.1-preview.21','build');
    const installer=join(build,'WeftMate-Setup-0.1.1-preview.21.exe');
    report.installerSha256=createHash('sha256').update(readFileSync(installer)).digest('hex');
    if(report.realInstall){await run(installer,['--updated','/S','/currentuser',`/D=${installation}`]);installed=true;executable=installedExecutable();}
    else executable=join(build,'win-unpacked',`WeftMate-${testIdentity}.exe`);
  }
  h=await migrationHost({nativeSession:true,executable,tempRoot:temp,respond:createInstalledSmokeResponder(),processEvidence:({root,profile,executable})=>createProcessEvidence({outputDir:join(out,'electron-processes'),profileDirectory:profile,commandRoots:[root],executables:[executable,process.execPath],startedAt:started})});
  if(installed){report.installationRegistered=hasTestInstallation();assert.equal(report.installationRegistered,true);}
  h.page.on('response',async r=>{if(r.url().includes('/commands')){try{const value=await r.json();if(value.command)report.folderCommands=[...(report.folderCommands||[]),{kind:value.command.kind,state:value.command.state,errorCode:value.command.errorCode}];}catch{}}});
  report.packaged=await h.app.evaluate(({app})=>({isPackaged:app.isPackaged,appPath:app.getAppPath()}));assert.equal(report.packaged.isPackaged,true);
  const diagnosticPaths=await h.app.evaluate(({app,crashReporter})=>({userData:app.getPath('userData'),crashDumps:app.getPath('crashDumps'),uploadToServer:crashReporter.getUploadToServer()}));
  assert.equal(realpathSync(diagnosticPaths.userData),realpathSync(h.profile));assert.equal(diagnosticPaths.crashDumps,join(h.profile,'Crashpad'));assert.equal(diagnosticPaths.uploadToServer,false);
  const system=(await h.api('/system')).body;assert.equal(system.runRecord.state,'ready');
  const activeRunId=system.runRecord.runId,initialLogs=hostLogRows(h.profile);
  assert.ok(initialLogs.some(row=>row.event==='host.start'&&row.runId===activeRunId));assert.equal(initialLogs.some(row=>row.event==='host.exit'&&row.runId===activeRunId),false);
  report.diagnostics={runId:activeRunId,logDirectory:'<dataDirectory>/logs',crashDirectory:'<dataDirectory>/Crashpad',uploadToServer:false,runRecordState:system.runRecord.state,hostStartRecorded:true,hostExitRecordedBeforeClose:false};report.checks.push('packaged-local-diagnostic-paths-and-active-run');
  report.nativeBindingLoaded=await h.app.evaluate(({app})=>{const {createRequire}=process.getBuiltinModule('module');const native=createRequire(app.getAppPath()+'/package.json')('get-windows');return typeof native.activeWindowSync==='function'&&typeof native.openWindowsSync==='function';});assert.equal(report.nativeBindingLoaded,true);
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
  await h.page.getByRole('button',{name:'新建对话',exact:true}).click();
  await h.page.getByRole('tablist',{name:'新对话模式',exact:true}).getByRole('tab',{name:'新对话：工作',exact:true}).click();
  await h.page.getByRole('button',{name:'电脑：synthetic-host',exact:true}).click();
  await h.page.getByRole('menu',{name:'选择电脑',exact:true}).getByRole('menuitemradio',{name:'synthetic-host',exact:true}).click();
  await h.page.getByRole('button',{name:'选择项目或文件夹',exact:true}).click();
  await h.page.getByRole('menu',{name:'选择项目或文件夹',exact:true}).getByRole('menuitemradio',{name:/^synthetic-project/}).click();
  await h.page.getByRole('button',{name:'自动',exact:true}).click();
  await h.page.getByRole('menu',{name:'审批模式',exact:true}).getByRole('menuitemradio',{name:/^每次询问/}).click();
  await h.page.getByRole('textbox',{name:'输入消息',exact:true}).fill(installedSmokePrompt);
  const [response]=await Promise.all([
    h.page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/personal/v1/commands'&&response.request().postDataJSON()?.kind==='session.message'),
    h.page.getByRole('button',{name:'发送',exact:true}).click(),
  ]);
  assert.equal(response.status(),202);
  const sent={body:await response.json()},session=await h.receipt(sent.body.command);
  assert.equal(response.request().postDataJSON().targetDeviceId,h.hostId);
  const workSession=await until(async()=>{const rows=(await h.api('/sessions')).body.sessions;return rows?.find(row=>row.sessionId===session.sessionId);});
  assert.equal(workSession.projectId,registered.projectId);assert.equal(workSession.mode,'work');
  await h.page.reload();await h.page.locator('#assistant-view').waitFor({state:'visible'});
  await h.page.locator(`.session-row[data-session-id="${session.sessionId}"] > button`).first().click();
  // Restore the created work conversation before reviewing its pending approval.
  await h.page.waitForFunction(id=>{
    const row=document.querySelector(`.session-row[data-session-id="${id}"] > button`);
    return row?.classList.contains('is-current') && !document.querySelector('#message-text')?.disabled;
  },session.sessionId);
  assert.equal((await h.api(`/sessions/${session.sessionId}/approval-mode`)).body.mode,'ask');
  report.checks.push('new-work-draft-first-message-through-ui');
  const decisions=[];
  report.approvals=decisions; // Preserve already-approved cards even if the later wait fails.
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
  report.readProof=h.requests.some(r=>installedSmokeRequestKind(r)==='project'&&r.messages?.some(m=>m.role==='tool'&&String(m.content).includes('FX21 synthetic project file')));
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
  await h.page.getByRole('dialog',{name:'设置',exact:true}).evaluate(async dialog=>{
    await Promise.all(dialog.getAnimations().map(animation=>animation.finished));
  });
  const switches=await h.page.locator('.personalization-form input.settings-switch').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
  // Measure the settled dialog; retain the original control-size tolerance.
  assert.ok(switches.length>0&&switches.every(s=>Math.abs(s.width-36)<0.5&&Math.abs(s.height-22)<0.5),JSON.stringify(switches));
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
}catch(error){report.error=error.stack;report.electronProcessCleanup=error.processCleanup;report.passed=false;process.exitCode=1;
  report.failureView=await h?.page?.evaluate(()=>({title:document.querySelector('#assistant-title')?.textContent,
    selectedSessions:[...document.querySelectorAll('.session-row > button.is-current')].map(row=>row.parentElement.dataset.sessionId),
    messageDisabled:document.querySelector('#message-text')?.disabled,transcript:document.querySelector('#transcript')?.innerText,
    approvalCards:[...document.querySelectorAll('[data-conversation-approval]')].map(row=>({id:row.dataset.conversationApproval,text:row.innerText}))})).catch(()=>null);
  const failureSummary=installedSmokeFailureSummary({error:report.error,failureView:report.failureView,stderr:h?.stderr,firstWindowDiagnostics:error.firstWindowDiagnostics});
  Object.assign(report,failureSummary);
  console.error('Packaged smoke failure:',redactBuildMachineIdentity(JSON.stringify(failureSummary)).replaceAll(temp,'%TEMP%'));
}
finally{
  if(h)report.modelCalls=h.requests.map(r=>({stream:r.stream,...h.respond.describe(r),toolResponses:r.messages?.filter(m=>m.role==='tool').map(m=>({name:m.name,content:String(m.content).slice(0,1000)}))}));
  try{
  await h?.close({failed:!report.smokePassed,beforeDataRemoval:()=>{
    if(!report.smokePassed)return;
    const exit=hostLogRows(h.profile).findLast(row=>row.event==='host.exit'&&row.runId===report.diagnostics?.runId);
    assert.ok(exit,'normal packaged close must write host.exit');assert.equal(exit.normal,true);assert.equal(exit.exitCode,0);assert.equal(exit.cleanupComplete,true);
    report.diagnostics.hostExitRecordedAfterClose=true;report.diagnostics.normalExit=true;report.checks.push('packaged-normal-close-recorded');
  }});
  report.electronProcessCleanup=h?.processCleanup||report.electronProcessCleanup;
  if(installed){const files=readdirSync(installation).filter(name=>/^Uninstall WeftMate(?:-[a-z0-9]+)?\.exe$/.test(name));assert.equal(files.length,1);await run(join(installation,files[0]),['/S',`_?=${installation}`]);report.uninstalled=!existsSync(executable);report.installationRegistrationRemoved=!hasTestInstallation();assert.equal(report.uninstalled,true);assert.equal(report.installationRegistrationRemoved,true);}
  }catch(error){report.cleanupError=error.stack;report.electronProcessCleanup=h?.processCleanup||report.electronProcessCleanup;report.passed=false;process.exitCode=1;}
  report.runnerProcessCleanup=await runnerEvidence.finalize({failed:!report.passed});
  if(!report.runnerProcessCleanup.stillRunning&&!report.runnerProcessCleanup.preservationError&&!report.electronProcessCleanup?.stillRunning&&!report.electronProcessCleanup?.preservationError)rmSync(temp,{recursive:true,force:true});
  report.durationSeconds=(Date.now()-started)/1000;
  writeFileSync(join(out,'results.json'),JSON.stringify(report,(_key,value)=>typeof value==='string'?redactBuildMachineIdentity(value).replaceAll(temp,'%TEMP%'):value,2));
}

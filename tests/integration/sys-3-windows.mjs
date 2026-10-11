/** Real installed Windows app; synthetic identities and provider. No desktop input automation. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { _electron } from 'playwright';
import { migrationHost, nativeOwnerSession, until } from '../helpers/migration-host.mjs';
import { managedMkdtempSync } from '../helpers/managed-temp.mjs';
import { createProcessEvidence, redactEvidenceText } from '../helpers/process-evidence.mjs';
import { desktopConfigPath } from '../../src/desktop-config.mjs';
import { sendToRegistryKeys } from '../../src/windows-system-integration.mjs';

const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const installer = resolve(option('--installer', '.local/sys3-release/0.1.1-preview.21/build/WeftMate-Setup-0.1.1-preview.21.exe'));
const out = resolve(option('--out', 'tests/evidence/sys-3'));
const identity = 'sys3qa', appId = 'com.memoweft.weftmate.sys3qa';
const temp = managedMkdtempSync('weftmate-sys3-'), installation = join(temp, 'custom install 合成目录');
const startedAt = Date.now();
const runner = createProcessEvidence({outputDir:resolve('.local/sys3-processes'),commandRoots:[temp],executables:[process.execPath,installer],startedAt});
const report = {realInstalledApp:true,syntheticAccount:true,realModelRequests:0,checks:[],launches:[],notifications:[],cleanup:{}};
let h, installed = false, executable, configFile, priorConfig;
mkdirSync(out,{recursive:true});
const reg = args => spawnSync('reg.exe',args,{encoding:'utf8',windowsHide:true});
const registered = () => sendToRegistryKeys(appId).every(key => reg(['query',key+'\\command','/ve']).status === 0);
const run = async (file,args) => { const process = runner.spawn(file,args); const result = await process.done; assert.equal(result.decimal,0,JSON.stringify(result)); };
const snapshot = async name => {
  for(const theme of ['light','dark']){
    await h.page.evaluate(t=>window.WeftDesktop.setAppearance({theme:t,reducedMotion:true}),theme);
    await h.page.waitForTimeout(280);
    await h.page.screenshot({path:join(out,`${name}-${theme}.png`)});
  }
};
const attachments = () => h.page.locator('#attachment-draft-list').innerText();
async function invoke(paths) {
  // Read the installed verb, then directly invoke precisely its executable/flag/paths.
  const value = reg(['query',sendToRegistryKeys(appId)[0]+'\\command','/ve']); assert.equal(value.status,0);
  const command = /REG_SZ\s+([^\r\n]+)/.exec(value.stdout)?.[1];
  assert.equal(command,`"${executable}" --send-to-weftmate "%1"`);
  await run(executable,['--send-to-weftmate',...paths]);
  assert.equal(await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).length),1);
}
async function reboot(paths) {
  await h.app.close(); h.app=null;
  const env={...process.env};
  for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key))delete env[key];
  env.WEFTMATE_MEMOWEFT_ENABLED='0';env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
  try { h.app=await _electron.launch({executablePath:executable,args:['--send-to-weftmate',...paths],env,timeout:90000}); }
  catch(error) { runner.recordLaunchFailure(error); throw error; }
  runner.track(h.app.process(),{executable,label:'cold-installed-electron'});
  h.page=await h.app.firstWindow();h.page.setDefaultTimeout(15000);await h.page.waitForURL('**/personal/v1/ui*');
  const me=await nativeOwnerSession(h.page);
  assert.equal(me.account.ownerId,h.ownerId,'cold launch retains the original native owner');
  await h.page.locator('#assistant-view').waitFor({state:'visible'});h.origin=new URL(h.page.url()).origin;
}
async function captureNotifications() {
  await h.app.evaluate(({Notification})=>{
    globalThis.sys3Notifications=[];
    globalThis.sys3Shown=new WeakSet();
    const show=Notification.prototype.show;
    Notification.prototype.show=function(){globalThis.sys3Notifications.push(this);this.once('show',()=>globalThis.sys3Shown.add(this));return show.call(this);};
  });
}
async function approvalScenario(kind) {
  const notificationStart=await h.app.evaluate(()=>globalThis.sys3Notifications.length);
  let calls=0;
  const target=join(h.root,'synthetic-delete.txt');writeFileSync(target,'Synthetic file must remain.');
  h.respond=async input=>{
    if(!input.stream||!input.tools?.length)return {role:'assistant',content:'Synthetic provider'};
    const count=calls++;
    if(count>1)return {role:'assistant',content:'合成命令已结束。'};
    let name=count===0?'load_tools':'pwsh';
    let args=count===0?{names:['pwsh']}:{command:kind==='high'?`Remove-Item -LiteralPath '${target.replaceAll("'","''")}'`:'Write-Output "SYS3 synthetic command"',description:'合成命令'};
    if(count===1&&input.tools.some(t=>t.function?.name==='run_code')){name='run_code';args={code:`return await tools.pwsh(${JSON.stringify(args)});`,description:'合成命令'};}
    return {role:'assistant',tool_calls:[{index:0,id:'call-'+randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]};
  };
  const created=await h.api('/commands',{requestId:randomUUID(),kind:'session.create',targetDeviceId:h.hostId,modelProfileId:h.modelId});
  assert.equal(created.status,202,JSON.stringify(created.body));
  const session=await h.receipt(created.body.command);
  assert.equal((await h.api(`/sessions/${session.sessionId}/approval-mode`,{mode:'ask'},'PATCH')).status,200);
  const sent=await h.api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:h.hostId,sessionId:session.sessionId,text:'执行这条合成命令，等待本人决定。'});
  await h.receipt(sent.body.command);
  const approval=await until(async()=> (await h.api(`/sessions/${session.sessionId}/approvals`)).body.approvals?.find(r=>r.status==='pending'));
  const labels=kind==='high'?['查看']:['允许','拒绝'];
  const record=await until(async()=>h.app.evaluate(({Notification},{labels,start})=>{
    const index=globalThis.sys3Notifications.findLastIndex((n,i)=>i>=start&&JSON.stringify(n.actions.map(a=>a.text))===JSON.stringify(labels));
    if(index<0)return null;const n=globalThis.sys3Notifications[index];if(!globalThis.sys3Shown.has(n))return null;return {index,title:n.title,body:n.body,actions:n.actions,nativeShown:true};
  },{labels,start:notificationStart}));
  assert.equal(record.body.includes(target),false);assert.equal(record.body.includes('Remove-Item'),false);
  report.notifications.push({kind,title:record.title,body:record.body,actions:record.actions.map(a=>a.text),riskCategories:approval.riskCategories,nativeShown:record.nativeShown});
  const capture=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','& ([scriptblock]::Create([IO.File]::ReadAllText($env:WEFTMATE_TOAST_SCRIPT))) -Output $env:WEFTMATE_TOAST_OUTPUT -Body $env:WEFTMATE_TOAST_BODY'],{encoding:'utf8',windowsHide:true,timeout:12000,
    env:{...process.env,WEFTMATE_TOAST_SCRIPT:resolve('tests/integration/sys-3-toast-capture.ps1'),WEFTMATE_TOAST_OUTPUT:join(out,`native-notification-${kind}.png`),WEFTMATE_TOAST_BODY:record.body}});
  try { report.notifications.at(-1).nativeCapture=JSON.parse(capture.stdout); }
  catch { report.notifications.at(-1).nativeCapture={captured:false,reason:'Native toast was not visible for capture; the system settings were preserved.'}; }
  await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  await h.app.evaluate((_,{index,kind})=>globalThis.sys3Notifications[index].emit('action',{actionIndex:kind==='deny'?1:0}),{index:record.index,kind});
  if(kind==='high'){
    await until(()=>h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()));
    assert.equal(existsSync(target),true);
    assert.equal((await h.api(`/sessions/${session.sessionId}/approvals`)).body.approvals.find(r=>r.approvalId===approval.approvalId).status,'pending');
    await h.page.locator(`[data-conversation-approval="${approval.approvalId}"]`).waitFor({state:'visible'});
    await snapshot('notification-high-risk-conversation');
    assert.equal((await h.api(`/sessions/${session.sessionId}/approvals/${approval.approvalId}`,{requestId:randomUUID(),outcome:'rejected'})).status,200);
  }else{
    const outcome=kind==='deny'?'rejected':'allowed-once';
    await until(async()=> (await h.api(`/sessions/${session.sessionId}/approvals`)).body.approvals?.find(r=>r.approvalId===approval.approvalId)?.decisionOutcome===outcome);
    assert.equal(await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    await until(()=>h.app.evaluate((_,title)=>globalThis.sys3Notifications.some(n=>n.title===title),kind==='deny'?'已拒绝':'已允许'));
    await h.app.evaluate((_,index)=>globalThis.sys3Notifications[index].emit('click'),record.index);
    await until(()=>h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()));
  }
  report.checks.push(`native-notification-${kind}-with-real-approval-receipt`);
  await until(async()=> (await h.api(`/sessions/${session.sessionId}/events?limit=200`)).body.events?.some(e=>e.type==='turn.ended'));
}
try {
  assert.equal(process.platform,'win32');assert.ok(existsSync(installer));assert.equal(registered(),false,'refuse to replace an existing QA menu');
  await run(installer,['--updated','/S','/currentuser',`/D=${installation}`]);installed=true;
  executable=join(installation,readdirSync(installation).find(n=>/^WeftMate-sys3qa\.exe$/.test(n)));assert.ok(existsSync(executable));
  assert.equal(registered(),true);report.checks.push('per-user-installer-default-file-and-folder-verbs');
  h=await migrationHost({nativeSession:true,executable,tempRoot:temp,processEvidence:({root,profile,executable})=>createProcessEvidence({outputDir:resolve('.local/sys3-electron-processes'),profileDirectory:profile,commandRoots:[root],executables:[executable,process.execPath],startedAt})});
  h.ownerId=(await nativeOwnerSession(h.page)).account.ownerId;
  report.checks.push('native-owner-entry-without-password-login');
  for(const key of sendToRegistryKeys(appId)){
    const value=reg(['query',key+'\\command','/ve']);
    assert.equal(/REG_SZ\s+([^\r\n]+)/.exec(value.stdout)?.[1],`"${executable}" --send-to-weftmate "%1"`);
  }
  report.checks.push('custom-install-location-used-by-both-menu-verbs');
  const appData=await h.app.evaluate(({app})=>app.getPath('appData'));
  configFile=desktopConfigPath(join(appData,'WeftMate sys3qa'));
  priorConfig=existsSync(configFile)?readFileSync(configFile):null;mkdirSync(dirname(configFile),{recursive:true});writeFileSync(configFile,readFileSync(join(h.root,'desktop-config.json')));
  if(!process.argv.includes('--notifications-only')) {
  const one=join(h.root,'第一份 报告.md'),two=join(h.root,'second file.txt'),folder=join(h.root,'合成项目');
  writeFileSync(one,'Synthetic first attachment.');writeFileSync(two,'Synthetic second attachment.');mkdirSync(folder);writeFileSync(join(folder,'brief.md'),'Synthetic folder project.');
  await h.page.locator('#message-text').fill('请帮我整理这些资料');
  await invoke([one]);await until(async()=> (await attachments()).includes('第一份 报告.md'));
  assert.equal(await h.page.locator('#message-text').inputValue(),'请帮我整理这些资料');await snapshot('received-single-file');
  await invoke([two]);await until(async()=> (await attachments()).includes('second file.txt'));await snapshot('received-multiple-files');
  report.checks.push('running-instance-files-preserve-draft-focus-and-one-window');
  await invoke([folder]);await until(async()=> (await h.api('/projects')).body.projects?.some(p=>p.name==='合成项目'));
  await h.page.getByRole('button',{name:'选择文件夹，当前 合成项目',exact:true}).waitFor({state:'visible'});
  assert.equal(await h.page.locator('.folder-confirm').count(),0);await snapshot('received-folder');report.checks.push('running-instance-folder-default-project-new-conversation');
  for(const [name,paths] of [['cold-single',[one]],['cold-multiple',[one,two]],['cold-folder',[folder]]]){
    await reboot(paths);
    if(name==='cold-folder')await h.page.getByRole('button',{name:'选择文件夹，当前 合成项目',exact:true}).waitFor({state:'visible'});
    else for(const path of paths)await until(async()=> (await attachments()).includes(path.split(/[\\/]/).at(-1)));
    assert.equal(await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
    assert.equal(await h.page.locator('#message-text').evaluate(n=>n===document.activeElement),true);report.checks.push(name);
  }
  await h.page.evaluate(()=>WeftSettingsNavigation.open('general'));await h.page.locator('#desktop-send-to').waitFor({state:'visible'});await snapshot('settings-context-menu');
  await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:480,height:780}));
  await snapshot('settings-context-menu-480');
  await h.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1200,height:800}));
  await h.page.locator('#desktop-send-to').uncheck();await until(()=>!registered());await h.page.locator('#desktop-send-to').check();await until(()=>registered());
  await h.page.getByRole('button',{name:'关闭设置',exact:true}).click();report.checks.push('settings-switch-roundtrip-real-registry');
  }
  await captureNotifications();await approvalScenario('allow');await approvalScenario('deny');await approvalScenario('high');
  report.passed=true;
}catch(error){report.passed=false;report.error=redactEvidenceText(error.stack,[temp]);process.exitCode=1;}
finally{
  if(configFile){if(priorConfig)writeFileSync(configFile,priorConfig);else rmSync(configFile,{force:true});}
  try{await h?.close({failed:!report.passed});report.cleanup.electron=h?.processCleanup;
    if(installed){const uninstall=join(installation,readdirSync(installation).find(n=>/^Uninstall WeftMate.*\.exe$/.test(n)));await run(uninstall,['/S','/currentuser']);await until(()=>!registered()&&!existsSync(executable),120000);assert.equal(registered(),false);assert.equal(existsSync(executable),false);report.cleanup.menuRemoved=true;
      assert.notEqual(reg(['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','/v','WeftMate sys3qa']).status,0);report.cleanup.startupRemoved=true;}
  }catch(error){report.cleanup.error=redactEvidenceText(error.stack,[temp]);report.passed=false;process.exitCode=1;}
  report.cleanup.runner=await runner.finalize({failed:!report.passed});
  writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));
  if(!report.cleanup.runner?.stillRunning&&!report.cleanup.electron?.stillRunning)rmSync(temp,{recursive:true,force:true});
  console.log(JSON.stringify(report));
}

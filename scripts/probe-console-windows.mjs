/** Real GUI Electron + real DSH + synthetic HTTP model + one pwsh command.
 * The GUI monitor has no console and does not focus or control the desktop.
 * Ordinary source acceptance:
 *   node scripts/probe-console-windows.mjs --out tests/evidence/ux-2/console-after.json
 * Official release acceptance (metadata-only isolated test identity):
 *   node scripts/probe-console-windows.mjs --release <win-unpacked> --positive-control --command-timeout --out <evidence.json>
 * Add --updated to overlay this worktree's source and pinned runtime; add
 * --expect-zero to fail on any application console, excluding the explicit
 * native positive control. --python / --python-path exercise both real MemoWeft
 * venv transports in source mode without initializing or writing Core data.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../src/host-mode.mjs';
import { prepareConsoleRelease } from './prepare-console-release.mjs';

process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
if (process.platform !== 'win32') throw Error('This probe requires Windows.');
const outputIndex=process.argv.indexOf('--out');
const output=resolve(outputIndex<0?'tests/evidence/ux-2/console-after.json':process.argv[outputIndex+1]);
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:resolve(process.argv[index+1]);};
const releaseSource=argument('--release');
const commandTimeout=process.argv.includes('--command-timeout');
const root=await mkdtemp(join(tmpdir(),'weftmate-ux2-console-')), profile=join(root,'profile');
const repository=resolve(import.meta.dirname,'..'), execute=promisify(execFile);
const startedAt=new Date().toISOString();
const username='synthetic-console-user',password=`synthetic-${randomUUID()}`;
const marker=`UX2_CONSOLE_${randomUUID().replaceAll('-','')}`;
const releaseIdentity=`ux2console${randomUUID().replaceAll('-','').slice(0,8)}`;
let browser,monitor,model,applicationPid,cleanupCount=0;
const report={realElectron:true,realDsh:true,syntheticModel:true,isolatedAccount:true,hostName:'synthetic-host',modelRequests:0,commandCalls:0};
report.commandTimeoutScenario=commandTimeout;
async function until(check,timeout=90000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await check();if(value)return value;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Console probe timed out.');}
async function unlinkRuntimeLinks(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isSymbolicLink()){await unlink(file);}else if(entry.isDirectory()){await unlinkRuntimeLinks(file);}}}
try {
  await mkdir(profile);await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  await writeFile(join(root,'marker.txt'),marker);
  const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(key=>[key,async()=>({})]));
  const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
  const prepared=await preparation.start(),setup=await preparation.issueSetupGrant();
  const registration=await fetch(`${prepared.origin}/personal/v1/auth/setup`,{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:setup.grant,username,password,deviceName:'Synthetic console test'})});
  assert.equal(registration.status,201);await preparation.close();
  model=createServer(async(request,response)=>{
    if(request.url==='/v1/models'){response.setHeader('content-type','application/json');response.end(JSON.stringify({data:[{id:'synthetic-console-model',object:'model'}]}));return;}
    if(request.url==='/props'){response.setHeader('content-type','application/json');response.end(JSON.stringify({default_generation_settings:{n_ctx:98304},total_slots:1}));return;}
    if(request.method!=='POST'){response.writeHead(404,{'content-type':'application/json'});response.end('{}');return;}
    let raw='';for await(const part of request)raw+=part;let body;try{body=JSON.parse(raw);}catch{response.writeHead(400).end('{}');return;}report.modelRequests++;
    // The assistant's tool-call arguments also contain the expected marker;
    // only a returned tool message can prove that the command actually ran.
    const containsPrintedMarker=value=>typeof value==='string'?value.split(/\r?\n/).some(line=>line.trim()==='UX2_COMMAND_OK'):
      Array.isArray(value)?value.some(containsPrintedMarker):value&&typeof value==='object'?Object.values(value).some(containsPrintedMarker):false;
    if((body.messages??[]).filter(message=>message.role==='tool').some(message=>{
      let value=message.content;try{value=JSON.parse(value);}catch{}return containsPrintedMarker(value);
    }))report.commandResultSeen=true;
    if((body.messages??[]).some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('[timed out after')))report.commandTimedOut=true;
    const command=body.tools?.length && JSON.stringify(body.messages).includes('UX2_CONSOLE_CHECK') && report.commandCalls===0;
    const names=(body.tools??[]).map(tool=>tool.function?.name);let name='pwsh',args={description:'Synthetic command check',command:`try{$Host.UI.RawUI.WindowTitle='${marker}-model'}catch{}; Write-Output 'UX2_COMMAND_OK'; Start-Sleep -Milliseconds ${commandTimeout?30000:350}`,...(commandTimeout?{timeoutMs:1500}:{})};
    if(command){
      if(names.includes('run_code')){report.commandCalls++;name='run_code';args={description:'Synthetic command check',code:`return await tools.pwsh(${JSON.stringify(args)});`};}
      else if(names.includes('pwsh'))report.commandCalls++;
      else if(names.includes('load_tools')){name='load_tools';args={names:['pwsh']};report.toolLoadingRequests=(report.toolLoadingRequests??0)+1;}
      else{report.modelFixtureError=`Shell tool unavailable: ${names.join(',')}`;response.writeHead(500).end('{}');return;}
    }
    response.writeHead(200,{'content-type':'text/event-stream'});
    const frame=choice=>response.write(`data: ${JSON.stringify({id:`ux2-${randomUUID()}`,model:body.model,object:'chat.completion.chunk',choices:[choice]})}\n\n`);
    frame({index:0,delta:command?{role:'assistant',tool_calls:[{index:0,id:`call-${randomUUID()}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'UX2_SYNTHETIC_COMPLETED'},finish_reason:null});
    frame({index:0,delta:{},finish_reason:command?'tool_calls':'stop'});response.end('data: [DONE]\n\n');
    if(!command&&report.commandResultSeen)report.finalReplySent=true;
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));
  let executable=createRequire(import.meta.url)('electron'),applicationArgs=[join(repository,'tests/integration/console-probe-bootstrap.mjs'),`--user-data-dir=${profile}`,'--personal-host','--access-port=0','--remote-debugging-port=0'];
  if(releaseSource){
    report.packaged=await prepareConsoleRelease(releaseSource,join(root,'release'),{identity:releaseIdentity,...(process.argv.includes('--updated')?{updatedSource:repository,updatedRuntime:join(repository,'vendor/dsh-runtime')}:{})});executable=report.packaged.executable;
    const desktopConfig=join(root,'desktop-config.json');await writeFile(desktopConfig,JSON.stringify({schemaVersion:1,dataDirectory:profile,accessPort:0,production:{relayEnabled:false},updates:{channel:'preview'}}));
    applicationArgs=[`--desktop-config=${desktopConfig}`,`--user-data-dir=${profile}`,'--personal-host','--access-port=0','--start-in-tray','--remote-debugging-port=0'];
    // Never include temporary absolute paths in published evidence.
    report.packaged.executable='isolated-release/WeftMate.exe';
  }
  await writeFile(join(root,'executable.txt'),executable);
  await writeFile(join(root,'arguments.txt'),applicationArgs.map(value=>`"${value}"`).join(' '));
  const launcher=join(root,'console-monitor.exe');
  await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -Path $env:UX2_MONITOR_SOURCE -OutputAssembly $env:UX2_MONITOR_EXE -OutputType WindowsApplication'],{windowsHide:true,env:{...process.env,UX2_MONITOR_SOURCE:join(repository,'scripts/console-window-monitor.cs'),UX2_MONITOR_EXE:launcher}});
  // This executable is itself a GUI subsystem process and has no console.
  // The application under test receives explicit ordinary GUI startup flags.
  monitor=spawn(launcher,[root],{windowsHide:false,stdio:'ignore'});
  applicationPid=Number(await until(()=>readFile(join(root,'pid.txt'),'utf8')));
  const port=await until(async()=>Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]));
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=await until(async()=>browser.contexts()[0].pages().find(page=>page.url().endsWith('/personal/v1/ui')));page.setDefaultTimeout(90000);
  // The desktop's trusted local session signs into this prepared synthetic
  // account automatically; filling the disappearing login form would race it.
  await page.locator('#assistant-view').waitFor({state:'visible'});
  console.log('Console probe: signed in to isolated account.');
  const api=(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const response=await fetch(`/personal/v1${path}`,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json()};},{path,body,method});
  const configured=await api('/account/models',{requestId:'ux2-console-model',name:'Synthetic console model',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,modelId:'synthetic-console-model',apiKey:'synthetic-key'});assert.equal(configured.status,202);
  const operation=await until(async()=>{const value=await api('/account/models/by-request/ux2-console-model');return!['pending','applying'].includes(value.body.operation?.status)&&value.body;});assert.equal(operation.operation.status,'succeeded');
  console.log('Console probe: synthetic model configured.');
  await page.reload();await page.locator('#new-session').evaluate(button=>button.click());await page.fill('#message-text','UX2_CONSOLE_CHECK');await writeFile(join(root,'phase.txt'),'model-command');await page.locator('#send-message').evaluate(button=>button.click());
  await until(async()=>{
    const approval=page.getByRole('button',{name:/^(允许一次|批准)$/}).first();if(await approval.isVisible())await approval.evaluate(button=>button.click());
    // Tray-mode render clocks can pause the view. The real provider must have
    // received the executed tool result and emitted the final response.
    return report.commandResultSeen&&report.finalReplySent;
  });
  assert.equal(report.commandCalls,1);assert.equal(report.commandResultSeen,true);report.completed=true;
  if(commandTimeout)assert.equal(report.commandTimedOut,true,'The real DSH command timeout must trigger its process-tree termination path.');
  report.commandEvidence={modelReceivedToolOutput:'UX2_COMMAND_OK'};
  if(releaseSource){
    if(process.argv.includes('--positive-control')){await writeFile(join(root,'phase.txt'),'native-positive-control');await writeFile(join(root,'native-positive-request'),'');await new Promise(r=>setTimeout(r,1700));}
  }else{
    await writeFile(join(root,'synthetic-command.cmd'),'@echo off\r\necho synthetic-command-shim\r\npowershell.exe -NoProfile -NonInteractive -Command "Start-Sleep -Milliseconds 350"\r\n');
    await writeFile(join(root,'extra-request.json'),JSON.stringify({python:argument('--python'),pythonPath:argument('--python-path'),positiveControl:process.argv.includes('--positive-control'),nativeSandbox:process.argv.includes('--native-sandbox')}));
    report.additionalPaths=await until(async()=>JSON.parse(await readFile(join(root,'extra-result.json'),'utf8')),30000);
    assert.equal(report.additionalPaths.failure,undefined);
  }
} catch(error) {
  report.failure={message:error.message.replaceAll(root,'%TEMP%/weftmate-ux2-console')};
  throw error;
} finally {
  if(browser){for(const page of browser.contexts()[0]?.pages()??[])await page.close().catch(()=>{});await browser.close().catch(()=>{});}
  // Match creation time, executable and this probe's unique command paths.
  // Parent PIDs alone cannot identify ownership because Windows reuses PIDs.
  if(applicationPid){
    const rootsFile=join(root,'cleanup-roots.json');await writeFile(rootsFile,JSON.stringify([root,join(repository,'tests/integration/console-probe-bootstrap.mjs')]));
    const cleaned=await execute('pwsh.exe',['-NoProfile','-NonInteractive','-File',join(repository,'scripts/nightly/cleanup.ps1'),'-Since',startedAt,'-RootsJson',rootsFile,'-OwnerPid',String(process.pid)],{windowsHide:true});
    cleanupCount=JSON.parse(cleaned.stdout).count;
  }
  await writeFile(join(root,'stop'),'');if(monitor)await new Promise(r=>{if(monitor.exitCode!==null)return r();monitor.once('exit',r);setTimeout(r,5000).unref();});
  if(model)await new Promise(r=>model.close(r));
  for(const [file,key]of [['parent-console.json','parentConsole'],['sampling.json','sampling']]){try{report[key]=JSON.parse(await readFile(join(root,file),'utf8'));}catch{}}
  try{report.windows=(await readFile(join(root,'windows.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{}
  try{report.processes=(await readFile(join(root,'processes.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{}
  try{report.unmatchedWindows=(await readFile(join(root,'unmatched-windows.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{}
  try{report.consoleClients=(await readFile(join(root,'console-clients.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{}
  report.controlWindows=(report.windows??[]).filter(window=>window.phase==='native-positive-control'||window.phase==='positive-control');
  report.applicationWindows=(report.windows??[]).filter(window=>window.phase!=='native-positive-control'&&window.phase!=='positive-control');
  report.cleanedProcesses=cleanupCount;await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  await unlinkRuntimeLinks(root);
  await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:200});
  if(releaseSource&&process.env.APPDATA){const controlData=join(process.env.APPDATA,`WeftMate ${releaseIdentity}`);await rm(controlData,{recursive:true,force:true,maxRetries:20,retryDelay:200});}
}
assert.equal(report.parentConsole?.consoleWindow,false);console.log(JSON.stringify({completed:report.completed,modelRequests:report.modelRequests,commandCalls:report.commandCalls,additionalPaths:report.additionalPaths,parentConsole:report.parentConsole,sampling:report.sampling,applicationWindows:report.applicationWindows,controlWindows:report.controlWindows,cleanedProcesses:report.cleanedProcesses}));
if(process.argv.includes('--positive-control'))assert.ok(report.windows.some(window=>window.phase==='native-positive-control'),'The positive control was not detected; console visibility probe is not validated.');
if(process.argv.includes('--expect-zero'))assert.equal(report.applicationWindows.length,0,'An application subprocess displayed a visible console window.');

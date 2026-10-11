import { managedMkdtempSync as mkdtempSync, managedTempRoot as tmpdir } from '../helpers/managed-temp.mjs';
/** Synthetic desktop diagnosis acceptance. One Electron at a time; no model calls. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, parse, basename } from 'node:path';

import { once } from 'node:events';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { createProcessEvidence, cleanupOwnedProcesses } from '../helpers/process-evidence.mjs';

const repository=resolve(import.meta.dirname,'../..'), output=join(repository,'tests/evidence/diag-1');
mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(process.platform==='win32' ? parse(tmpdir()).root : tmpdir(),'weftmate-diag1-'));
const electron=createRequire(import.meta.url)('electron'), startedAt=Date.now();
const evidence=createProcessEvidence({outputDir:join(repository,'.local/diag-1-processes'),commandRoots:[root],executables:[electron,process.execPath],startedAt});
const profileEvidence=new Map();
function evidenceFor(profile) {
  if(!profileEvidence.has(profile))profileEvidence.set(profile,createProcessEvidence({outputDir:join(repository,'.local/diag-1-processes',basename(profile)),profileDirectory:profile,commandRoots:[root],executables:[electron,process.execPath],startedAt}));
  return profileEvidence.get(profile);
}
const credentials={username:'DiagSynthetic',password:'synthetic diagnosis password',deviceName:'synthetic-host'};
let application, cleanupCount=0;
const baselineFile=join(repository,'src/.diag1-baseline-main.mjs'), baselineLog=join(repository,'src/.diag1-baseline-host-log.mjs');
const timings={baseline:[],diagnostics:[]};
const exitTimes=new WeakMap();
async function randomTestPort() {
  // This machine's ephemeral range has repeatedly returned ENOBUFS. Use a
  // randomly selected free test port below that range; never use daily ports.
  for (;;) {
    const port=randomInt(12000,49000);if(port===18186)continue;
    const server=createServer();
    const free=await new Promise(resolve=>{server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});
    if(free)return port;
  }
}
async function seed(name) {
  const profile=join(root,name);mkdirSync(profile,{recursive:true});
  writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(key=>[key,async()=>({})]));
  const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
  try {
    const {origin}=await prep.start(), {grant}=await prep.issueSetupGrant();
    const response=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant,...credentials})});
    assert.equal(response.status,201);const me=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(origin+'/personal/v1/onboarding',{method:'PATCH',headers:{origin,'content-type':'application/json',cookie,'x-weftmate-csrf':me.csrfToken},body:JSON.stringify({step:'first',completed:true})})).status,200);
  } finally {await prep.close();}
  return profile;
}
async function launch(profile,{baseline=false}={}) {
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(key))delete env[key];
  env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
  const accessPort=await randomTestPort(), debugPort=await randomTestPort(), inspectPort=await randomTestPort();
  try {application=await _electron.launch({args:[baseline?baselineFile:'.',`--user-data-dir=${profile}`,'--personal-host',`--access-port=${accessPort}`,`--remote-debugging-port=${debugPort}`,`--inspect=${inspectPort}`],cwd:repository,env,timeout:90000});}
  catch(error){evidenceFor(profile).recordLaunchFailure(error);throw error;}
  application.process().once('exit',()=>exitTimes.set(application.process(),performance.now()));
  evidenceFor(profile).track(application.process(),{executable:electron,label:baseline?'baseline':'diagnostics'});
  const page=await application.firstWindow({timeout:60000});page.setDefaultTimeout(20000);
  await page.waitForURL('**/personal/v1/ui*');await localUiSession(page,credentials,'synthetic-host',{mainChat:true});
  await page.locator('#assistant-view').waitFor({state:'visible'});
  await page.waitForFunction(()=>globalThis.__WeftUiStarted===true);
  return page;
}
async function stop(kind) {
  const child=application.process(), closed=once(child,'close');
  await application.evaluate(({app})=>{globalThis.diagQuitAt=performance.now();app.on('before-quit',()=>{if(!globalThis.diagFirstQuit)globalThis.diagFirstQuit=performance.now();});setTimeout(()=>app.quit(),0);});
  const at=performance.now();await closed;timings[kind].push(Math.round(exitTimes.get(child)-at));
  assert.equal(child.exitCode,0);application=undefined;
}
const rows=profile=>readdirSync(join(profile,'logs')).filter(name=>/^host-.*\.jsonl$/.test(name)).sort().flatMap(name=>readFileSync(join(profile,'logs',name),'utf8').trim().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}));
async function system(page) {return page.evaluate(async()=>{const r=await fetch('/personal/v1/system');if(!r.ok)throw Error('System unavailable');return r.json();});}
async function settings(page) {
  await page.getByRole('button',{name:'账户菜单',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'系统状态',exact:true}).click();
  await page.locator('.run-records[data-state=ready]').waitFor();
}
async function screenshots(page,state) {
  for(const theme of ['light','dark'])for(const width of [1200,480]) {
    await application.evaluate(({BrowserWindow},{width})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WeftMate');w.setSize(width,844);},{width});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('weftmate.theme',theme);},theme);
    if (state !== 'unclean-notice') await page.locator(state === 'summary-preview' ? '.run-record-preview' : '.run-records').evaluate(node=>node.scrollIntoView({block:'end'}));
    await page.locator('#settings-search').count().then(async count=>{if(count)await page.evaluate(()=>document.activeElement?.blur());});
    await page.screenshot({path:join(output,`electron-${width}-${theme}-${state}.png`)});
  }
}
try {
  // Use the exact pre-change main/log, sharing installed dependencies, without rebuilding an environment.
  let oldMain=execFileSync('git',['show','origin/main:src/main.mjs'],{cwd:repository,encoding:'utf8'});
  oldMain=oldMain.replace("'./host-log.mjs'","'./.diag1-baseline-host-log.mjs'").replaceAll('app.getAppPath()',"resolve(import.meta.dirname, '..')");
  writeFileSync(baselineFile,oldMain);writeFileSync(baselineLog,execFileSync('git',['show','origin/main:src/host-log.mjs'],{cwd:repository}));
  const baseline=await seed('baseline');for(let i=0;i<1;i++){console.log('baseline',i+1);await launch(baseline,{baseline:true});await stop('baseline');}
  rmSync(baselineFile);rmSync(baselineLog);
  console.log('diagnostic normal/empty');const profile=await seed('diagnostics');let page=await launch(profile);
  assert.equal((await system(page)).runRecord.previous,null);
  await settings(page);await screenshots(page,'empty');await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await stop('diagnostics');assert.equal(rows(profile).at(-1).event,'host.exit');
  page=await launch(profile);assert.equal((await system(page)).runRecord.previous.normal,true);
  assert.equal(await page.getByRole('button',{name:'查看详情',exact:true}).isVisible(),false);
  const firstRun=(await system(page)).runRecord.runId;
  console.log('forced termination');const child=application.process(),closed=once(child,'close'),exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const cleaned=cleanupOwnedProcesses({startedAt,executables:[electron],commandRoots:[root]});cleanupCount+=cleaned.cleaned;assert.equal(cleaned.failed,0);await closed;application=undefined;
  page=await launch(profile);let record=(await system(page)).runRecord;
  assert.equal(record.previous.runId,firstRun);assert.equal(record.previous.normal,false);assert.equal(record.uncleanCount7Days,1);
  assert.ok(rows(profile).some(row=>row.event==='host.previous_unclean_exit'&&row.previousRunId===firstRun));
  await page.getByRole('button',{name:'查看详情',exact:true}).waitFor();
  await screenshots(page,'unclean-notice');
  await page.getByRole('button',{name:'查看详情',exact:true}).click();
  await page.locator('.run-records[data-state=ready]').waitFor();await screenshots(page,'record');
  let opened=0;await application.evaluate(({shell})=>{shell.openPath=async()=>{globalThis.diagOpened=(globalThis.diagOpened||0)+1;return '';};});
  await page.getByRole('button',{name:'打开日志文件夹',exact:true}).click();opened=await application.evaluate(()=>globalThis.diagOpened);assert.equal(opened,1);
  await page.getByRole('button',{name:'复制诊断摘要',exact:true}).click();assert.equal(await page.locator('.run-record-preview').isVisible(),true);
  await screenshots(page,'summary-preview');
  await page.route('**/personal/v1/system',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}})}));
  await page.getByRole('button',{name:'刷新系统状态',exact:true}).click();await page.locator('.run-records[data-state=error]').waitFor();await screenshots(page,'error');
  await page.unroute('**/personal/v1/system');await page.getByRole('button',{name:'重试读取',exact:true}).click();await page.locator('.run-records[data-state=ready]').waitFor();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  // Synthetic uncaught exception with secret/path/free prose; no contents reach evidence.
  await application.evaluate(()=>{setTimeout(()=>{throw new TypeError("Cannot read properties of undefined (reading 'synthetic-secret-content')");},0);});
  await page.waitForTimeout(100);await stop('diagnostics');
  const logRows=rows(profile);assert.ok(logRows.some(row=>row.event==='host.failure'&&row.source==='uncaughtException'&&row.name==='TypeError'));
  assert.ok(!JSON.stringify(logRows).includes('synthetic-secret-content'));
  writeFileSync(join(output,'example-log.jsonl'),logRows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  writeFileSync(join(output,'exit-timing.json'),JSON.stringify({unit:'ms',measurement:'quit request until main process close; same synthetic account, one process at a time',...timings,shutdownSteps:logRows.filter(row=>row.event==='host.shutdown_step'),warning:'Single samples show observation overhead only; not a soak benchmark.'},null,2));
  console.log('native crash');const native=await seed('native-crash');await launch(native);await stop('diagnostics');page=await launch(native);
  const crashChild=application.process(),crashClosed=once(crashChild,'close'),crashExited=once(crashChild,'exit');await application.evaluate(()=>{setTimeout(()=>process.crash(),0);}).catch(()=>{});await crashExited;
  cleanupCount+=cleanupOwnedProcesses({startedAt,executables:[electron],commandRoots:[root]}).cleaned;await crashClosed;application=undefined;
  page=await launch(native);record=(await system(page)).runRecord;
  assert.equal(record.previous.normal,false);assert.ok(record.previous.dumps.length>0,'native crash should leave a local dump');
  assert.ok((await application.evaluate(({crashReporter})=>crashReporter.getUploadToServer()))===false);
  await stop('diagnostics');
  writeFileSync(join(output,'acceptance.json'),JSON.stringify({normalRestart:true,forcedRestart:true,uncaughtException:true,nativeDump:true,localOnly:true,folderOpenStub:true,modelRequests:0,cleanupCount},null,2));
  console.log('DIAG-1 Electron acceptance passed');
} finally {
  writeFileSync(join(output,'exit-timing-samples.json'),JSON.stringify({unit:'ms',...timings},null,2));
  await application?.close().catch(()=>{});rmSync(baselineFile,{force:true});rmSync(baselineLog,{force:true});
  let safe=true;for(const ev of profileEvidence.values()){const result=await ev.finalize();cleanupCount+=result.cleaned;safe&&=!result.stillRunning&&!result.preservationError;}
  const cleanup=await evidence.finalize();cleanupCount+=cleanup.cleaned;
  if(safe&&!cleanup.stillRunning&&!cleanup.preservationError)rmSync(root,{recursive:true,force:true});
  console.log(`已清理进程：${cleanupCount}`);
}

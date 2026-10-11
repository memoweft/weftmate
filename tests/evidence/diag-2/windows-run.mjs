/** Real isolated Electron summary/preview acceptance; clipboard destination is synthetic. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { openSync, closeSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, parse, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../src/host-mode.mjs';
import { localUiSession } from '../../helpers/local-ui-session.mjs';
import { createProcessEvidence } from '../../helpers/process-evidence.mjs';
const repository=resolve(import.meta.dirname,'../../..'),out=import.meta.dirname;
let lock,app,root,evidence,cleaned=0;
const credentials={username:'Diag2Synthetic',password:'synthetic diagnostics acceptance',deviceName:'synthetic-host'};
async function port(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
try {
  while(!lock){
    for(let slot=1;slot<=3;slot++){try{lock=`D:/AIProjects/WeftMate/Runtime/Orchestrator/heavy-${slot}.lock`;const fd=openSync(lock,'wx');writeFileSync(fd,`DIAG-2 ${new Date().toISOString()} Electron summary acceptance\n`);closeSync(fd);break;}catch(error){lock=null;if(error.code!=='EEXIST')throw error;}}
    if(!lock){console.log('DIAG-2 waiting for an Electron heavy slot');await new Promise(resolve=>setTimeout(resolve,120000));}
  }
  root=mkdtempSync(join(process.platform==='win32'?parse(tmpdir()).root:tmpdir(),'weftmate-diag2-desktop-'));
  writeFileSync(join(root,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(key=>[key,async()=>({})]));
  const service=await createPersonalAccessService({root:join(root,'personal-access'),port:0,backend});
  try{const {origin}=await service.start(),{grant}=await service.issueSetupGrant();const response=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant,...credentials})});assert.equal(response.status,201);const result=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(origin+'/personal/v1/onboarding',{method:'PATCH',headers:{origin,'content-type':'application/json',cookie,'x-weftmate-csrf':result.csrfToken},body:JSON.stringify({step:'first',completed:true})})).status,200);}finally{await service.close();}
  const electron=createRequire(import.meta.url)('electron');evidence=createProcessEvidence({outputDir:join(repository,'.local/diag-2-processes'),profileDirectory:root,commandRoots:[root],executables:[electron,process.execPath],startedAt:Date.now()});
  const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE)/.test(key))delete env[key];env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
  try{app=await _electron.launch({args:['.',`--user-data-dir=${root}`,'--personal-host',`--access-port=${await port()}`,`--remote-debugging-port=${await port()}`,`--inspect=${await port()}`],cwd:repository,env,timeout:90000});}catch(error){evidence.recordLaunchFailure(error);throw error;}
  evidence.track(app.process(),{executable:electron,label:'diag-2-summary'});
  const page=await app.firstWindow({timeout:60000});page.setDefaultTimeout(25000);await page.waitForURL('**/personal/v1/ui*');await localUiSession(page,credentials,'synthetic-host',{mainChat:true});await page.waitForFunction(()=>globalThis.__WeftUiStarted===true);
  await app.evaluate(()=>{setTimeout(()=>{throw new TypeError('fetch failed');},0);});
  await page.waitForFunction(async()=>{const result=await (await fetch('/personal/v1/system')).json();return JSON.parse(result.runRecord.summary).recentAbnormalRecords.some(row=>row.event==='host.failure');});
  const status=await page.evaluate(async()=> (await (await fetch('/personal/v1/system')).json()).runRecord);
  const summary=JSON.parse(status.summary);assert.equal(summary.platform,'windows');assert.ok(summary.recentAbnormalRecords.length>0);assert.equal(typeof summary.recentAbnormalRecords[0].fields.recordIndex,'string');
  await writeFileSync(join(out,'windows-summary.json'),status.summary+'\n');
  await page.evaluate(()=>{const mount=WeftRunRecords.mount;WeftRunRecords.mount=(...args)=>{
    const view=mount(...args),paint=view.paint;
    view.paint=value=>{if(value?.state==='ready')globalThis.diagDisplayed=structuredClone(value);return paint(value);};return view;
  };});
  await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'系统状态',exact:true}).click();await page.locator('.run-records[data-state=ready]').waitFor();
  const displayed=await page.evaluate(()=>globalThis.diagDisplayed);assert.ok(displayed);
  await page.getByRole('button',{name:'复制诊断摘要',exact:true}).click();await page.locator('.run-record-preview').waitFor();
  assert.equal(await page.locator('.run-record-summary').innerText(),displayed.summaryPreview);
  assert.match(displayed.summaryPreview,/本次启动/);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{globalThis.diagCopied=text;}}});});
  await page.getByRole('button',{name:'复制摘要',exact:true}).click();assert.deepEqual(JSON.parse(await page.evaluate(()=>globalThis.diagCopied)),JSON.parse(displayed.summary));
  for(const theme of ['light','dark'])for(const width of [1200,480]){
    await app.evaluate(({BrowserWindow},width)=>{BrowserWindow.getAllWindows().find(window=>window.getTitle()==='WeftMate').setSize(width,844);},width);
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('weftmate.theme',theme);},theme);
    await page.locator('.run-record-preview').evaluate(node=>node.scrollIntoView({block:'end'}));await page.screenshot({path:join(out,`windows-${width}-${theme}-summary-preview.png`)});
  }
  const child=app.process(),closed=once(child,'close');await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await closed;app=null;assert.equal(child.exitCode,0);
  writeFileSync(join(out,'windows-report.json'),JSON.stringify({realElectron:true,realModelRequests:0,summaryCopiedAsJson:true,humanPreview:true,clipboardDestination:'synthetic',normalExit:true},null,2)+'\n');
} finally {
  if(app)await app.close().catch(()=>{});
  if(evidence){const result=await evidence.finalize();cleaned+=result.cleaned;assert.equal(result.stillRunning,false);assert.equal(result.failed,0);}
  if(root){assert.ok(basename(root).startsWith('weftmate-diag2-desktop-'));rmSync(root,{recursive:true,force:true});}
  if(lock)rmSync(lock,{force:true});
}
console.log(`已清理进程：${cleaned}`);

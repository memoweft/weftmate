import { evidencePath } from '../helpers/evidence-path.mjs';
/** Real Electron + mobile browser, synthetic random-port component providers only. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { managedMkdtempSync, managedTempRoot } from '../helpers/managed-temp.mjs';
import { createProcessEvidence } from '../helpers/process-evidence.mjs';

const repository=resolve(import.meta.dirname,'../..'),output=evidencePath('r0-2');mkdirSync(output,{recursive:true});
const mobileOnly=process.argv.includes('--mobile-only');
const root=managedMkdtempSync(join(managedTempRoot(),'weftmate-r0-2-'));
const executable=createRequire(import.meta.url)('electron'),startedAt=Date.now();
const processEvidence=createProcessEvidence({outputDir:join(repository,'.local/r0-2-processes'),profileDirectory:root,commandRoots:[root],executables:[executable,chromium.executablePath()],startedAt});
const report={passed:false,synthetic:true,componentAdapters:'actual random-port HTTP probes; signed synthetic X.509 certificate',realModelRequests:0,checks:[],mobileEvidence:'browser viewport only; native system bars pending',screenshots:[]};
if(mobileOnly)report.screenshots=JSON.parse(readFileSync(join(output,'acceptance.json'))).screenshots.filter(name=>name.startsWith('electron-'));
let application,browser,page,heavyLock,cleanupCount=0;
const slots=process.env.R02_HEAVY_DIR||'D:/AIProjects/WeftMate/Runtime/Orchestrator';
for(let slot=1;slot<=3;slot++){const file=join(slots,`heavy-${slot}.lock`);try{const fd=openSync(file,'wx');writeFileSync(fd,`R0-2 ${new Date().toISOString()} Electron acceptance\n`);closeSync(fd);heavyLock=file;break;}catch(error){if(error.code!=='EEXIST')throw error;}}
if(!heavyLock){rmSync(root,{recursive:true,force:true});throw Error('All heavy slots occupied; retry this runner after a slot is released');}
console.log('R0-2 acceptance owns '+heavyLock.split(/[\\/]/).at(-1));

async function screenshot(page,name,{desktop=true,widths=desktop?[1200,480]:[360,390],anchor}={}) {
  if(desktop&&mobileOnly)return;
  for(const theme of ['light','dark'])for(const width of widths){
    if(desktop)await application.evaluate(({BrowserWindow,nativeTheme},{width,theme})=>{nativeTheme.themeSource=theme;BrowserWindow.getAllWindows()[0].setContentSize(width,844);},{width,theme});
    else await page.setViewportSize({width,height:width===360?780:844});
    await page.evaluate(({theme,desktop})=>{if(desktop){document.documentElement.dataset.theme=theme;localStorage.setItem('weftmate.theme',theme);}else applyTheme(theme);document.activeElement?.blur();},{theme,desktop});
    if(anchor)await page.locator(anchor).scrollIntoViewIfNeeded();
    const filename=`${desktop?'electron':'mobile-browser'}-${width}-${theme}-${name}.png`;
    await page.screenshot({path:join(output,filename)});report.screenshots.push(filename);
  }
  if(desktop)await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,844));
}
async function refresh(page){await page.getByRole('button',{name:'刷新系统状态',exact:true}).click();await page.locator('.system-service').first().waitFor();}
const row=(page,id)=>page.locator(`.system-service[data-component="${id}"]`);
function unzip(buffer){const entries={};let offset=0;while(buffer.readUInt32LE(offset)===0x04034b50){const method=buffer.readUInt16LE(offset+8),size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extraLength=buffer.readUInt16LE(offset+28),name=buffer.subarray(offset+30,offset+30+nameLength).toString();const start=offset+30+nameLength+extraLength,data=buffer.subarray(start,start+size);entries[name]=(method===8?inflateRawSync(data):data).toString();offset=start+size;}return entries;}

try{
  const env={...process.env,R02_PROFILE:root,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};delete env.ELECTRON_RUN_AS_NODE;
  try{application=await _electron.launch({executablePath:executable,args:[join(repository,'tests/helpers/r0-2-bootstrap.mjs'),`--user-data-dir=${root}`],cwd:repository,env,timeout:90000});}
  catch(error){processEvidence.recordLaunchFailure(error);throw error;}
  processEvidence.track(application.process(),{executable,label:'R0-2 Electron'});
  page=await application.firstWindow();page.setDefaultTimeout(15000);
  await page.waitForURL('**/personal/v1/ui*');
  const fixture=await application.evaluate(async()=>{const deadline=Date.now()+20000;while(!globalThis.r02){if(Date.now()>deadline)throw Error('Synthetic component fixture did not finish startup');await new Promise(done=>setTimeout(done,10));}return {credentials:r02.fixture.credentials,mobileUrl:r02.fixture.mobileUrl};});
  await page.waitForFunction(async()=>{const response=await fetch('/personal/v1/auth/me');return response.ok&&(await response.json()).device?.authKind==='desktop';});
  const identity=await page.evaluate(async()=>{const response=await fetch('/personal/v1/auth/me');if(!response.ok)throw Error('Synthetic desktop session unavailable');return response.json();});
  assert.equal(identity.device.authKind,'desktop');assert.equal(identity.account.username,fixture.credentials.username);
  await page.locator('#assistant-view').waitFor({state:'visible'});
  await page.getByRole('button',{name:'查看详情',exact:true}).waitFor();
  await screenshot(page,'unclean-notice');
  await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'系统状态',exact:true}).click();
  await page.locator('.system-service[data-state="healthy"]').first().waitFor();assert.equal(await page.locator('.system-service').count(),5);
  assert.match(await page.locator('.system-semantic').innerText(),/就绪/);
  assert.equal(await page.locator('[data-metric]').count(),3);
  await screenshot(page,'healthy',{anchor:'#system-services'});await screenshot(page,'metrics-records',{anchor:'#system-metrics'});
  report.checks.push({name:'five healthy rows, semantic recall, three metrics',passed:true});
  assert.match(await page.locator('.run-records').innerText(),/未正常结束|没有正常退出/);
  report.checks.push({name:'previous unclean exit notice, detail entry and records visible',passed:true});

  for(const id of ['host','memory','model','relay','certificate']){
    const before=await application.evaluate(()=>({...r02.repairs}));
    const recoveryBefore=await application.evaluate(()=>r02.diagnostics.records().filter(record=>record.event==='component.recovery').length);
    await application.evaluate(async (_,id)=>r02.fault(id),id);await refresh(page);
    assert.equal(await row(page,id).getAttribute('data-state'),'problem');
    await screenshot(page,`${id}-fault`,{anchor:`[data-component="${id}"]`});
    await row(page,id).getByRole('button',{name:/^修复/}).click();
    await row(page,id).getByText('修复中…',{exact:true}).waitFor();
    await application.evaluate(async (_,before)=>{while(r02.diagnostics.records().filter(record=>record.event==='component.recovery').length<=before)await new Promise(done=>setTimeout(done,10));},recoveryBefore);
    await page.waitForFunction(id=>{const row=document.querySelector(`[data-component="${id}"]`);return row&&row.getAttribute('aria-busy')!=='true';},id);
    const after=await application.evaluate(()=>({...r02.repairs}));
    for(const component of Object.keys(before))assert.equal(after[component]-before[component],component===id?1:0,'repair affected only requested component');
    if(id==='model'){
      assert.equal(await row(page,id).getAttribute('data-state'),'problem');
      assert.match(await row(page,id).locator('.system-next-step').innerText(),/模型设置|地址/);
      await row(page,id).locator('.system-next-step').click();
      await page.locator('section.settings-category[data-category="models"]').waitFor({state:'visible'});
      await page.getByRole('button',{name:'系统状态',exact:true}).click();
      await row(page,id).waitFor();await screenshot(page,'model-next-step',{anchor:'[data-component="model"]'});
      await application.evaluate(async()=>r02.restore('model'));await refresh(page);
    }else{
      await page.waitForFunction(id=>document.querySelector(`[data-component="${id}"]`)?.dataset.state==='healthy',id);
      await screenshot(page,`${id}-repaired`,{anchor:`[data-component="${id}"]`});
    }
    report.checks.push({name:`${id} provider fault → scoped manual repair`,passed:true,restored:id!=='model',nextStep:id==='model'});
  }
  await application.evaluate(async()=>r02.autoMemory());await refresh(page);assert.equal(await row(page,'memory').getAttribute('data-state'),'healthy');
  report.checks.push({name:'synthetic memory owner automatic reconnect before snapshot',passed:true});
  for(const state of ['disabled','preparing','ready','unavailable']){await application.evaluate((_,state)=>r02.semantic({state}),state);await refresh(page);assert.match(await page.locator('.system-semantic').innerText(),new RegExp({disabled:'未启用',preparing:'准备中',ready:'就绪',unavailable:'不可用'}[state]));}
  await application.evaluate(()=>r02.semantic(undefined));await refresh(page);assert.equal(await page.locator('.system-semantic').count(),0);
  await application.evaluate(()=>r02.semantic({state:'ready'}));await refresh(page);
  report.checks.push({name:'semantic recall four states and omitted legacy field',passed:true});

  await page.getByRole('button',{name:'导出诊断包…',exact:true}).click();await screenshot(page,'export-preview',{anchor:'#system-export-preview'});
  assert.match(await page.locator('#system-export-preview').innerText(),/不包含：对话正文、记忆内容、密钥/);
  await page.getByRole('button',{name:'选择保存位置',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('system-export-preview').hidden);
  const entries=unzip(readFileSync(join(root,'diagnostics.zip')));assert.equal(Object.keys(entries).length,6);assert.deepEqual(JSON.parse(entries['manifest.json']).files,Object.keys(entries));
  const sensitiveMarkers=await application.evaluate(()=>r02.sensitiveMarkers);
  report.sensitiveMarkerHits=sensitiveMarkers.filter(marker=>Object.values(entries).some(content=>content.includes(marker))).length;assert.equal(report.sensitiveMarkerHits,0);
  report.checks.push({name:'native export with synthetic save dialog yields six allowed files',passed:true});
  report.checks.push({name:'synthetic dialogue, memory, key and token markers absent from every exported file',passed:true});

  browser=await chromium.launchPersistentContext(join(root,'mobile-browser'),{headless:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mobile=await browser.newPage();
  mobile.on('pageerror',error=>console.log('Synthetic mobile page error:',error.message));
  await mobile.goto(fixture.mobileUrl);
  try{await mobile.waitForFunction(()=>state.booted&&state.loggedIn);}catch(error){
    report.mobileDebug=await mobile.evaluate(()=>({booted:typeof state!=='undefined'&&state.booted,loggedIn:typeof state!=='undefined'&&state.loggedIn,page:typeof state!=='undefined'&&state.page,error:document.querySelector('#chat-status')?.textContent}));
    report.bridgeCalls=await application.evaluate(()=>r02.fixture.bridgeCalls);console.log('Synthetic mobile boot debug',JSON.stringify({state:report.mobileDebug,calls:report.bridgeCalls}));throw error;
  }
  await mobile.evaluate(()=>page('general'));await mobile.getByRole('button',{name:/^系统状态/}).click();await mobile.locator('.mobile-system-component').first().waitFor();
  assert.equal(await mobile.locator('.mobile-system-component').count(),5);
  assert.equal(await mobile.getByRole('button',{name:/^修复/}).count(),0);assert.equal(await mobile.getByRole('button',{name:/导出诊断包/}).count(),0);
  assert.equal(await mobile.getByText(/附件草稿未能恢复/).count(),0,'Synthetic attachment listing must not obscure the status page');
  await screenshot(mobile,'status',{desktop:false,anchor:'.mobile-system-component:first-child'});
  await screenshot(mobile,'metrics',{desktop:false,anchor:'[data-metric="memory"]'});
  report.checks.push({name:'mobile browser read-only five components and metrics',passed:true});
  report.realModelRequests=await application.evaluate(()=>r02.modelRequests);assert.equal(report.realModelRequests,0);
  report.passed=true;
  console.log('R0-2 Electron acceptance passed');
}finally{
  await browser?.close().catch(()=>{});if(page&&!page.isClosed())await page.goto('about:blank',{timeout:15000}).catch(()=>{});await application?.evaluate(async()=>r02.close()).catch(()=>{});await application?.close().catch(()=>{});
  const cleanup=await processEvidence.finalize({failed:!report.passed});cleanupCount+=cleanup.cleaned;report.cleanupCount=cleanupCount;report.cleanupSafe=!cleanup.stillRunning&&!cleanup.preservationError;
  writeFileSync(join(output,'acceptance.json'),JSON.stringify(report,null,2)+'\n');
  if(report.cleanupSafe)rmSync(root,{recursive:true,force:true});
  if(heavyLock)rmSync(heavyLock,{force:true});console.log(`已清理进程：${cleanupCount}`);
}

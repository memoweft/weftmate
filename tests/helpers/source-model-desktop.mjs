/** Isolated source desktop + pinned DSH + real MiMo for local scenario checks. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, unlink, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { phoneRuntime } from '../../services/cloud/test/relay-phone-runtime.mjs';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { modelReasoning } from '../../src/model-reasoning.mjs';
import { cleanupOwnedProcesses, redactEvidenceText } from './process-evidence.mjs';
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });

export async function sourceModelDesktop(id) {
  process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
  const out = process.env.WEFTMATE_EVIDENCE_DIR, locks = process.env.WEFTMATE_HEAVY_LOCK_DIR;
  if (!out || !locks || !process.env.MIMO_API_KEY) throw Error('Set evidence directory, heavy lock directory and MiMo process credential.');
  const repository = resolve(import.meta.dirname, '../..'), startedAt = Date.now();
  const root = await mkdtemp(join(tmpdir(), `weftmate-${id}-`)); await mkdir(out, { recursive: true });
  const report = { scenario:id, realElectron:true, realDsh:true, model:'mimo-v2.6-flash', screenshots:[], passed:false };
  let app, runtime, host, lock, lease, timer;
  const logs = [], abort = new AbortController();
  async function removeLinks(directory) {
    for (const row of await readdir(directory, { withFileTypes:true })) {
      const path = join(directory, row.name);
      if ((await lstat(path)).isSymbolicLink()) await unlink(path); else if (row.isDirectory()) await removeLinks(path);
    }
  }
  async function close(error) {
    clearTimeout(timer); abort.abort();
    if (error) report.failure = redactEvidenceText(error.message, [root]);
    await Promise.allSettled([app?.close(), runtime?.close()]); await host?.close();
    report.cleanup = cleanupOwnedProcesses({ startedAt, executables:[process.execPath,createRequire(import.meta.url)('electron')], commandRoots:[root] });
    report.logs = logs.filter(line => /error|fail/i.test(line)).slice(-8).map(line => redactEvidenceText(line,[root]));
    try { await writeFile(join(out, 'report.json'), JSON.stringify(report, (_key,value) => typeof value === 'string' ? value.replaceAll(root,'%FIXTURE%') : value, 2)); }
    finally {
      if (lock && await readFile(lock,'utf8').catch(()=>null) === lease) await unlink(lock);
      const rel = relative(tmpdir(), root); assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
      await removeLinks(root); await rm(root,{recursive:true,force:true});
    }
  }
  try {
    for (const n of [1,2,3]) { const candidate = join(locks,`heavy-${n}.lock`);
      try { const file=await open(candidate,'wx');lease=`${id} ${new Date().toISOString()} source Electron`;await file.writeFile(lease);await file.close();lock=candidate;break; }
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
    if(!lock)throw Error('All heavy slots occupied');
    runtime=await phoneRuntime(root,logs,{baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:process.env.MIMO_API_KEY});
    const patch=join(root,'dsh-home','model.yml'),declaration=modelReasoning({baseUrl:'https://api.xiaomimimo.com/v1',model:'mimo-v2.6-flash'});
    await writeFile(patch,(await readFile(patch,'utf8')).replace('id: mimo-v2.6-flash\n',`id: mimo-v2.6-flash\n            reasoningEfforts: ${JSON.stringify(declaration.reasoningEfforts)}\n            compat: ${JSON.stringify(declaration.compat)}\n`));
    host=await createPersonalAccessService({root:join(root,'account'),port:0,backend:runtime.backend,uiHandler:servePersonalAccessUi});
    runtime.setHost(host);await runtime.start(); const started=await host.start(),grant=await host.issueSetupGrant();
    const setup=await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'SyntheticScenario',password:'Synthetic scenario password',deviceName:'synthetic-desktop'})});
    assert.equal(setup.status,201);const auth=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];
    const api=async(path,body,method=body===undefined?'GET':'POST')=>{
      const response=await fetch(started.origin+'/personal/v1'+path,{method,headers:{origin:started.origin,cookie,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});
      const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,error:value.error}));return value;
    };
    await api('/settings/models',{defaultModelProfileId:'synthetic'},'PATCH');await api('/onboarding',{step:'first',completed:true},'PATCH');
    const env={...process.env,REVIEW_PROFILE:join(root,'desktop-profile'),REVIEW_ORIGIN:started.origin,REVIEW_LIBRARY_TOKEN:host.libraryDesktopToken,REVIEW_THEME:'light',REVIEW_HIDDEN:'1'};
    delete env.ELECTRON_RUN_AS_NODE;delete env.MIMO_API_KEY;
    app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:['scripts/review-gallery/electron.mjs','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'],env,timeout:30000});
    const page=await app.firstWindow();page.setDefaultTimeout(60000);
    await page.addInitScript(()=>{
      Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});Object.defineProperty(document,'hidden',{get:()=>false});
      let module;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>module,set:value=>{module=value;const create=value.create;value.create=(...args)=>{globalThis.scenarioCore=create(...args);return scenarioCore;};}});
    });
    await page.context().addCookies([{name:'wm_personal_session',value:cookie.slice(cookie.indexOf('=')+1),url:started.origin}]);
    await page.goto(started.origin+'/personal/v1/ui/');await page.waitForFunction(()=>globalThis.scenarioCore?.state.personalCapabilities?.workAndChat===1);
    await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];if(window.isVisible())throw Error('Scenario window unexpectedly visible');window.webContents.send('wm:desktop:visibility',false);});
    await page.waitForFunction(()=>scenarioCore.foreground()&&scenarioCore.state.background===false);
    report.visibility='OS window hidden; renderer foreground visibility simulated';
    timer=setTimeout(()=>{abort.abort(Error('Scenario timeout'));void app?.close();void runtime?.close();},300000);
    const until=async(read,label,timeout=90000)=>{const end=Date.now()+timeout;while(Date.now()<end){abort.signal.throwIfAborted();const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out: '+label);};
    const capture=async name=>{for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);const file=`${id}-${name}-${theme}.png`;await page.screenshot({path:join(out,file)});report.screenshots.push(file);}};
    const events=async id=>(await api(`/sessions/${id}/events?limit=200`)).events;
    const send=async text=>{await page.locator('#message-text').fill(text);await page.locator('#send-message').click();};
    return {root,out,app,page,api,until,capture,events,send,report,hostId:started.hostId,close};
  } catch(error) {await close(error);throw error;}
}

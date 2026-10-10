/** Private backup is read-only; only its disposable copy is started, then restored and hashed. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, cp, readdir, lstat, readFile, writeFile, rm, mkdir, readlink } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { productionConfigFromTask } from '../../../../scripts/migrate-desktop-config.mjs';
import { saveDesktopConfig } from '../../../../src/desktop-config.mjs';
import { hashPassword } from '../../../../src/personal-access/password.mjs';

const run = promisify(execFile), repository = resolve(import.meta.dirname, '../../../..');
const source = process.argv[2]; if (!source) throw new Error('Pass the explicitly authorized backup directory');
const releaseRoot = resolve(process.argv[3] || '.local/qa-6/releases');
const root = await mkdtemp(join(tmpdir(), 'weftmate-qa6-migration-')), profile = join(root, 'profile');
const evidence = join(repository, 'tests/evidence/qa-6/installed'); await mkdir(evidence, { recursive: true });
const control = join(process.env.APPDATA, 'WeftMate qa6'), configFile = join(control, 'WeftMate/desktop-config.json');
const installer = join(releaseRoot, '0.1.1-preview.1/build/WeftMate-Setup-0.1.1-preview.1.exe');
const installation = join(root, 'Programs/WeftMate');let executable = join(installation, 'WeftMate.exe');
let application, privateHostLog = '', accountsToProbe=[];let localStubRequests=0;
const modelStub=createServer((req,res)=>{if(req.url.endsWith('/models'))return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'qa6-offline-rehearsal',context_window:8192}]}));if(req.url==='/switch/status')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({state:'ready',current_model:'qa6-offline-rehearsal',loading:false}));if(req.url==='/props')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({total_slots:1,n_ctx:8192}));localStubRequests++;req.resume();res.writeHead(503,{'content-type':'application/json'}).end('{}');});
await new Promise(r=>modelStub.listen(0,'127.0.0.1',r));const stubBase=`http://127.0.0.1:${modelStub.address().port}/v1`;
const report = { backupReadOnly: true, sourceTaskUntouched: true, randomPort: true, publicOrigin: null,
  rehearsalAccountPassword: 'temporary synthetic password on the copy only', paidModelRequests: 0, networkBoundary: 'loopback only; 8081 and 18186 denied' };
async function hashes(dir) {
  const entries = new Map(), files = [];
  async function walk(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const file = join(current, item.name);
      if (item.isSymbolicLink()) entries.set(relative(dir, file).replaceAll('\\', '/'), 'link:' + await readlink(file));
      else if (item.isDirectory()) await walk(file);
      else if (item.isFile()) files.push(file);
    }
  }
  await walk(dir);
  for (let offset = 0; offset < files.length; offset += 32) await Promise.all(files.slice(offset, offset + 32).map(async file =>
    entries.set(relative(dir, file).replaceAll('\\', '/'), createHash('sha256').update(await readFile(file)).digest('hex'))));
  return entries;
}
const difference = (a, b) => ({ added: [...b.keys()].filter(key => !a.has(key)).length, removed: [...a.keys()].filter(key => !b.has(key)).length,
  changed: [...a.keys()].filter(key => b.has(key) && a.get(key) !== b.get(key)).length });
const env = { ...process.env, NODE_OPTIONS: `--require=${join(repository, 'tests/integration/r0-1-offline.cjs')}` };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
env.LOCALAPPDATA = join(root, 'Local'); await mkdir(env.LOCALAPPDATA);
async function start(installed) {
  application = await _electron.launch({ executablePath: installed ? executable : createRequire(import.meta.url)('electron'),
    args: installed ? [`--desktop-config=${configFile}`] : [repository, `--desktop-config=${configFile}`], cwd: root, env, timeout: 600000 });
  application.process().stdout?.on('data', bytes => privateHostLog += String(bytes));
  application.process().stderr?.on('data', bytes => privateHostLog += String(bytes));
  await application.evaluate((_electron, input) => {
    process.env.NODE_OPTIONS = input.nodeOptions;
    process.getBuiltinModule('module').createRequire(process.execPath)(input.file);
  }, { nodeOptions: env.NODE_OPTIONS, file: join(repository, 'tests/integration/r0-1-offline.cjs') });
  const page = await application.firstWindow({ timeout: 600000 }); await page.waitForURL('**/personal/v1/ui*');
  await page.waitForFunction(() => globalThis.__WeftUiStarted === true);
  const login = await page.evaluate(async input => (await fetch('/personal/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).status,
    { username: 'R01Migration', password, deviceName: installed ? 'Installed rehearsal' : 'Source rehearsal' });
  assert.equal(login, 200); await page.reload();
  const status = await page.evaluate(async () => (await fetch('/personal/v1/status')).json());
  const visibility=await page.evaluate(async({accounts,password,stubBase,useSyntheticRoute})=>{
    const results=[];
    for(const [index,account] of accounts.entries()){
      const login=await fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:account.username,password,deviceName:'QA6 isolated migration'})});
      const auth=await login.json();let preStubHealth=null,stubSelectionHttp=null;
      if(index===0&&useSyntheticRoute){const before=await fetch('/personal/v1/memory/status');const h=await before.json();preStubHealth={httpStatus:before.status,normal:h.state==='ready',pendingBoundaryCount:h.pendingBoundaryCount??null};const me=await(await fetch('/personal/v1/auth/me')).json();const headers={'content-type':'application/json','x-weftmate-csrf':me.csrfToken};let models=await(await fetch('/personal/v1/models')).json();let chosen=models.models?.find(m=>m.name==='QA6 isolated read-only rehearsal');if(!chosen){const requestId=crypto.randomUUID();const created=await fetch('/personal/v1/account/models',{method:'POST',headers,body:JSON.stringify({requestId,name:'QA6 isolated read-only rehearsal',baseUrl:stubBase,modelId:'qa6-offline-rehearsal',apiKey:'qa6-synthetic-offline'})});if(created.status!==202)throw Error('Synthetic copied-account model setup rejected: '+created.status);for(let n=0;n<120;n++){const o=await(await fetch('/personal/v1/account/models/by-request/'+requestId)).json();if(o.operation?.status==='succeeded')break;if(o.operation?.status==='failed')throw Error('Synthetic copied-account model setup failed');await new Promise(r=>setTimeout(r,250));}models=await(await fetch('/personal/v1/models')).json();chosen=models.models.find(m=>m.name==='QA6 isolated read-only rehearsal');}stubSelectionHttp=(await fetch('/personal/v1/settings/models',{method:'PATCH',headers,body:JSON.stringify({backgroundModelProfileId:chosen.id})})).status;}
      const sessions=await(await fetch('/personal/v1/sessions')).json();const memory=[];
      for(const kind of ['entity','relationship','cognition']){const r=await fetch('/personal/v1/memory/items?kind='+kind+'&limit=1');const body=await r.json();memory.push({kind,httpStatus:r.status,count:body.items?.length??null,visible:!!body.items?.length});}
      const healthResponse=await fetch('/personal/v1/memory/status');const h=await healthResponse.json();const previewResponse=await fetch('/personal/v1/memory/backfill');const preview=await previewResponse.json();
      results.push({preStubHealth,stubSelectionHttp,health:{httpStatus:healthResponse.status,normal:h.state==='ready',available:h.available??null,pendingBoundaryCount:h.pendingBoundaryCount??null,pendingFormationCount:h.pendingFormationCount??null,failedFormationCount:h.failedFormationCount??null,reasonCode:h.reasonCode??null},preview:{httpStatus:previewResponse.status,sessionCount:preview.sessionCount??null,turnCount:preview.turnCount??null,estimatedUsage:preview.estimatedUsage??null},syntheticIndex:index,loginStatus:login.status,identityRetained:auth.account?.ownerId===account.ownerId,conversationCount:sessions.sessions?.length??null,conversationsVisible:!!sessions.sessions?.length,memory,memoryVisible:memory.some(v=>v.visible)});
    }
    return {accounts:results,conversationsVisible:results.some(v=>v.conversationsVisible),memoryVisible:results.some(v=>v.memoryVisible)};
  },{accounts:accountsToProbe,password,stubBase,useSyntheticRoute:process.argv.includes('--synthetic-route')});
  return { origin: new URL(page.url()).origin, status, visibility, settings: await page.evaluate(() => weftmateDesktop.settings()) };
}
const password = `rehearsal-${randomUUID()}-password`;
try {
  console.log('Hashing authorized backup (contents never printed)');
  const before = await hashes(source); report.originalFileCount = before.size;
  await cp(source, profile, { recursive: true, errorOnExist: true });
  console.log('Backup copied; verifying every file');
  assert.deepEqual(difference(before, await hashes(profile)), { added: 0, removed: 0, changed: 0 });
  // Rebase embedded source-data paths, and substitute only the copied account's login for automation.
  async function rebase(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const file = join(current, item.name); if (item.isDirectory()) await rebase(file);
      else if (/\.(json|jsonl|yml|yaml)$/.test(item.name) && (await lstat(file)).size < 10_000_000) {
        const text = await readFile(file, 'utf8');
        const patched = text.replaceAll('D:\\\\AIProjects\\\\WeftMate\\\\Runtime\\\\UnifiedAssistant\\\\personal-account-20260926', profile.replaceAll('\\','\\\\'))
          .replaceAll('D:/AIProjects/WeftMate/Runtime/UnifiedAssistant/personal-account-20260926', profile.replaceAll('\\','/'));
        if (patched !== text) await writeFile(file, patched);
      }
    }
  }
  await rebase(profile);
  // The backup expanded DSH's generated junction fallback into real directories.
  // Recreate only this installation-owned cache; never follow its links into a source tree.
  await rm(join(profile, 'dsh-home/profiles/node_modules'), { recursive: true, force: true });
  report.generatedModuleFallbackRecreated = true;
  const backupSettings = join(profile, 'personal-backup/settings.json');
  const copiedSettings = JSON.parse(await readFile(backupSettings, 'utf8').catch(() => '{}'));
  await writeFile(backupSettings, JSON.stringify({ ...copiedSettings, directory: join(root, 'Backups') }));
  const storeFile = join(profile, 'personal-access/store.json'), store = JSON.parse(await readFile(storeFile, 'utf8'));
  const states = store.accounts ? Object.values(store.accounts) : [store];
  const target = store.accounts?.[store.legacyOwnerId]?.account?.password ? store.accounts[store.legacyOwnerId] : states.find(value => value.account?.password); if (!target) throw new Error('Expected copied local account');
  report.legacyAccountChosen=store.accounts?.[store.legacyOwnerId]===target;
  target.account.username = 'r01migration'; target.account.displayName = 'R01Migration';
  target.account.avatar ??= null; target.account.profileRevision ??= 0;
  target.account.password = await hashPassword(password);
  // Username may be stored as a canonical/display pair in legacy versions.
  if (target.account.usernameCanonical !== undefined) target.account.usernameCanonical = 'r01migration';
  if (target.account.usernameDisplay !== undefined) target.account.usernameDisplay = 'R01Migration';
  for(const [ownerId,state] of Object.entries(store.accounts||{})){
    if(!state.account)continue;
    const username=state===target?'r01migration':'qa6migration'+accountsToProbe.length;
    state.account.username=username;state.account.displayName=username;state.account.password=await hashPassword(password);
    if(state.account.usernameCanonical!==undefined)state.account.usernameCanonical=username;
    if(state.account.usernameDisplay!==undefined)state.account.usernameDisplay=username;
    accountsToProbe.push({ownerId,username});
  }
  if(!accountsToProbe.length)accountsToProbe=[{ownerId:target.account.ownerId,username:'r01migration'}];
  report.accountProbeScope='All stored account identities; synthetic local login aliases/passwords exist only on disposable copy. No account names, ids or private memory text exported.';
  await writeFile(storeFile, JSON.stringify(store));
  report.accountIdentityRetained = true;
  if (process.argv.includes('--wait-native')) {
    console.log('Copy prepared; waiting for the separate installer cycle to release its QA identity');
    const deadline = Date.now() + 1800000;
    while (!await readFile(join(repository, '.local/qa-6/native-cycle-finished'), 'utf8').catch(() => false)) {
      if (Date.now() > deadline) throw new Error('Native installer cycle has not finished');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const migrationDir=join(root,'migration');
  const rehearsalArgs=['-NoProfile','-ExecutionPolicy','Bypass','-File',join(repository,'scripts/migrate-installed-desktop.ps1'),'-SourceTaskScript',join(repository,'scripts/run-personal-host-task.ps1'),'-DataDirectory',profile,'-ConfigFile',configFile,'-MigrationDirectory',migrationDir,'-TaskName','QA6-Never-Created','-InstalledExe',executable,'-Rehearsal'];
  await run('powershell.exe',[...rehearsalArgs,'-Action','Prepare'],{windowsHide:true});
  report.prepareScript=true;
  report.rehearsalRefused=[];
  for(const action of ['Apply','Rollback']){try{await run('powershell.exe',[...rehearsalArgs,'-Action',action],{windowsHide:true});throw Error('Unsafe rehearsal accepted');}catch(e){assert.match(String(e.stderr||e.message),/Rehearsal must never control/);report.rehearsalRefused.push(action);}}
  const config = JSON.parse(await readFile(configFile,'utf8'));
  const memoryConfig=join(root,'offline-memory.json');
  await writeFile(memoryConfig,JSON.stringify({python:'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',pythonPath:'C:/Temp/weftmate-qa6-core/py/src',baseUrl:'http://127.0.0.1:1/v1',model:'@current',authRef:'qa6-unavailable-offline'}));
  config.personalMemoryConfig=memoryConfig;
  saveDesktopConfig(configFile, config);
  console.log('Starting source rehearsal, with offline network boundary');
  const sourceRun = await start(false); report.sourceRuntimeReady = sourceRun.status.backend?.runtime;
  report.sourceVisibility=sourceRun.visibility;
  await application.close(); application = null;
  await run(installer, ['/S','/currentuser',`/D=${installation}`], { env, windowsHide: true, timeout: 600000 });
  executable=join(installation,(await readdir(installation)).find(n=>n.endsWith('.exe')&&!/Uninstall|Recovery/.test(n)));
  const installedRun = await start(true);
  console.log('Installed rehearsal loaded');
  assert.equal(installedRun.status.backend?.runtime, 'ready');
  assert.notEqual(new URL(installedRun.origin).port, '18186'); assert.notEqual(new URL(installedRun.origin).port, '8081');
  report.installedRuntimeReady = true; report.localLogin = true; report.sameDataDirectory = true;
  report.installedVisibility=installedRun.visibility;
  saveDesktopConfig(configFile,{...config,accessPort:Number(new URL(installedRun.origin).port)});
  try{await run('powershell.exe',[...rehearsalArgs,'-Action','Verify'],{windowsHide:true});report.verifyScript=true;}
  catch(e){report.verifyScript=false;report.verifyFailure={httpStatus:/401/.test(String(e.stderr))?401:null,stage:'anonymous GET /personal/v1/config',script:'scripts/migrate-installed-desktop.ps1:69'};}
  saveDesktopConfig(configFile,config);
  report.components = { port: 'random loopback, reachable', login: 'copied owner with temporary local password, passed',
    memoryBridge: 'isolated pinned Core against copied data; model traffic blocked',
    relay: 'disabled for the offline rehearsal', certificate: 'ACME disabled; existing certificate files preserved in the backup' };
  await application.close(); application = null;
  report.startupFileChanges = difference(before, await hashes(profile));
  // Source rollback uses the same data directory; no production task is controlled by this runner.
  const revertedRun = await start(false); assert.equal(revertedRun.status.backend?.runtime, 'ready'); report.sourceRollback = true;
  report.rollbackVisibility=revertedRun.visibility;
  await application.close(); application = null;
  // Keep this owned installation until finally; the private profile is removed before the optional synthetic recheck.
  // Restore the disposable rehearsal copy, then compare every file; this is explicitly not a claim that a running host writes no files.
  await rm(profile, { recursive: true, force: true }); await cp(source, profile, { recursive: true });
  report.restoredCopy = difference(before, await hashes(profile));
  report.backupAfter = difference(before, await hashes(source));
  assert.deepEqual(report.restoredCopy, { added: 0, removed: 0, changed: 0 }); assert.deepEqual(report.backupAfter, { added: 0, removed: 0, changed: 0 });
  report.hashesMatchAfterRehearsalRestore = true; report.profileLifecyclePassed = true;
  report.conversationCountsPreserved=JSON.stringify(report.sourceVisibility.accounts.map(a=>a.conversationCount))===JSON.stringify(report.installedVisibility.accounts.map(a=>a.conversationCount))&&JSON.stringify(report.sourceVisibility.accounts.map(a=>a.conversationCount))===JSON.stringify(report.rollbackVisibility.accounts.map(a=>a.conversationCount));report.syntheticLocalRouteForCoreHealth=process.argv.includes('--synthetic-route');report.localStubRejectedRequests=localStubRequests;report.cloudModelRequests=0;report.previewOnly=true;report.backfillConfirmed=false;report.legacyMemoryHealthyAcrossPhases=[report.sourceVisibility,report.installedVisibility,report.rollbackVisibility].every(v=>v.accounts[0].health.normal&&v.accounts[0].health.pendingBoundaryCount===0&&v.accounts[0].memory.every(m=>m.httpStatus===200&&m.count===0));report.passed=report.verifyScript&&report.conversationCountsPreserved&&report.profileLifecyclePassed&&report.legacyMemoryHealthyAcrossPhases;
  await writeFile(join(evidence, 'migration-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  await rm(profile, {recursive:true,force:true}); report.backupCopyDeleted=true; privateHostLog='';
  await writeFile(join(evidence, 'migration-report.json'), JSON.stringify(report, null, 2));
  if(process.argv.includes('--approval-recheck')) { report.privateCopyDeletedBeforeSyntheticInference=true; report.modelTrafficScope='cloudModelRequests=0 covers only the private backup rehearsal; the later independent synthetic account uses MiMo and records its own usage'; await (await import('./approval-recheck.mjs')).recheckApprovals(executable); report.syntheticApprovalRecheck={performed:true,evidence:'../approval-recheck/results.json',usage:'../approval-recheck/usage.json'}; }
} finally {
  await writeFile(join(evidence, 'migration-report.json'), JSON.stringify(report, null, 2));
  // Private diagnostic text is deliberately discarded, never persisted.
  privateHostLog='';modelStub.closeAllConnections();await new Promise(r=>modelStub.close(r));
  await application?.close().catch(() => {});
  if (await readFile(join(installation, 'Uninstall WeftMate.exe')).then(() => true).catch(() => false))
    await run(join(installation, 'Uninstall WeftMate.exe'), ['/S'], { env, windowsHide: true, timeout: 600000 }).catch(() => {});
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });report.backupCopyDeleted=true;await writeFile(join(evidence,'migration-report.json'),JSON.stringify(report,null,2)); await rm(control, { recursive: true, force: true });
  await rm(join(process.env.LOCALAPPDATA, 'weftmate-qa6-updater'), { recursive: true, force: true });
}

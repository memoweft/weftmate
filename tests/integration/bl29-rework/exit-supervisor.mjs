import { spawn, execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync, existsSync, readdirSync, readlinkSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const electron = createRequire(import.meta.url)('electron');
const windows = process.platform === 'win32';
const script = resolve('tests/integration/bl29-rework/owned-processes.ps1');
export const scrub = value => {
  let text=String(value);
  for (const profile of [process.env.USERPROFILE, process.env.USERPROFILE?.replaceAll('\\','\\\\'), process.env.USERPROFILE?.replaceAll('\\','/')].filter(Boolean))
    text=text.replaceAll(profile,'C:/Users/<user>');
  return text.replaceAll(process.env.COMPUTERNAME || '\0','<host>');
};
const ps = (action, root, pid) => {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Action', action, '-Root', root, ...(pid ? ['-ProcessId', String(pid)] : [])], { encoding: 'utf8', windowsHide: true });
  return output.trim() ? JSON.parse(output) : null;
};
export function createOwnedRoot() {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-bl29-exit-'));
  writeFileSync(join(root, 'ownership.json'), JSON.stringify({ root, startedAt: new Date().toISOString(), executables: [electron, process.execPath] }));
  return root;
}
function posixIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return { pid, createdAt: stat[19], executable: readlinkSync(`/proc/${pid}/exe`) };
  } catch { return null; }
}
export function recordProcess(root, pid, profile) {
  const row = windows ? ps('register', root, pid) : posixIdentity(pid);
  if (row) appendFileSync(join(root, 'processes.jsonl'), JSON.stringify({ ...row, profile }) + '\n');
}
export async function recordProcessDuringStartup(root, pid, profile) {
  if (!windows) return recordProcess(root,pid,profile);
  const output=await new Promise((done,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
    '-Action','register','-Root',root,'-ProcessId',String(pid)],{encoding:'utf8',windowsHide:true},(error,stdout)=>error?reject(error):done(stdout)));
  const row=String(output).trim()?JSON.parse(String(output)):null;
  if(row)appendFileSync(join(root,'processes.jsonl'),JSON.stringify({...row,profile})+'\n');
}
export function resources(root) {
  try { return windows ? ps('resources', root) : { at: new Date().toISOString(), memory: process.memoryUsage(), tcp: 'Windows counters only' }; }
  catch (error) { return { error: scrub(error.message) }; }
}
export function cleanupOwned(root) {
  if (basename(resolve(root)).startsWith('weftmate-') !== true) throw Error('Unexpected owned test root');
  const ownership = JSON.parse(readFileSync(join(root, 'ownership.json'), 'utf8'));
  if (resolve(root) !== ownership.root) throw Error('Ownership root mismatch');
  if (windows) return ps('cleanup', root);
  // Linux CI has /proc identities; cleanup never relies on the parent PID.
  const recorded = remainingOwned(root);
  const killed = [];
  for (const row of recorded) {
    const current = posixIdentity(row.pid);
    if (!current || current.createdAt !== row.createdAt || current.executable !== row.executable) continue;
    if (!readFileSync(`/proc/${row.pid}/cmdline`, 'utf8').includes(root)) continue;
    try { process.kill(row.pid, 'SIGKILL'); killed.push(row.pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  // SIGKILL is delivered asynchronously: give the kernel a bounded moment to tear the
  // processes down before the caller checks /proc for leftovers.
  const pause = new Int32Array(new SharedArrayBuffer(4)), deadline = Date.now() + 2000;
  while (Date.now() < deadline && killed.some(pid => posixIdentity(pid))) Atomics.wait(pause, 0, 0, 25);
  return { matched: killed.length, killed };
}
export function remainingOwned(root) {
  if (windows) return ps('list', root) || [];
  const ownership = JSON.parse(readFileSync(join(root, 'ownership.json'), 'utf8'));
  return readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
    const current = posixIdentity(Number(name));
    try { return current && ownership.executables.includes(current.executable) && readFileSync(`/proc/${name}/cmdline`, 'utf8').includes(root) ? [current] : []; }
    catch { return []; }
  });
}
export async function superviseExit({ timeout = 110000, args = ['--head-only'], abortAtStage, timeoutAfterStage, outputDir } = {}) {
  // Ownership exists in the parent before the driver starts. A fast-fail in
  // launch cannot erase the parent's process/directory cleanup responsibility.
  const root = createOwnedRoot(), env = { ...process.env, BL29_OWNED_ROOT: root,
    BL29_EVIDENCE_DIR: root, WEFTMATE_TEST_HOST_NAME: 'synthetic-host', TMP: root, TEMP: root, TMPDIR: root };
  delete env.ELECTRON_RUN_AS_NODE;
  let child, timer, watcher, timedOut=false, stdout = '', stderr = '', result, stages = [], rows = [], cleanup;
  const expire=()=>{timedOut=true;child.kill('SIGKILL');};
  const before = resources(root);
  try {
    child = spawn(process.execPath, ['--report-on-fatalerror', '--report-exclude-env', `--report-directory=${root}`,
      'tests/integration/bl29-rework/probe-exit.mjs', ...args], { env, windowsHide: true });
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const completed = new Promise(resolve => {
      child.once('error', error => resolve({ status: null, error: scrub(error.message) }));
      child.once('close', (status, signal) => resolve({ status, signal }));
    });
    timer = setTimeout(expire, timeout);
    if (abortAtStage) watcher = setInterval(() => {
      if (existsSync(join(root, 'stages.jsonl')) && readFileSync(join(root, 'stages.jsonl'), 'utf8').includes(`"stage":"${abortAtStage}"`)) {
        clearInterval(watcher);
        if (timeoutAfterStage !== undefined) {clearTimeout(timer);timer=setTimeout(expire,timeoutAfterStage);}
        else child.kill('SIGKILL');
      }
    }, 50);
    result = await completed;
    const status = result.status;
    result.hex = typeof status === 'number' ? '0x' + (status >>> 0).toString(16).toUpperCase().padStart(8, '0') : null;
    if (existsSync(join(root, 'stages.jsonl'))) stages = readFileSync(join(root, 'stages.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    if (existsSync(join(root, 'exit.json'))) rows = JSON.parse(readFileSync(join(root, 'exit.json'), 'utf8'));
    const registeredProcesses=existsSync(join(root,'processes.jsonl')) ? readFileSync(join(root,'processes.jsonl'),'utf8').trim().split('\n').map(JSON.parse) : [];
    const publicProfile=profile=>'%TEMP%/'+basename(root)+'/'+relative(root,profile).replaceAll('\\','/');
    for(const row of stages)if(row.profile)row.profile=publicProfile(row.profile);
    for(const row of registeredProcesses)row.profile=publicProfile(row.profile);
    result = { ...result, timedOut, stdout: scrub(stdout), stderr: scrub(stderr), lastStage: stages.at(-1), registeredProcesses, before, resources: resources(root) };
    result.fatalReports=readdirSync(root).filter(name=>/^report.*\.json$/.test(name))
      .map(name=>({name,report:scrub(readFileSync(join(root,name),'utf8'))}));
  } finally {
    clearTimeout(timer); clearInterval(watcher);
    cleanup = cleanupOwned(root);
    const remaining = remainingOwned(root);
    if (remaining.length) throw Error(`Owned processes remain: ${JSON.stringify(remaining.map(row => row.pid))}`);
    if (outputDir) {
      writeFileSync(join(outputDir, 'exit-supervisor.json'), scrub(JSON.stringify({ ...result, stages, rows, cleanup, remaining: 0 }, null, 2)));
    }
    // This is the parent's explicit root, verified above, including every
    // profile and the driver's fatal report. Preserve failure details first.
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  return JSON.parse(scrub(JSON.stringify({ ...result, rows, stages, cleanup, remaining: 0, rootRemoved: !existsSync(root) })));
}

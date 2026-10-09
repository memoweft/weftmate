/** PF-1b: unchanged four memory scenarios plus sealed C, then LAN wire timings.
 * Runs the existing real Electron/DSH/Core runners under one atomic LAN lease.
 */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openSync, closeSync, writeFileSync, readFileSync, statSync, rmSync, mkdirSync, utimesSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const out = resolve(option('--out', 'tests/evidence/pf-1b/memory-performance'));
const core = resolve(option('--memory-core-source', 'D:/AIProjects/MemoWeft/Core/py/src'));
const lock = 'D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock';
const token = `PF-1b memory/performance ${randomUUID()}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exec = promisify(execFile);
const values = {};
for (const [name, scope] of [['MIMO_API_KEY','Machine'], ['WEFTMATE_LAN_MODEL_KEY','User'], ['WEFTMATE_LAN_MODEL_BASE_URL','User']]) {
  values[name] = (await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], {windowsHide:true})).stdout.trim();
  assert.ok(values[name], `${name} absent`);
}
const secrets = [...Object.values(values), new URL(values.WEFTMATE_LAN_MODEL_BASE_URL).host];
const redact = text => secrets.reduce((text, secret) => text.replaceAll(secret, '[private]'), String(text));
mkdirSync(out, {recursive:true});
const save = (file, data) => writeFileSync(join(out,file), redact(JSON.stringify(data,null,2))+'\n');
async function child(args, env = process.env) {
  let output = '';
  const code = await new Promise((finish,reject)=> {
    const processChild = spawn(process.execPath,args,{cwd:resolve(import.meta.dirname,'../..'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    for (const stream of [processChild.stdout,processChild.stderr]) stream.on('data',chunk=> {output+=String(chunk);process.stdout.write(redact(chunk));});
    processChild.on('error',reject);processChild.on('close',finish);
  });
  return {code,output};
}
if (process.argv.includes('--self-test')) {
  const result = await child(['-e', "setTimeout(() => { console.log('PF1B_CHILD_DONE'); process.exitCode = 7; }, 100);"]);
  assert.equal(result.code, 7, 'wait for the actual numeric child exit status');
  assert.match(result.output, /PF1B_CHILD_DONE/, 'collect output before moving to the next stage');
  console.log('PF-1b child lifecycle self-test passed.');
  process.exit(0);
}
while (true) {
  try { const fd = openSync(lock,'wx'); try {writeFileSync(fd,token+' '+new Date().toISOString());} finally {closeSync(fd);} break; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = statSync(lock,{throwIfNoEntry:false});
    if (!info) continue;
    if (Date.now()-info.mtimeMs>10800000) {rmSync(lock);continue;}
    console.log('LAN occupied; next atomic attempt in five minutes.'); await pause(300000);
  }
}
const timer = setInterval(()=> {if (readFileSync(lock,'utf8').startsWith(token)) utimesSync(lock,new Date(),new Date());},60000);
const runs = [], timings = [];
try {
  for (const model of option('--model', 'mimo,lan').split(',')) {
    assert.ok(['mimo','lan'].includes(model), '--model mimo|lan|mimo,lan');
    const result = await child(['tests/integration/personal-scenario-baseline.mjs','--memory-loop','--memory-trace','--memory-semantic-judge',
      ...(model==='mimo'?['--mimo','--mimo-machine','--alternate-lan']:['--lan']), '--only',
      option('--only','memory-01-preference,memory-02-correction,memory-03-switch-model,memory-04-person,memory-3x-preference,memory-3x-correction,memory-3x-person'),
      '--memory-core-source',core,
      ...(process.argv.includes('--formation-wait-ms') ? ['--formation-wait-ms', option('--formation-wait-ms')] : [])]);
    const root = /Isolated \w+ root: ([^\r\n]+)/.exec(result.output)?.[1];
    const report = root && existsSync(join(root,'eval/results.json')) ? JSON.parse(readFileSync(join(root,'eval/results.json'))) : null;
    runs.push({model,root,exitCode:result.code,formationWaitMs:Number(option('--formation-wait-ms',0)),report});save(`${model}.json`,runs.at(-1));
    if (root && existsSync(join(root,'requests.jsonl'))) save(`${model}-requests.json`,readFileSync(join(root,'requests.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)));
    if (root && existsSync(join(root,'memory-requests.jsonl'))) save(`${model}-formation.json`,readFileSync(join(root,'memory-requests.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)));
  }
  for (const scene of process.argv.includes('--skip-performance') ? [] : ['greeting','file']) for (let repetition=1;repetition<=3;repetition++) {
    const timingFile=join(out,`${scene}-${repetition}-timing.json`),captureFile=join(out,`${scene}-${repetition}-request.json`);
    const env={...process.env,...values,PF1_LAN:'1',PF1_QUIET:'1',PF1_TIMING_FILE:timingFile,PF1_CAPTURE_FILE:captureFile};
    if(scene==='file') env.PF1_INPUT='读取 pf1-input.txt，回复文件原文，不要修改文件。';
    else delete env.PF1_INPUT;
    const result=await child(['tests/integration/personal-prompt-size.mjs'],env);
    timings.push({scene,repetition,exitCode:result.code,timings:existsSync(timingFile)?JSON.parse(readFileSync(timingFile)):null});
    save('timings.json',timings);
  }
  save('summary.json',{runs:runs.map(({model,root,exitCode,report})=>({model,root,exitCode,summary:report?.summary})),timings});
} finally {
  clearInterval(timer);
  if(existsSync(lock)&&readFileSync(lock,'utf8').startsWith(token)) rmSync(lock);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkHiddenSubprocesses, hiddenSubprocessViolations } from '../scripts/check-hidden-subprocesses.mjs';

test('application subprocess launches always hide console windows',async()=>{
  assert.deepEqual(await checkHiddenSubprocesses(),[]);
});
test('only the verified Notepad GUI action can show its intended application window',async()=>{
  const source=await readFile(new URL('../src/personal-desktop-task.mjs',import.meta.url),'utf8');
  assert.deepEqual(hiddenSubprocessViolations(source,'src/personal-desktop-task.mjs'),[]);
  assert.equal(hiddenSubprocessViolations(source.replaceAll("'notepad.exe'","'cmd.exe'"),'src/personal-desktop-task.mjs').length,1);
  assert.equal(hiddenSubprocessViolations(source.replace('shell: false','shell: true'),'src/personal-desktop-task.mjs').length,1);
});
test('subprocess check resolves imports, promisified executors and injection defaults',()=>{
  const bad=`import {spawn as launch,execFile} from 'node:child_process'; import * as cp from 'node:child_process';
    const execute=promisify(execFile); function run({spawnProcess=launch}={}){spawnProcess('cmd.exe',[],{});}
    launch('pwsh',[],{}); execute('git',[],{});cp.fork('worker.mjs',[],{});
    boundedCommand('frpc',['-v'],{timeoutMs:1000});`;
  assert.equal(hiddenSubprocessViolations(bad).length,5);
  assert.deepEqual(hiddenSubprocessViolations(`import {spawn} from 'child_process';spawn('cmd.exe',[],{shell:true,windowsHide:true}); /x/.exec('x');database.exec('sql');sessions.fork('session');`),[]);
  assert.equal(hiddenSubprocessViolations(`import {spawn} from 'child_process';spawn('cmd.exe',[],{windowsHide:true,...options});`).length,1);
  assert.deepEqual(hiddenSubprocessViolations(`import {spawn} from 'child_process';spawn('cmd.exe',[],{...options,windowsHide:true});`),[]);
  assert.equal(hiddenSubprocessViolations(`import launch from 'cross-spawn';launch('cmd.exe',[],{});`).length,1);
  assert.deepEqual(hiddenSubprocessViolations(`import {spawn} from 'node:child_process';spawn('cmd.exe',[],{'windowsHide':true});`),[]);
});

// Detach from the Actions step's console; the worker writes a completion result.
import { spawn } from 'node:child_process';
import { openSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [exe, script, scope]=process.argv.slice(2);
const stdout=openSync(join(scope,'stdout.log'),'w'),stderr=openSync(join(scope,'stderr.log'),'w');
try {
  const child=spawn(exe,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action','worker','-Scope',scope],{
    detached:true,windowsHide:true,stdio:['ignore',stdout,stderr],
  });
  child.once('error',error=>{console.error(error.code);process.exitCode=1;});
  child.once('spawn',()=>{writeFileSync(join(scope,'worker.pid'),String(child.pid));child.unref();});
} finally {closeSync(stdout);closeSync(stderr);}

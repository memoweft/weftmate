import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runManagedTestProcess } from './helpers/managed-test-process.mjs';

test('an exited root with inherited descendant pipes completes cleanup and cannot block later files', {timeout:30000}, async()=>{
  const scope=mkdtempSync(join(tmpdir(),'weftmate-managed-pipes-')),pidFile=join(scope,'grandchild.pid');
  let pid;
  try {
    const source=`const {spawn}=require('node:child_process');const fs=require('node:fs');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',${JSON.stringify(scope)}],{stdio:['ignore',process.stdout,process.stderr],windowsHide:true});
      fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));console.log('root finished');child.unref();`;
    const result=await runManagedTestProcess(process.execPath,['-e',source,scope],{env:process.env,commandRoots:[scope],timeoutMs:3000});
    assert.equal(result.status,0,'the root itself exited normally');
    assert.match(result.stdout,/root finished/);pid=Number(readFileSync(pidFile,'utf8'));
    let alive=true;for(let i=0;i<40&&alive;i++){try{process.kill(pid,0);await new Promise(r=>setTimeout(r,50));}catch{alive=false;}}
    assert.equal(alive,false,'deadline removes the pipe-holding descendant');
    const next=await runManagedTestProcess(process.execPath,['-e',"console.log('later file ran')",scope],{env:process.env,commandRoots:[scope],timeoutMs:3000});
    assert.equal(next.status,0);assert.match(next.stdout,/later file ran/);
  }finally{if(pid)try{process.kill(pid);}catch{}rmSync(scope,{recursive:true,force:true});}
});

test('file deadline terminates its owned child tree and a later file can still run', async()=>{
  const scope=mkdtempSync(join(tmpdir(),'weftmate-managed-timeout-')),pidFile=join(scope,'grandchild.pid');
  let pid;
  try {
    const source=`const {spawn}=require('node:child_process');const fs=require('node:fs');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',${JSON.stringify(scope)}],{stdio:'ignore',windowsHide:true});
      fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));console.log('fixture running');setInterval(()=>{},1000);`;
    const result=await runManagedTestProcess(process.execPath,['-e',source,scope],{env:process.env,commandRoots:[scope],timeoutMs:3000});
    assert.equal(result.timedOut,true);assert.notEqual(result.status,0);assert.match(result.stdout,/fixture running/);
    assert.ok(existsSync(pidFile));pid=Number(readFileSync(pidFile,'utf8'));
    let alive=true;
    for(let i=0;i<40&&alive;i++){try{process.kill(pid,0);await new Promise(r=>setTimeout(r,50));}catch{alive=false;}}
    assert.equal(alive,false,'timeout releases the owned grandchild');
    const next=await runManagedTestProcess(process.execPath,['-e',"console.log('later file ran')",scope],{env:process.env,commandRoots:[scope],timeoutMs:3000});
    assert.equal(next.status,0);assert.equal(next.timedOut,false);assert.match(next.stdout,/later file ran/);
  }finally{if(pid)try{process.kill(pid);}catch{}rmSync(scope,{recursive:true,force:true});}
});

test('a completed Windows runner cleans its owned detached descendant before removing the scope',{skip:process.platform!=='win32'},async()=>{
  const scope=mkdtempSync(join(tmpdir(),'weftmate-managed-descendant-')),pidFile=join(scope,'child.pid');
  let pid;
  try{
    const source=`const {spawn}=require('node:child_process');const fs=require('node:fs');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',${JSON.stringify(scope)}],{stdio:'ignore',windowsHide:true,detached:true});
      fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();`;
    const result=await runManagedTestProcess(process.execPath,['-e',source],{env:process.env,commandRoots:[scope]});
    assert.equal(result.status,0);pid=Number((await import('node:fs')).readFileSync(pidFile,'utf8'));
    let alive=true;for(let i=0;i<20&&alive;i++){try{process.kill(pid,0);await new Promise(resolve=>setTimeout(resolve,50));}catch{alive=false;}}
    assert.equal(alive,false,'normal runner completion releases its detached child');
  }finally{if(pid)try{process.kill(pid);}catch{}rmSync(scope,{recursive:true,force:true});}
});

test('managed output callback receives both streams before exit while final collection stays complete', async()=>{
  const scope=mkdtempSync(join(tmpdir(),'weftmate-managed-output-')),release=join(scope,'release');
  let ready:()=>void=()=>{},completed=false,forced=false;
  const firstOutput=new Promise<void>(resolve=>{ready=resolve;});
  const streamed={stdout:'',stderr:''};
  const source=`const fs=require('node:fs');
    process.stdout.write('synthetic stdout first\\n');process.stderr.write('synthetic stderr first\\n');
    const timer=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(timer);
      process.stdout.write('synthetic stdout last\\n');process.stderr.write('synthetic stderr last\\n');}},5);`;
  const running=runManagedTestProcess(process.execPath,['-e',source,release],{env:process.env,commandRoots:[scope],
    onOutput:(stream:'stdout'|'stderr',chunk:Buffer)=>{
      streamed[stream]+=chunk;
      if(streamed.stdout.includes('first')&&streamed.stderr.includes('first'))ready();
    }}).then(result=>{completed=true;return result;});
  // A deferred-at-close callback cannot pass: the child waits for this test to
  // observe both live streams before it is released to write its tail and exit.
  const fallback=setTimeout(()=>{forced=true;writeFileSync(release,'fallback');ready();},3000);
  try {
    await firstOutput;
    assert.equal(forced,false,'both stream callbacks arrive while the child is waiting');
    assert.equal(completed,false);
    writeFileSync(release,'release');
    const result=await running;
    assert.equal(result.status,0);assert.equal(result.error,undefined);assert.equal(result.interrupted,null);
    assert.equal(result.stdout,'synthetic stdout first\nsynthetic stdout last\n');
    assert.equal(result.stderr,'synthetic stderr first\nsynthetic stderr last\n');
    assert.equal(streamed.stdout,result.stdout);assert.equal(streamed.stderr,result.stderr);
  } finally {
    clearTimeout(fallback);writeFileSync(release,'cleanup');await running;
    rmSync(scope,{recursive:true,force:true});
  }
});

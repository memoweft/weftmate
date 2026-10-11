import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runManagedTestProcess } from './helpers/managed-test-process.mjs';

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

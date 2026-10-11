import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { migrationHost } from '../helpers/migration-host.mjs';
import { createProcessEvidence, cleanupOwnedProcesses } from '../helpers/process-evidence.mjs';
const executable=resolve(process.argv[2]),repo=resolve(import.meta.dirname,'../..'),root=resolve(mkdtempSync('C:/weftmate-rob1-installed-')),startedAt=Date.now();
const output=join(repo,'tests/evidence/rob-1');mkdirSync(output,{recursive:true});
let h,ev,cleaned=0;
try {
  h=await migrationHost({executable,tempRoot:root,processEvidence:spec=>ev=createProcessEvidence({outputDir:join(repo,'.local/rob-1-installed-first-run'),profileDirectory:spec.profile,commandRoots:[root],executables:[executable,process.execPath],startedAt})});
  assert.equal(await h.app.evaluate(({app})=>app.isPackaged),true);
  assert.equal((await h.api('/account/models')).body.models[0].configured,true);
  const child=h.app.process(),exited=once(child,'exit'),closed=once(child,'close');
  const cleanup=cleanupOwnedProcesses({startedAt,executables:[executable,process.execPath],commandRoots:[root]});cleaned+=cleanup.cleaned;
  assert.equal(cleanup.available,true);assert.equal(cleanup.failed,0);assert.ok(cleanup.cleaned>0,'fault injection must terminate owned packaged processes');
  await exited;await closed;
  h.app=null;
  // The first run has never quit normally. Also discard Chromium's state to
  // prove the independently durable protected key works in the packaged main.
  rmSync(join(h.profile,'Local State'),{force:true});
  try {await h.launch();} catch(error) {ev.recordLaunchFailure(error);throw error;}
  assert.equal((await h.api('/account/models')).body.models[0].configured,true);
  assert.equal(h.requests.length,0);
  writeFileSync(join(output,'installed-first-run.json'),JSON.stringify({packaged:true,normalInitializationBeforeKill:false,firstRunSavedSyntheticCredential:true,forcedRestart:true,lostLocalStateRestored:true,credentialReadable:true,modelRequests:0,cleaned},null,2)+'\n');
} finally {
  await h?.close();const c=await ev?.finalize();cleaned+=c?.cleaned||0;
  if(!c?.stillRunning&&!c?.preservationError)rmSync(root,{recursive:true,force:true});console.log(`已清理进程：${cleaned}`);
}

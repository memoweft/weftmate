import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createProcessEvidence } from './helpers/process-evidence.mjs';
test('real Windows Electron survives first-run and legacy-upgrade interruption at every credential commit phase', {skip:process.platform!=='win32',timeout:15*60*1000},async()=>{
  const evidence=createProcessEvidence({outputDir:resolve('.local/rob-1-matrix-runner'),executables:[process.execPath],commandRoots:[resolve('tests/integration')],startedAt:Date.now()});
  const {child,done}=evidence.spawn(process.execPath,[resolve('tests/integration/rob-1-vault-matrix.mjs'),'after-fix']);
  const timer=setTimeout(()=>child.kill('SIGKILL'),14*60*1000);
  try {const result=await done;assert.equal(result.decimal,0, result.stderrTail);}
  finally {clearTimeout(timer);const cleanup=await evidence.finalize();assert.equal(cleanup.stillRunning,false);}
});

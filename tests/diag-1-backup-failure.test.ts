import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackupManager } from '../src/personal-backup/index.mjs';
import { included } from '../src/personal-backup/archive.mjs';
import { createHostDiagnostics } from '../src/host-diagnostics.mjs';

test('backup shutdown failure is diagnosed with its real code and stack while observer failures preserve its outcome', async () => {
  for (const observerThrows of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), 'weftmate-diag1-backup-'));
    try {
      await mkdir(join(root, 'personal-backup'));
      await writeFile(join(root, 'personal-backup', 'pending.json'), JSON.stringify({reason:'before-upgrade'}));
      const diag = createHostDiagnostics(root, {appRoot:process.cwd()}); diag.begin();
      let seen:any;
      const manager = await createBackupManager({root,isIdle:async()=>true,requestRestart:()=>{},
        onShutdownFailure(error) { seen=diag.failure('shutdown-backup',error); if(observerThrows)throw new Error('synthetic observer failure'); }});
      assert.equal(await manager.finishShutdown({safe:false}),true);
      assert.equal(seen.code,'SERVICE_CLOSING');
      assert.ok(seen.stackFrames.some((frame:string)=>frame.startsWith('src/personal-backup/')));
      const status = JSON.parse(await readFile(join(root,'personal-backup','status.json'),'utf8'));
      assert.equal(status.state,'failed'); assert.equal(status.code,'SERVICE_CLOSING');
    } finally {await rm(root,{recursive:true,force:true});}
  }
});

test('host run logs, the run marker and native dumps never enter a personal backup', () => {
  for (const path of ['logs/host-2026-10-11.jsonl', 'logs/host-2026-10-11-1.jsonl', 'logs/current-run.json', 'Crashpad/reports/00000000-0000-4000-8000-000000000000.dmp']) assert.equal(included(path), false, path);
  // Only the data-root diagnostics directory is omitted; user content keeps its own folder names.
  for (const path of ['conversations/logs/notes.md', 'workspace/project/logs/build.txt', 'personal-access/store.json']) assert.equal(included(path), true, path);
});

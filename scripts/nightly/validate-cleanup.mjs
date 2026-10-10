import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { option } from '../review-gallery/common.mjs';
const out = resolve(option('--out')), root = await mkdtemp(join(tmpdir(), 'weftmate-nightly-clean-test-'));
const children = [];
async function child(marker) {
  const process = spawn(processExec, ['--input-type=module', '-e', 'console.log("ready");setInterval(()=>{},1000)', marker], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(process); await once(process.stdout, 'data'); return process;
}
const processExec = process.execPath;
try {
  const older = await child(root + '/owned');
  await new Promise(done => setTimeout(done, 1100));
  const since = new Date().toISOString();
  const owned = await child(root + '/owned'), other = await child(root + '/owned-other');
  const roots = join(root, 'roots.json'); await writeFile(roots, JSON.stringify([root + '/owned']));
  // Exact owned marker, without the sibling-prefix ambiguity of a bare root.
  const result = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', resolve('scripts/nightly/cleanup.ps1'), '-Since', since, '-RootsJson', roots], { encoding: 'utf8', windowsHide: true }));
  await new Promise(done => setTimeout(done, 300));
  assert.ok(result.killed.includes(owned.pid)); assert.equal(older.exitCode, null); assert.equal(other.exitCode, null);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'cleanup-validation.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ownedNewProcessStopped: true, olderProcessPreserved: true, unrelatedNewProcessPreserved: true, cleanupCount: result.count }, null, 2) + '\n');
  console.log('Cleanup ownership: newly created owned process stopped; older and unrelated processes preserved.');
} finally { for (const child of children) if (child.exitCode === null) child.kill(); await rm(root, { recursive: true, force: true }); }

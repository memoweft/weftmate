// Offline only: no shell commands from the fixture are executed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyPersonalRisk } from '../../../src/plugins/personal-approval-policy.mjs';
import { shellWriteTargets } from '../../../src/plugins/personal-write-targets.mjs';

const baselineCommit = '33d8cada6a9f7d149ba452aae86ef7f08c4d6686';
const temporary = mkdtempSync(join(tmpdir(), 'weftmate-apr-replay-'));
try {
  for (const file of ['personal-approval-policy.mjs', 'personal-write-targets.mjs'])
    writeFileSync(join(temporary, file), execFileSync('git', ['show', `${baselineCommit}:src/plugins/${file}`]));
  const baseline = await import(pathToFileURL(join(temporary, 'personal-approval-policy.mjs')).href);
  const args = JSON.parse(readFileSync(new URL('./action-02-original-command.json', import.meta.url), 'utf8'));
  const writes = shellWriteTargets(args.command, process.cwd()).map(write => ({
    ...write, existed: write.target ? existsSync(write.target) : null,
  }));
  const report = {
    source: 'EV-1 saved failed action-02 command; unchanged, offline only', baselineCommit,
    commandSha256: createHash('sha256').update(args.command).digest('hex'), modelRequests: 0, writes,
    oldRisk: baseline.classifyPersonalRisk('pwsh', args), newRisk: classifyPersonalRisk('pwsh', args),
  };
  assert.deepEqual(report.oldRisk, ['overwrite']);
  assert.deepEqual(report.newRisk, []);
  assert.equal(writes.filter(write => write.kind === 'write').length, 2);
  assert.ok(writes.filter(write => write.kind === 'write').every(write => !write.existed));
  writeFileSync(new URL('./offline-replay.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log('EV-1 unchanged command: overwrite -> no approval; 2 absent targets; model requests 0');
} finally { rmSync(temporary, { recursive: true, force: true }); }

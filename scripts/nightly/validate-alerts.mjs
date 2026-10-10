// Fault injection into a disposable copy of a real run; never edits the report.
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { option, catalog } from '../review-gallery/common.mjs';
import { report } from './report.mjs';
const input = resolve(option('--run')), evidence = resolve(option('--out'));
const root = await mkdtemp(join(tmpdir(), 'weftmate-nightly-faults-'));
try {
  await mkdir(evidence, { recursive: true });
  await cp(join(input, 'gallery'), join(root, 'gallery'), { recursive: true });
  const original = JSON.parse(await readFile(join(input, 'nightly-status.json'), 'utf8'));
  await rm(join(root, 'gallery/review-windows-login-light.png'));
  const stalePath = join(root, 'gallery/review-windows-sessions-light.json');
  const stale = JSON.parse(await readFile(stalePath, 'utf8')); stale.generatedAt = new Date(Date.now() - 25 * 3600_000).toISOString();
  await writeFile(stalePath, JSON.stringify(stale));
  const failedPath = join(root, 'gallery/review-windows-approval-dark.json');
  const failed = JSON.parse(await readFile(failedPath, 'utf8')); delete failed.file; failed.status = 'failed'; failed.reason = '人为注入：该格定位失败';
  await rm(join(root, 'gallery/review-windows-approval-dark.png'));
  await writeFile(failedPath, JSON.stringify(failed));
  const result = await report(root, { commit: original.commit, startedAt: new Date().toISOString(), phases: [], cleanup: { disposableFaultInjection: true } });
  for (const [cell, kind] of [['windows/login/light', 'missing'], ['windows/sessions/light', 'stale'], ['windows/approval/dark', 'failed']]) {
    assert.ok(result.alerts.some(row => row.cell === cell && row.kind === kind), `${cell}: ${kind}`);
  }
  await writeFile(join(evidence, 'fault-injection.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sourceCommit: original.commit, sourceDurationSeconds: original.durationSeconds,
    deletedImage: 'missing alarm passed', oldTimestamp: 'stale alarm passed', sceneFailure: 'failed alarm passed', productionReportUntouched: true,
    injectedAlerts: result.alerts.filter(row => ['windows/login/light', 'windows/sessions/light', 'windows/approval/dark'].includes(row.cell)) }, null, 2) + '\n');
  console.log('Deleted image, old timestamp and failed cell: alarms passed.');
} finally { await rm(root, { recursive: true, force: true }); }

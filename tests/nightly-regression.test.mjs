import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { inspect, difference, pixels, retention, previousRun } from '../scripts/nightly/report.mjs';
import { startTimelineCandidate } from './integration/timeline-ui-candidate.mjs';
import { androidPackages, androidPackageReason } from '../scripts/nightly/android-packages.mjs';

test('Android inventory names leftover test packages without classifying the daily or unknown package as disposable', async () => {
  const output = 'package:com.memoweft.weftmate.mobile\npackage:com.memoweft.weftmate.mobile.s3aqa\npackage:com.memoweft.weftmate.mobile.stage15memoryqa.test\npackage:com.memoweft.weftmate.mobile.debug.test\npackage:com.memoweft.weftmate.mobile.unknown\n';
  assert.deepEqual(androidPackages(output).testPackages, ['com.memoweft.weftmate.mobile.debug.test', 'com.memoweft.weftmate.mobile.s3aqa', 'com.memoweft.weftmate.mobile.stage15memoryqa.test']);
  const reason = androidPackageReason(output);
  const result = await inspect([], { phases: [{ name: 'android', status: 'skipped', reason }] });
  assert.ok(result.alerts[0].message.includes('com.memoweft.weftmate.mobile.stage15memoryqa.test'));
  assert.ok(reason.includes('com.memoweft.weftmate.mobile.unknown'));
  assert.equal(androidPackageReason('error: device offline'), '');
});

test('task registration prefers the stable alias and WhatIf describes the complete action without registering', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-nightly-task-'));
  try {
    const alias = join(root, 'Microsoft', 'WindowsApps', 'pwsh.exe');
    await mkdir(join(root, 'Microsoft', 'WindowsApps'), { recursive: true });
    await writeFile(alias, 'synthetic alias');
    // Mock every ScheduledTasks constructor and mutation. The actual task
    // service is never called, even if ShouldProcess regresses.
    const harness = join(root, 'verify.ps1');
    await writeFile(harness, `param([string]$Registration, [string]$FakeLocal)\n$ErrorActionPreference = 'Stop'\n$env:LOCALAPPDATA = $FakeLocal\nfunction New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory) @{ Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory } }\nfunction New-ScheduledTaskTrigger {}\nfunction New-ScheduledTaskPrincipal {}\nfunction New-ScheduledTaskSettingsSet {}\nfunction Register-ScheduledTask { throw 'registration must never run' }\n& $Registration -WhatIf -MaxMinutes 17\n`);
    const run = () => execFileSync('pwsh', ['-NoProfile', '-File', harness, join(process.cwd(), 'scripts/nightly/register-task.ps1'), root], { encoding: 'utf8' });
    const withAlias = run();
    assert.ok(withAlias.includes(`Execute: ${alias}`));
    assert.match(withAlias, /Arguments: -NoProfile -WindowStyle Hidden -File ".*run-nightly\.ps1" -MaxMinutes 17/);
    assert.ok(withAlias.includes(`WorkingDirectory: ${join(process.cwd(), 'scripts/nightly')}`));
    await rm(alias);
    const fallback = execFileSync('pwsh', ['-NoProfile', '-Command', '(Get-Command pwsh).Source'], { encoding: 'utf8' }).trim();
    assert.ok(run().includes(`Execute: ${fallback}`));
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Minimal non-interlaced 8-bit PNG, enough to verify decoded pixel comparisons.
function png(color, filter = 0) {
  const chunk = (name, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(name, 4); return Buffer.concat([head, data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.from([filter, ...color, ...(filter === 1 ? [0, 0, 0, 0] : color)]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const commit = 'a'.repeat(40), now = Date.parse('2026-10-10T12:00:00Z');
const row = { platform: 'windows', scene: 'login', theme: 'light', path: 'new.png', generatedAt: new Date(now).toISOString(), commit };

test('deleted cell, stale capture, failed capture and busy platform all alert independently', async () => {
  const records = [{ ...row, path: undefined }, { ...row, theme: 'dark', generatedAt: new Date(now - 86400_001).toISOString() }, { ...row, scene: 'sessions', status: 'failed', reason: '定位失败' }];
  const report = await inspect(records, { now, commit, phases: [{ name: 'apple', status: 'skipped', reason: '被占用，未拍（LAN 锁）' }] });
  assert.deepEqual(report.alerts.map(a => a.kind), ['missing', 'stale', 'failed', 'skipped']);
  assert.equal(report.counts.windows.expected, 3);
  assert.equal(report.counts.windows.captured, 1);
});
test('24-hour boundary is inclusive, wrong commit and future capture alert', async () => {
  assert.equal((await inspect([{ ...row, generatedAt: new Date(now - 86400_000).toISOString() }], { now, commit })).alerts.length, 0);
  assert.deepEqual((await inspect([{ ...row, commit: 'b'.repeat(40), generatedAt: new Date(now + 120000).toISOString() }], { now, commit })).alerts.map(a => a.kind), ['stale', 'commit']);
});
test('catalog-declared absent surfaces do not create fake expected cells', async () => {
  const result = await inspect([{ platform: 'watch', scene: 'login', theme: 'light' }, { platform: 'watch', scene: 'approval', theme: 'light' }], { now });
  assert.equal(result.counts.watch.unavailable, 1); assert.equal(result.counts.watch.expected, 1);
  assert.equal(result.alerts.length, 1); assert.equal(result.alerts[0].cell, 'watch/approval/light');
});
test('PNG filters and compression changes compare by decoded pixels, with tolerance', () => {
  assert.deepEqual(pixels(png([100, 120, 140, 255], 1)).rgba, pixels(png([100, 120, 140, 255])).rgba);
  assert.equal(difference(png([100, 120, 140, 255]), png([120, 120, 140, 255])).ratio, 0);
  assert.equal(difference(png([100, 120, 140, 255]), png([125, 120, 140, 255])).ratio, 1);
  assert.throws(() => pixels(Buffer.from('invalid')), /Invalid PNG/);
});
test('pixel threshold alerts and largest differences are sorted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nightly-diff-'));
  try {
    await writeFile(join(root, 'new.png'), png([100, 120, 140, 255])); await writeFile(join(root, 'old.png'), png([0, 0, 0, 255]));
    const result = await inspect([{ ...row, path: join(root, 'new.png') }], { now, threshold: 0.08, baseline: [{ ...row, file: 'old.png' }], baselineDirectory: root });
    assert.equal(result.alerts[0].kind, 'diff'); assert.equal(result.differences[0].ratio, 1);
    const failed = await inspect([{ ...row, path: join(root, 'new.png') }], { now, baseline: [{ ...row, file: 'deleted.png' }], baselineDirectory: root });
    assert.equal(failed.alerts[0].kind, 'diff-error');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('retention removes only expired date directories and retains exactly 14 calendar days', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nightly-retention-'));
  try {
    for (const name of ['2026-09-26', '2026-09-27', '2026-10-10', 'private-data']) await mkdir(join(root, name));
    assert.deepEqual(await retention(root, new Date('2026-10-10T12:00:00')), ['2026-09-26']);
    for (const name of ['2026-09-27', '2026-10-10', 'private-data']) await access(join(root, name));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('baseline selects previous run, including a second run on the same date', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nightly-baseline-'));
  try {
    const old = join(root, '2026-10-10', '1000', 'gallery'), current = join(root, '2026-10-10', '1100', 'gallery');
    for (const dir of [old, current]) { await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'manifest.json'), JSON.stringify({ records: [{ ...row, file: 'old.png' }] })); }
    assert.equal((await previousRun(root, current)).baselineDirectory, old);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('fresh gallery never fills occupied native cells with repository history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nightly-gallery-'));
  try {
    const outcomes = join(root, 'outcomes.json');
    await writeFile(outcomes, JSON.stringify([{ platform: 'mac', scene: 'login', theme: 'light', status: 'failed', reason: '被占用，未拍', synthetic: true, commit, generatedAt: new Date(now).toISOString() }]));
    execFileSync(process.execPath, ['scripts/review-gallery/build.mjs', '--out', root, '--fresh-only', '--outcomes', outcomes], { stdio: 'pipe' });
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    assert.ok(manifest.records.every(row => !row.file));
    assert.equal(manifest.failures.length, 1); assert.equal(manifest.failures[0].reason, '被占用，未拍');
    assert.ok((await readFile(join(root, 'index.html'), 'utf8')).includes('被占用，未拍'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('synthetic artifact write is observed before exposing its task approval', async () => {
  const fixture = await startTimelineCandidate({ historyCount: 0, interactive: true, riskApproval: true });
  try {
    assert.equal(await realpath(fixture.root), fixture.root, 'fixture uses the same native canonical path as private storage');
    const writes = (await fixture.request('/commands')).commands.filter(row => row.kind === 'desktop.write_artifact');
    assert.equal(writes.length, 1); assert.equal(writes[0].state, 'observed');
    for (let read = 0; read < 5; read++) {
      const approvals = (await fixture.request(`/sessions/${fixture.sessionId}/approvals`)).approvals;
      assert.equal(approvals.length, 1); assert.equal(approvals[0].status, 'pending');
      const questions = (await fixture.request(`/sessions/${fixture.sessionId}/questions`)).questions;
      assert.equal(questions.length, 1); assert.equal(questions[0].status, 'pending');
    }
  } finally { await fixture.close(); await rm(fixture.root, { recursive: true, force: true }); }
});

test('temp pruning removes only stale unused weftmate-* directories and never follows a junction', { skip: process.platform !== 'win32' }, async () => {
  // Keep the caller's spelling of TEMP: the script must protect active roots
  // even when Windows enumerates a different (expanded 8.3) spelling.
  const root = await mkdtemp(join(tmpdir(), 'nightly-prune-root-'));
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'nightly-prune-outside-')));
  const script = join(process.cwd(), 'scripts/nightly/prune-temp.ps1');
  const ps = (command, options = {}) => execFileSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', ...options });
  let holder;
  try {
    await writeFile(join(outside, 'keep.txt'), 'outside data');
    for (const name of ['weftmate-old', 'weftmate-recent', 'weftmate-in-use', 'other-old']) {
      await mkdir(join(root, name, 'nested'), { recursive: true }); await writeFile(join(root, name, 'nested', 'file.txt'), name);
    }
    // A junction inside a stale directory must be unlinked, not traversed.
    ps(`New-Item -ItemType Junction -Path '${join(root, 'weftmate-old', 'link')}' -Target '${outside}' | Out-Null`);
    const old = "(Get-Date).AddDays(-3)";
    for (const name of ['weftmate-old', 'weftmate-in-use', 'other-old'])
      ps(`$d = Get-Item -LiteralPath '${join(root, name)}'; $d.CreationTime = ${old}; $d.LastWriteTime = ${old}`);
    const { spawn } = await import('node:child_process');
    holder = spawn('pwsh', ['-NoProfile', '-Command', `Write-Output 'ready'; Start-Sleep 60 # ${join(root, 'weftmate-in-use')}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await new Promise((done, reject) => {
      holder.stdout.once('data', bytes => bytes.toString().trim() === 'ready' ? done() : reject(Error('unexpected holder output')));
      holder.once('error', reject);
      holder.once('exit', code => reject(Error(`holder exited before pruning: ${code}`)));
    });
    const run = extra => JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', script, '-Hours', '48', '-Roots', root, ...extra], { encoding: 'utf8' }).trim().split(/\r?\n/).pop());
    const preview = run([]);
    assert.deepEqual([preview.applied, preview.found, preview.selected, preview.deleted, preview.keptRecent, preview.keptInUse], [false, 3, 1, 0, 1, 1]);
    // Reproduce the cloud's exact mismatch: the enumerator exposes a native
    // path while CIM retains the supplied root alias. Keep the real holder
    // above as the end-to-end in-use check; this harness isolates alias handling.
    const alias = join(root, 'alias'), harness = join(root, 'alias-preview.ps1');
    ps(`New-Item -ItemType Junction -Path '${alias}' -Target '${root}' | Out-Null`);
    await writeFile(harness, `param($Script,$AliasRoot,$NativeRoot)\n$ErrorActionPreference='Stop'\nfunction Get-CimInstance { [pscustomobject]@{CommandLine="pwsh # $(Join-Path $AliasRoot 'weftmate-in-use')"} }\nfunction Get-ChildItem { param($LiteralPath,[switch]$Directory,$Filter,[switch]$Force,$ErrorAction) Microsoft.PowerShell.Management\\Get-ChildItem -LiteralPath $NativeRoot -Directory -Filter 'weftmate-*' -Force }\n& $Script -Roots $AliasRoot -Hours 48\n`);
    const aliased = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', harness, script, alias, root], {encoding:'utf8', windowsHide:true}).trim().split(/\r?\n/).pop());
    assert.deepEqual([aliased.applied, aliased.found, aliased.selected, aliased.deleted, aliased.keptRecent, aliased.keptInUse], [false, 3, 1, 0, 1, 1]);
    await rm(alias);
    await access(join(root, 'weftmate-old'));
    const applied = run(['-Apply']);
    assert.deepEqual([applied.applied, applied.selected, applied.deleted, applied.failed], [true, 1, 1, 0]);
    await assert.rejects(access(join(root, 'weftmate-old')));
    for (const kept of ['weftmate-recent', 'weftmate-in-use', 'other-old']) await access(join(root, kept, 'nested', 'file.txt'));
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'outside data');
  } finally {
    if (holder && holder.exitCode === null) {
      const exited = new Promise(done => holder.once('exit', done));
      holder.kill(); await exited;
    }
    await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true });
  }
});

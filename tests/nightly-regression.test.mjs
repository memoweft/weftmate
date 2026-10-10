import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { inspect, difference, pixels, retention, previousRun } from '../scripts/nightly/report.mjs';

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectEvidence } from '../../scripts/review-gallery/evidence.mjs';
import { assertPublicText } from '../../scripts/review-gallery/common.mjs';
test('choose newest timestamp independently of checkout mtime and retain original provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-review-test-'));
  try {
    const metadata = { platform: 'watch', scene: 'login', theme: 'light', commit: 'a'.repeat(40), synthetic: true };
    for (const [suffix, generatedAt] of [['20990101T000000Z', '2099-01-01T00:00:00Z'], ['20980101T000000Z', '2098-01-01T00:00:00Z']]) {
      const file = join(root, `review-watch-login-light-${suffix}.png`);
      await writeFile(file, 'fixture'); await writeFile(file.replace(/\.png$/, '.json'), JSON.stringify({ ...metadata, generatedAt, source: suffix }));
    }
    const rows = await collectEvidence(root), selected = rows.find(row => row.platform === 'watch' && row.scene === 'login' && row.theme === 'light');
    assert.equal(selected.source, '20990101T000000Z'); assert.equal(selected.commit, 'a'.repeat(40));
    assert.equal(rows.find(row => row.platform === 'mac' && row.scene === 'memory' && row.theme === 'dark').status, '待补');
    const file = join(root, 'review-watch-login-dark.png'); await writeFile(file, 'fixture');
    await writeFile(file.replace(/\.png$/, '.json'), JSON.stringify({ ...metadata, theme: 'light', generatedAt: '2099-01-01T00:00:00Z' }));
    await assert.rejects(collectEvidence(root), /disagrees/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('public text scan detects observed credential and personal-path formats', () => {
  for (const value of ['D:\\AIProjects\\Example\\private', '/Users/person/private', 'Bearer synthetic-token', 'owner@private.test', 'sk-1234567890abcdef']) assert.throws(() => assertPublicText(value));
  assert.doesNotThrow(() => assertPublicText('合成账号 review@example.test · notes.md · 42 项测试通过'));
});

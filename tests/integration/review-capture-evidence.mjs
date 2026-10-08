import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectEvidence } from '../../scripts/review-gallery/evidence.mjs';
import { assertPublicText, captureSummary, catalog, capturePlatforms, runScene } from '../../scripts/review-gallery/common.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
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

test('only more than half of attempted capture cells fails the threshold; missing outcomes are infrastructure errors', () => {
  const rows = capturePlatforms.flatMap(platform => catalog.scenes.flatMap(scene => catalog.themes.map(theme => ({ platform: platform.id, scene: scene.id, theme, file: 'synthetic.png' }))));
  const fail = index => { delete rows[index].file; rows[index].status = 'failed'; };
  for (let index = 0; index < rows.length / 2; index++) fail(index);
  assert.equal(captureSummary(rows).exceedsHalf, false);
  fail(rows.length / 2); assert.equal(captureSummary(rows).exceedsHalf, true);
  assert.throws(() => captureSummary(rows.slice(1)), /infrastructure/);
});

test('one missing selector leaves a failure tile and summary while later scenes capture; privacy stays fatal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-review-recovery-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent('<h1>合成审稿页面</h1>');
    const options = { page, out: root, platform: 'windows', theme: 'light' };
    // An existing old screenshot must never mask this run's failed scene.
    await runScene({ ...options, scene: 'login', prepare: async () => {} });
    const failed = await runScene({ ...options, scene: 'login', prepare: () => page.getByRole('heading', { name: '不存在的页面' }).waitFor({ timeout: 50 }) });
    assert.equal(failed.status, 'failed');
    const captured = await runScene({ ...options, scene: 'sessions', prepare: () => page.getByRole('heading', { name: '合成审稿页面' }).waitFor() });
    assert.ok(captured.file);
    const rows = await collectEvidence(root);
    assert.equal(rows.find(row => row.platform === 'windows' && row.scene === 'login' && row.theme === 'light').status, 'failed');
    execFileSync(process.execPath, ['scripts/review-gallery/build.mjs', '--out', root], { stdio: 'pipe' });
    const html = await readFile(join(root, 'index.html'), 'utf8'); assertPublicText(html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, ''));
    await page.goto(pathToFileURL(join(root, 'index.html')).href);
    assert.equal(await page.locator('.capture-failures li').count(), 1);
    assert.equal(await page.locator('#login .missing').filter({ hasText: '截图失败：' }).count(), 1);
    assert.equal(await page.locator('#sessions .comparison[data-capture-theme=light] figure').first().locator('img').count(), 1);
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setContent('<p>owner@private.test</p>');
    await assert.rejects(runScene({ ...options, scene: 'memory', prepare: async () => {} }), /Public evidence/);
    await page.setContent('<input type="password" value="synthetic-password">');
    await assert.rejects(runScene({ ...options, scene: 'memory', prepare: async () => {} }), /Clear password/);
    await assert.rejects(runScene({ ...options, scene: 'memory', prepare: async () => { throw Error('Host failed'); } }), /infrastructure/);
    await page.close();
    await assert.rejects(runScene({ ...options, scene: 'memory', prepare: () => page.getByRole('heading').waitFor() }), /infrastructure/);
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
});

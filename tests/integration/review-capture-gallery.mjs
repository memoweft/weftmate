import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { catalog, outDirectory, assertPublicText, captureSummary } from '../../scripts/review-gallery/common.mjs';
const out = outDirectory();
const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
const html = await readFile(join(out, 'index.html'), 'utf8');
assertPublicText(html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, ''));
assert.equal(manifest.records.length, catalog.scenes.length * catalog.platforms.length * catalog.themes.length);
assertPublicText(JSON.stringify(manifest));
const summary = captureSummary(manifest.records);
const failedEvidence = manifest.records.filter(row => row.status === 'failed');
assert.deepEqual(manifest.failures, failedEvidence);
for (const row of manifest.records.filter(row => ['windows', 'mobile-web'].includes(row.platform) && row.status !== 'failed')) {
  assert.ok(row.file, `${row.platform}/${row.scene}/${row.theme} must be captured`);
  assert.equal(row.synthetic, true); assertPublicText(row.text);
  const expected = catalog.platforms.find(platform => platform.id === row.platform).viewport;
  assert.deepEqual(row.viewport, expected);
  const png = await readFile(join(out, row.file));
  assert.equal(png.readUInt32BE(16), expected.width); assert.equal(png.readUInt32BE(20), expected.height);
}
const browser = await chromium.launch();
const checks = [];
try {
  for (const width of [1600, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(join(out, 'index.html')).href);
    for (const theme of catalog.themes) {
      await page.getByLabel('截图外观').selectOption(theme);
      await page.getByLabel('页面外观').selectOption(theme);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.locator('.comparison:visible').count(), catalog.scenes.length);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}/${theme}`);
      for (const image of await page.locator('.comparison:visible img').all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(node => node.decode());
        assert.ok(await image.evaluate(node => node.naturalWidth > 0));
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(out, `gallery-${width}-${theme}.png`) });
      assert.equal(await page.locator('.capture-failures li').count(), failedEvidence.length);
      assert.equal(await page.locator('.comparison .missing').filter({ hasText: /^截图失败：/ }).count(), failedEvidence.length);
      if (await page.locator('.comparison:visible .capture').count()) {
        await page.locator('.comparison:visible .capture').first().click();
        await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
      }
      checks.push(`${width}/${theme}: no overflow, all images decode, themes, keyboard enlargement`);
    }
    assert.deepEqual(errors, []); await page.close();
  }
} finally { await browser.close(); }
await writeFile(join(out, 'verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
  syntheticCaptures: summary.captured, failedCaptures: summary.failed, failedEvidenceCells: failedEvidence.length, attemptedCaptures: summary.attempted, exceedsHalf: summary.exceedsHalf, textAndMetadataScan: 'passed', scanScope: 'captured DOM text, password inputs, manifest and embedded HTML; historical device images manually reviewed, no OCR claim', checks }, null, 2) + '\n');
console.log(`Gallery verification passed (${checks.length} viewport/theme combinations; ${summary.captured} synthetic captures, ${summary.failed} failed).`);

assert.equal(summary.exceedsHalf, false, `More than half of capture scenes failed (${summary.failed}/${summary.attempted})`);

for (const theme of catalog.themes) assert.ok(manifest.records.some(row => row.platform === 'mobile-web' && row.scene === 'outputs-sources' && row.theme === theme && row.file && row.status !== 'failed'), `mobile-web/outputs-sources/${theme} must be captured`);

import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export const repository = resolve(import.meta.dirname, '../..');
export const catalog = JSON.parse(await readFile(join(import.meta.dirname, 'scenes.json'), 'utf8'));
export const commit = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
export function option(name, fallback) { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; }
export const outDirectory = () => resolve(option('--out', '.local/review-gallery'));
export const delay = ms => new Promise(done => setTimeout(done, ms));
export const capturePlatforms = catalog.platforms.filter(row => row.capture !== 'evidence');
export function captureSummary(records) {
  const expected = capturePlatforms.flatMap(platform => catalog.scenes.flatMap(scene => catalog.themes.map(theme => ({ platform: platform.id, scene: scene.id, theme }))));
  const selected = expected.map(key => records.find(row => row.platform === key.platform && row.scene === key.scene && row.theme === key.theme));
  if (selected.some(row => !row || (!row.file && row.status !== 'failed'))) throw Error('Capture infrastructure did not produce every scene outcome');
  const failures = selected.filter(row => row.status === 'failed');
  return { attempted: selected.length, captured: selected.length - failures.length, failed: failures.length, exceedsHalf: failures.length > selected.length / 2, failures };
}
// Recover only scene navigation errors. Capture, privacy, provenance and process
// failures remain fatal, with no DOM/credential-bearing diagnostics in public output.
export async function runScene({ page, out, platform, scene, theme, prepare, application }) {
  const file = `review-${platform}-${scene}-${theme}.png`;
  await mkdir(out, { recursive: true });
  await rm(join(out, file), { force: true });
  await rm(join(out, file.replace(/\.png$/, '.json')), { force: true });
  try { await prepare(); }
  catch (error) {
    if (page.isClosed() || !/TimeoutError|locator\.|getByRole\.|getByLabel\.|strict mode violation/.test(`${error.name} ${error.message}`)) throw Error('Scene infrastructure failed', { cause: error });
    const label = catalog.scenes.find(row => row.id === scene).label;
    const reason = error.name === 'TimeoutError' ? `等待「${label}」页面元素超时` : `「${label}」页面元素定位失败`;
    const record = { platform, scene, theme, status: 'failed', reason, commit: commit(), generatedAt: new Date().toISOString(), synthetic: true };
    await writeFile(join(out, file.replace(/\.png$/, '.json')), JSON.stringify(record, null, 2) + '\n');
    console.log(`${platform}/${scene}/${theme}: 截图失败：${reason}`);
    return record;
  }
  return capture(page, out, platform, scene, theme, application);
}
export async function capture(page, out, platform, scene, theme, application) {
  await page.evaluate(() => document.fonts.ready);
  await delay(350);
  await page.mouse.move(0, 0);
  const text = await page.locator('body').innerText();
  assertPublicText(text);
  // Passwords are never present in a captured input, including synthetic passwords.
  const passwords = await page.locator('input[type=password]').evaluateAll(nodes => nodes.some(n => n.value));
  if (passwords) throw Error('Clear password inputs before capture');
  await mkdir(out, { recursive: true });
  const file = `review-${platform}-${scene}-${theme}.png`;
  if (application) {
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus();
    });
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const png = await application.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      return image.toPNG().toString('base64');
    });
    await writeFile(join(out, file), Buffer.from(png, 'base64'));
  } else await page.screenshot({ path: join(out, file), animations: 'disabled' });
  const record = { platform, scene, theme, file, commit: commit(), generatedAt: new Date().toISOString(), synthetic: true,
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), source: platform === 'windows' ? 'production createPersonalDesktop + FE-1a isolated host' : 'Chromium + FE-1b isolated host', text };
  await writeFile(join(out, file.replace(/\.png$/, '.json')), JSON.stringify(record, null, 2) + '\n');
  return record;
}
export function assertPublicText(text) {
  const rules = [/\b[A-Z]:[\\/]/i, /\/(?:Users|home|tmp|private\/var|var\/lib|etc)\//,
    /(?:Bearer\s+|sk-[A-Za-z0-9]{12,}|-----BEGIN .*PRIVATE KEY)/i,
    /[A-Z0-9._%+-]+@(?!example\.(?:com|test|invalid)\b)[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /(?:isolated|synthetic)-[a-f0-9]{8}-[a-f0-9-]{27,}/i];
  if (rules.some(rule => rule.test(text))) throw Error('Public evidence contains a credential, personal email, or machine path');
}

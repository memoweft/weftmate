import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export const repository = resolve(import.meta.dirname, '../..');
export const catalog = JSON.parse(await readFile(join(import.meta.dirname, 'scenes.json'), 'utf8'));
export const commit = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
export function option(name, fallback) { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; }
export const outDirectory = () => resolve(option('--out', '.local/review-gallery'));
export const delay = ms => new Promise(done => setTimeout(done, ms));
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

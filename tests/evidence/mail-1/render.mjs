import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { challengeMail, passwordChangedMail, emailChangedMail, MAIL_MARK_URL } from '../../../services/cloud/src/mail-templates.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const png = await readFile(new URL('../../../services/cloud/assets/weftmate-mark.png', import.meta.url));
const messages = Object.fromEntries([
  ...['register', 'reset', 'device', 'email'].map(purpose => [purpose, challengeMail(purpose, '012345', 'synthetic-device')]),
  ['password-changed', passwordChangedMail()], ['email-changed', emailChangedMail()],
]);
await mkdir(path.join(root, 'html'), { recursive: true });
await mkdir(path.join(root, 'screenshots'), { recursive: true });
const browser = await chromium.launch({ headless: true });
const rows = [];
const copies = [];
const requests = [];
const contrasts = [];
const contrast = (foreground, background) => {
  const luminance = rgb => rgb.match(/\d+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
try {
  for (const [name, mail] of Object.entries(messages)) {
    await writeFile(path.join(root, 'html', `${name}.html`), mail.html);
    for (const theme of ['light', 'dark']) for (const width of [640, 360]) {
      await capture(name, mail.html, theme, width, 'normal');
    }
  }
  for (const theme of ['light', 'dark']) {
    await capture('register', messages.register.html, theme, 360, 'blocked-image');
    await capture('register', messages.register.html.replace(/<style>[\s\S]*?<\/style>/, ''), theme, 360, 'no-style');
    for (const width of [480, 390]) await capture('register', messages.register.html, theme, width, 'normal');
  }
  // An allowed 128-character identifier must wrap inside the narrow card too.
  await capture('device-long', challengeMail('device', '012345', 'synthetic-'.padEnd(128, 'x')).html, 'dark', 360, 'normal', false);

  async function capture(name, html, theme, width, variant, screenshot = true) {
    const context = await browser.newContext({ viewport: { width, height: 780 }, colorScheme: theme, permissions: ['clipboard-read', 'clipboard-write'] });
    try {
      const page = await context.newPage();
      await page.route('**/*', async route => {
        const url = route.request().url();
        if (url.startsWith('file:')) return route.continue();
        requests.push({ name, theme, width, variant, url, action: variant === 'blocked-image' ? 'blocked' : 'local-fixture' });
        assert.equal(url, MAIL_MARK_URL, 'no unexpected external resource');
        if (variant === 'blocked-image') await route.abort();
        else await route.fulfill({ contentType: 'image/png', body: png });
      });
      const source = path.join(root, 'html', variant === 'no-style' ? 'register-no-style.html' : `${name}.html`);
      if (variant === 'no-style' || !screenshot) await writeFile(source, html);
      await page.goto(new URL(`file:///${source.replaceAll('\\', '/')}`).href);
      const metrics = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
        const colors = selector => { const s=getComputedStyle(document.querySelector(selector)); return { foreground:s.color, background:s.backgroundColor }; };
        return { documentWidth:document.documentElement.scrollWidth, card:rect('.mail-card'), logo:rect('img'), logoLoaded:document.querySelector('img').naturalWidth > 0,
          title:rect('h1'), code:document.querySelector('.mail-code') ? rect('.mail-code') : null,
          canvas:colors('body'), cardColors:colors('.mail-card'), body:colors('.mail-body'), muted:colors('.mail-muted'), heading:colors('h1'),
          codeFont:document.querySelector('.mail-code') ? getComputedStyle(document.querySelector('.mail-code')).fontSize : null };
      });
      assert.equal(metrics.documentWidth, width, 'no horizontal scroll');
      assert.equal(metrics.logo.width, 56); assert.equal(metrics.logo.height, 56);
      assert.equal(metrics.logoLoaded, variant !== 'blocked-image');
      assert.equal(metrics.card.x, (width - metrics.card.width) / 2, 'centered card');
      assert.ok(metrics.title.x >= metrics.card.x && metrics.title.x + metrics.title.width <= metrics.card.x + metrics.card.width);
      assert.equal(metrics.cardColors.background, variant === 'no-style' || theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(38, 39, 36)');
      for (const target of ['body', 'muted', 'heading']) {
        const ratio = contrast(metrics[target].foreground, metrics.cardColors.background);
        assert.ok(ratio >= 4.5, `${target} contrast ${ratio}`);
        contrasts.push({ name, theme, width, variant, target, ratio:Number(ratio.toFixed(2)) });
      }
      if (metrics.code) {
        assert.equal(metrics.code.height, 45, 'six digits remain on one line');
        const selected = await page.evaluate(() => {
          const element = document.querySelector('.mail-code');
          const range = document.createRange(); range.selectNodeContents(element);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          const r=range.getBoundingClientRect(), parent=element.getBoundingClientRect();
          return { text:selection.toString(), right:r.right, parentRight:parent.right, nodes:element.childNodes.length };
        });
        assert.equal(selected.text, '012345'); assert.equal(selected.nodes, 1); assert.ok(selected.right <= selected.parentRight);
        await page.keyboard.press('Control+c');
        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        assert.equal(clipboard, '012345', 'copied clipboard contains six continuous digits');
        copies.push({ name, theme, width, variant, selected:selected.text, clipboard });
        await page.evaluate(() => window.getSelection().removeAllRanges());
      }
      const filename = `${name}-${theme}-${width}${variant === 'normal' ? '' : `-${variant}`}.png`;
      if (screenshot) await page.screenshot({ path:path.join(root, 'screenshots', filename), fullPage:true });
      rows.push({ name, theme, width, variant, screenshot:screenshot ? `screenshots/${filename}` : null, ...metrics });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(path.join(root, 'render-checks.json'), JSON.stringify({ screenshots:rows.filter(row => row.screenshot).length, copies, contrasts, requests, rows }, null, 2) + '\n');
const preview = html => html.match(/<div class="mail-preview"[^>]*>(.*?)<\/div>/s)[1].split('&#8204;')[0];
const visible = html => [...html.matchAll(/<(?:h1|p)[^>]*>(.*?)<\/(?:h1|p)>/gs)].map(match => match[1]);
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const copy = Object.entries(messages).map(([name, mail]) => `## ${name}\n\nSubject（主题）：${mail.subject}\n\n预览文字：${preview(mail.html)}\n\nHTML（网页邮件）可见文案：\n\n${visible(mail.html).map(line => `- ${line}`).join('\n')}\n\nText（纯文字邮件）全文：\n\n\`\`\`text\n${mail.text}\n\`\`\`\n`).join('\n');
await writeFile(path.join(root, 'README.md'), readme.split('<!-- generated-copy -->')[0] + '<!-- generated-copy -->\n\n' + copy);
console.log(JSON.stringify({ screenshots:rows.filter(row => row.screenshot).length, selectionAndClipboardChecks:copies.length, externalNetworkCalls:0, minimumContrast:Math.min(...contrasts.map(row => row.ratio)) }));

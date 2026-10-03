/** Fixed official-page diagnostic for the Stage 11 default browser reader. */
import { app, BrowserWindow, session } from 'electron';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sep } from 'node:path';
import { createPersonalBrowserReader } from '../../src/personal-browser/index.mjs';

const profile = process.argv.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
if (process.env.WEFTMATE_BROWSER_PUBLIC_DIAGNOSTIC !== '1' || !profile || !existsSync(profile) ||
    !realpathSync(profile).startsWith(realpathSync(tmpdir()) + sep + 'weftmate-browser-public-diagnostic-')) {
  process.exit(2);
}
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const reader = createPersonalBrowserReader({ BrowserWindow, session });
  const targets = [
    'https://www.electronjs.org/docs/latest/api/browser-window',
    'https://www.electronjs.org/docs/latest/api/session',
  ];
  for (const [index, url] of targets.entries()) {
    let result;
    try {
      const read = await reader.read({ ownerId: 'owner-diagnostic', taskId: `task-${index}`,
        sessionId: 'session-diagnostic', receiptId: `receipt-${index}`, callId: `call-${index}`, url });
      result = { target: index, ok: true, title: read.title, url: read.url,
        textBytes: Buffer.byteLength(read.text, 'utf8'), truncated: read.truncated,
        links: read.links.length };
    } catch (error) {
      result = { target: index, ok: false, code: error?.code ?? 'UNKNOWN',
        nativeCode: error?.nativeCode ?? null, selectedAddress: error?.selectedAddress ?? null };
    }
    process.stdout.write(`DIAG_JSON:${JSON.stringify(result)}\n`);
  }
  await reader.close();
  app.quit();
}).catch(() => process.exit(3));

/** Owned Electron child for the opt-in Stage 11 browser reader fixture. */
import { app, BrowserWindow, session } from 'electron';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createPersonalBrowserReader } from '../../src/personal-browser/index.mjs';
import { createPinnedProxy } from '../../src/personal-browser/network.mjs';

const profile = process.argv.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
const fixturePort = Number(process.env.WEFTMATE_BROWSER_FIXTURE_PORT);
function refuse(code) { process.stderr.write(`[browser-fixture] ${code}\n`); process.exit(2) }
if (process.env.WEFTMATE_BROWSER_SYNTHETIC_FIXTURE !== '1') refuse('fixture-env-missing');
if (!profile || !existsSync(profile)) refuse('profile-missing');
if (!realpathSync(profile).startsWith(realpathSync(tmpdir()) + sep + 'weftmate-synthetic-stop-stage11-')) {
  refuse('profile-outside-owned-temp');
}
if (!existsSync(join(profile, 'stage11-browser-fixture.json'))) refuse('marker-missing');
if (!Number.isInteger(fixturePort) || fixturePort < 1 || fixturePort > 65535 ||
    [443, 8443, 8080, 8081, 18186, 18188].includes(fixturePort)) refuse('port-invalid');
const marker = JSON.parse(readFileSync(join(profile, 'stage11-browser-fixture.json'), 'utf8'));
if (marker?.purpose !== 'stage11-owned-browser-fixture') refuse('marker-invalid');
process.stderr.write('[browser-fixture] guard-passed\n');
app.setPath('userData', profile);
// The fixture intentionally opens and destroys many hidden windows in one app.
app.on('window-all-closed', () => {});
app.whenReady().then(() => {
process.stderr.write('[browser-fixture] electron-ready\n');
const reader = createPersonalBrowserReader({ BrowserWindow, session,
  syntheticFixture: { hostnameSuffix: '.weftmate.invalid', allowedPort: fixturePort },
  resolver: async (hostname) => hostname.endsWith('.weftmate.invalid')
    ? [{ address: '127.0.0.1', family: 4 }]
    : [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }],
});
process.send?.({ type: 'ready' });
process.stderr.write(`[browser-fixture] ipc-ready=${typeof process.send === 'function'}\n`);
process.on('message', (frame) => {
  if (frame?.type === 'status') {
    process.send?.({ type: 'status', id: frame.id,
      status: reader.status(), windowCount: BrowserWindow.getAllWindows().length });
    return;
  }
  if (frame?.type === 'probeCleanup') {
    void (async () => {
      let window, proxy;
      const phase = (name) => process.send?.({ type: 'probe-phase', id: frame.id, phase: name });
      try {
        proxy = createPinnedProxy({ syntheticFixture: { hostnameSuffix: '.weftmate.invalid', allowedPort: fixturePort },
          resolver: async () => [{ address: '127.0.0.1', family: 4 }] });
        const { port } = await proxy.start();
        const ses = session.fromPartition(`weftmate-browser-cleanup-probe-${frame.id}`, { cache: false });
        await ses.setProxy({ mode: 'fixed_servers',
          proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
          proxyBypassRules: '<-loopback>' });
        window = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true,
          contextIsolation: true, nodeIntegration: false, webSecurity: true } });
        await window.loadURL(`http://page-a.weftmate.invalid:${fixturePort}/first`);
        phase('rendered');
        if (frame.mode === 'blank') { await window.loadURL('about:blank'); phase('blank'); }
        await ses.closeAllConnections(); phase('connections-closed');
        phase('storage-start'); await ses.clearStorageData(); phase('storage-cleared');
        phase('auth-start'); await ses.clearAuthCache(); phase('auth-cleared');
        process.send?.({ type: 'probe-result', id: frame.id, ok: true });
      } catch (error) { process.send?.({ type: 'probe-result', id: frame.id, ok: false,
        code: error?.code ?? 'PROBE_FAILED' }); }
      finally { if (window && !window.isDestroyed()) window.destroy(); await proxy?.close().catch(() => {}); }
    })();
    return;
  }
  if (frame?.type === 'cancel') { reader.cancelTask(frame.ownerId, frame.taskId); return; }
  if (frame?.type === 'close') {
    reader.close().finally(() => app.quit());
    return;
  }
  if (frame?.type !== 'read' || typeof frame.id !== 'string') return;
  process.send?.({ type: 'started', id: frame.id });
  reader.read({ ownerId: frame.ownerId ?? 'owner-fixture', taskId: frame.taskId ?? 'task-fixture',
    sessionId: 'session-fixture', receiptId: 'receipt-fixture', callId: frame.id,
    url: frame.url }).then((value) => {
    process.send?.({ type: 'result', id: frame.id, ok: true, value });
  }, (error) => {
    process.send?.({ type: 'result', id: frame.id, ok: false, code: error?.code ?? 'BROWSER_UNAVAILABLE' });
  });
});
}).catch(() => refuse('electron-ready-failed'));

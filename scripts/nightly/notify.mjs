import { app, Notification } from 'electron';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const status = JSON.parse(readFileSync(process.argv[2], 'utf8'));
mkdirSync(process.argv[3], { recursive: true });
app.setPath('userData', process.argv[3]);
app.disableHardwareAcceleration();
// Electron waits for the ESM entry module before emitting ready; do not await
// whenReady at module top level (it would prevent the desktop notification).
app.whenReady().then(() => {
  app.setAppUserModelId('com.memoweft.weftmate.nightly');
  const supported = Notification.isSupported();
  if (supported) {
    const notification = new Notification({ title: 'WeftMate 夜间回归报警', body: `${status.alerts.length} 项异常，请查看 nightly-report.md。`, silent: false });
    notification.show();
  }
  writeFileSync(process.argv[4], JSON.stringify({ requestedAt: new Date().toISOString(), supported, alerts: status.alerts.length }) + '\n');
  setTimeout(() => app.exit(0), 1500);
});

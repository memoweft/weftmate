import { app, Notification } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
const status = JSON.parse(await readFile(process.argv[2], 'utf8'));
app.setPath('userData', process.argv[3]);
await app.whenReady();
app.setAppUserModelId('com.memoweft.weftmate.nightly');
const supported = Notification.isSupported();
if (supported) {
  const notification = new Notification({ title: 'WeftMate 夜间回归报警', body: `${status.alerts.length} 项异常，请查看 nightly-report.md。`, silent: false });
  notification.show();
}
await writeFile(process.argv[4], JSON.stringify({ requestedAt: new Date().toISOString(), supported, alerts: status.alerts.length }) + '\n');
setTimeout(() => app.exit(0), 1500);

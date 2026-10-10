// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
// Instrument the real application entry; no replacement window or desktop bridge.
const { app, BrowserWindow, Notification } = require('electron');
app.setAppPath(require('node:path').resolve(__dirname, '../..'));
globalThis.fix6 = { palettes: [], notifications: [] };
const identity = app.setAppUserModelId.bind(app);
app.setAppUserModelId = id => { globalThis.fix6.appId = id; identity(id); };
const overlay = BrowserWindow.prototype.setTitleBarOverlay;
BrowserWindow.prototype.setTitleBarOverlay = function (palette) { globalThis.fix6.palettes.push(palette); return overlay.call(this, palette); };
const show = Notification.prototype.show;
Notification.prototype.show = function () {
  globalThis.fix6.notifications.push({ title: this.title, body: this.body });
  this.on('show', () => { globalThis.fix6.shown = true; });
  this.on('failed', (_event, error) => { globalThis.fix6.notificationError = error; });
  return show.call(this);
};
import('../../src/main.mjs');
import('../../src/personal-desktop.mjs').then(desktop => {
  globalThis.fix6.notify = () => {
    const options = desktop.desktopNotificationOptions({ type: 'turn.ended', data: { reason: 'completed' } });
    globalThis.fix6.iconEmpty = require('electron').nativeImage.createFromPath(options.icon).isEmpty();
    globalThis.fix6.notification = new Notification(options);
    globalThis.fix6.notification.show();
  };
});

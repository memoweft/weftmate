// Only identity and native event observation differ from the production main.
import { app, Notification, Tray } from 'electron';
import packageInfo from '../../package.json' with { type: 'json' };
import { resolve } from 'node:path';

packageInfo.desktopAppId = 'com.memoweft.weftmate.tray-approvals-test';
app.setName('WeftMate Tray Approvals Test');
app.setAppPath(resolve(import.meta.dirname, '../..'));
globalThis.trayApprovalTest = { notifications: [], events: [] };
const show = Notification.prototype.show;
Notification.prototype.show = function () {
  globalThis.trayApprovalTest.notifications.push(this);
  return show.call(this);
};
const setMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) {
  globalThis.trayApprovalTest.tray = this;
  return setMenu.call(this, menu);
};
app.on('weftmate-desktop-notification', event => {
  globalThis.trayApprovalTest.events.push({ ...event,
    notification: globalThis.trayApprovalTest.notifications.at(-1) });
});
await import('../../src/main.mjs');

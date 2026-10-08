const { app, BrowserWindow } = require('electron');
globalThis.iconRendererReady = app.whenReady().then(async () => {
  globalThis.iconRenderer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await globalThis.iconRenderer.loadURL('data:text/html,<html><body></body></html>');
});

// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Minimal isolated Electron entry for the portable interaction suite; FE-1a also launches the real program. */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, realpathSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
app.setPath('userData', realpathSync(mkdtempSync(join(tmpdir(), 'weftmate-desktop-interactions-'))))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 960, useContentSize: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadURL(process.argv.find(value => value.startsWith('http://127.0.0.1:')))
})
// The fixture matches the former suite's explicit window destruction at teardown.
app.on('before-quit', () => app.exit(0))
app.on('window-all-closed', () => app.quit())

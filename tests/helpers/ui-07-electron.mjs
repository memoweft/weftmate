import { app, Notification, dialog, shell, BrowserWindow, session } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
app.setName('WeftMate UI-07 Test');
app.setAppUserModelId('com.memoweft.weftmate.test.ui07');
app.setPath('userData', process.env.UI07_PROFILE);
Notification.isSupported = () => false;
dialog.showOpenDialog = async () => ({canceled:false,filePaths:[process.env.UI07_PICKER_PATH]});
shell.openPath = async value => {globalThis.ui07RevealedPath=value;return '';};
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let quitting = false; app.on('before-quit', () => { quitting = true; });
  // Hidden functional tests also need frames for coalesced presentation work.
  // Native occlusion otherwise suspends rAF even with background throttling off.
  const desktopSession=session.fromPartition('persist:weftmate-desktop');
  const colors=JSON.parse(readFileSync(new URL('../../design/tokens/tokens.json',import.meta.url),'utf8')).surfaces.desktop.themes[0].variables;
  const palette=()=>({color:colors['--canvas'],symbolColor:colors['--ink'],height:44});
  const window=new BrowserWindow({width:1280,height:800,useContentSize:true,show:false,titleBarStyle:'hidden',titleBarOverlay:palette(),backgroundColor:colors['--canvas'],
    webPreferences:{session:desktopSession,preload:join(import.meta.dirname,'../../src/personal-desktop-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,offscreen:true,backgroundThrottling:false}});
  const preparedWindow={window,desktopSession,palette,stateFile:join(process.env.UI07_PROFILE,'desktop-window.json'),saved:{},lifecycle:{stopped:false,maximizeOnShow:false},restoreBounds:Promise.resolve(true),close:async()=>{}};
  preparedWindow.window.webContents.setFrameRate(60);preparedWindow.window.webContents.startPainting();
  preparedWindow.window.webContents.on('paint',()=>{});
  const desktop = createPersonalDesktop({ preparedWindow, startInTray: true, origin: process.env.UI07_ORIGIN,
    libraryDesktopToken: process.env.UI07_TOKEN, isQuitting: () => quitting });
  await desktop.ready; desktop.window.setMinimumSize(320,480); desktop.window.webContents.setBackgroundThrottling(false);
});

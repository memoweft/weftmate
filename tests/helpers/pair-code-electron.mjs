import { app, Notification, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
app.setName('WeftMate Pair Code Test');
app.setAppUserModelId('com.memoweft.weftmate.test.paircode');
app.setPath('userData', process.env.PAIR_CODE_PROFILE);
Notification.isSupported = () => false;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let quitting = false; app.on('before-quit', () => { quitting = true; });
  const desktopSession=session.fromPartition('persist:weftmate-desktop');
  const colors=JSON.parse(readFileSync(new URL('../../design/tokens/tokens.json',import.meta.url),'utf8')).surfaces.desktop.themes[0].variables;
  const palette=()=>({color:colors['--canvas'],symbolColor:colors['--ink'],height:44});
  const window=new BrowserWindow({width:1200,height:900,useContentSize:true,show:false,titleBarStyle:'hidden',titleBarOverlay:palette(),backgroundColor:colors['--canvas'],
    webPreferences:{session:desktopSession,preload:join(import.meta.dirname,'../../src/personal-desktop-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,offscreen:true,backgroundThrottling:false}});
  window.webContents.setFrameRate(60);window.webContents.startPainting();window.webContents.on('paint',()=>{});
  const preparedWindow={window,desktopSession,palette,stateFile:join(process.env.PAIR_CODE_PROFILE,'desktop-window.json'),saved:{},lifecycle:{stopped:false,maximizeOnShow:false},restoreBounds:Promise.resolve(true),close:async()=>{}};
  const desktop = createPersonalDesktop({ preparedWindow, startInTray: true, origin: process.env.PAIR_CODE_ORIGIN,
    libraryDesktopToken: process.env.PAIR_CODE_TOKEN, isQuitting: () => quitting });
  await desktop.ready; desktop.window.webContents.setBackgroundThrottling(false);
});

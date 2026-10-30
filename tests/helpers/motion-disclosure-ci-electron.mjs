// Controlled offscreen cadence; this is not a user-facing smoothness score.
import {app,BrowserWindow,session,Notification} from 'electron';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createPersonalDesktop} from '../../src/personal-desktop.mjs';
app.setName('WeftMate Disclosure CI Test');app.setAppUserModelId('com.memoweft.weftmate.test.disclosure-ci');
app.setPath('userData',process.env.REVIEW_PROFILE);app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor','1');Notification.isSupported=()=>false;
app.whenReady().then(async()=>{
  let quitting=false;app.on('before-quit',()=>{quitting=true;});
  const desktopSession=session.fromPartition('persist:weftmate-desktop');
  const colors=JSON.parse(readFileSync(new URL('../../design/tokens/tokens.json',import.meta.url),'utf8')).surfaces.desktop.themes[0].variables;
  const palette=()=>({color:colors['--canvas'],symbolColor:colors['--ink'],height:44});
  const window=new BrowserWindow({width:1280,height:800,useContentSize:true,show:false,titleBarStyle:'hidden',titleBarOverlay:palette(),backgroundColor:colors['--canvas'],
    webPreferences:{session:desktopSession,preload:join(import.meta.dirname,'../../src/personal-desktop-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
  window.webContents.setFrameRate(60);window.webContents.startPainting();window.webContents.on('paint',()=>{});
  await createPersonalDesktop({preparedWindow:{window,desktopSession,palette,stateFile:join(process.env.REVIEW_PROFILE,'window.json'),saved:{},lifecycle:{stopped:false,maximizeOnShow:false},restoreBounds:Promise.resolve(true),close:async()=>{}},startInTray:true,origin:process.env.REVIEW_ORIGIN,libraryDesktopToken:process.env.REVIEW_LIBRARY_TOKEN,isQuitting:()=>quitting}).ready;
});

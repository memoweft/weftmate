import {app,nativeTheme,Notification} from 'electron';
import {createPersonalDesktop} from '../../src/personal-desktop.mjs';
app.setPath('userData',process.env.UX3_PROFILE);
app.disableHardwareAcceleration();Notification.isSupported=()=>false;
app.whenReady().then(async()=>{
 nativeTheme.themeSource=process.env.UX3_THEME;
 let quitting=false;app.on('before-quit',()=>{quitting=true;});
 const desktop=createPersonalDesktop({origin:process.env.UX3_ORIGIN,libraryDesktopToken:process.env.UX3_LIBRARY_TOKEN,startInTray:true,isQuitting:()=>quitting});
 await desktop.ready;desktop.window.setContentSize(1200,800);desktop.window.webContents.setBackgroundThrottling(false);
 globalThis.ux3Desktop=desktop;
});

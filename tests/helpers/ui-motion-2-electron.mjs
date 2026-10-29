import {app,nativeTheme,Notification} from 'electron';
import {createPersonalDesktop} from '../../src/personal-desktop.mjs';

app.setName('WeftMate UI-MOTION-2 Test');
app.setAppUserModelId('com.memoweft.weftmate.test.ui-motion-2');
app.setPath('userData',process.env.REVIEW_PROFILE);
Notification.isSupported=()=>false;
app.whenReady().then(async()=>{
  nativeTheme.themeSource='light';let quitting=false;app.on('before-quit',()=>{quitting=true;});
  const desktop=createPersonalDesktop({origin:process.env.REVIEW_ORIGIN,libraryDesktopToken:process.env.REVIEW_LIBRARY_TOKEN,isQuitting:()=>quitting});
  await desktop.ready;desktop.window.setContentSize(1280,800);desktop.window.webContents.setBackgroundThrottling(false);
});

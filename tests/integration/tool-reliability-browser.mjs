import {app,BrowserWindow,session} from 'electron';
import {createPersonalBrowserReader} from '../../src/personal-browser/index.mjs';
app.setPath('userData',process.env.WEFTMATE_TOOL_BROWSER_PROFILE);
app.setAppUserModelId('com.memoweft.weftmate.tool-reliability-test');
app.whenReady().then(()=>{
 globalThis.toolReader=createPersonalBrowserReader({BrowserWindow,session,
  resolver:async()=>[{address:'127.0.0.1',family:4}],
  syntheticFixture:{hostnameSuffix:'.tool-reliability.invalid',allowedPort:Number(process.env.WEFTMATE_TOOL_BROWSER_PORT)}});
 const anchor=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
 void anchor.loadURL('about:blank');
});
app.on('window-all-closed',()=>{});

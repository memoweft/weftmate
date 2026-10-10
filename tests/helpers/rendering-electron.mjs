import {app,BrowserWindow} from 'electron';
import {fileURLToPath} from 'node:url';
app.setPath('userData',process.env.UX5_PROFILE);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1000,height:800,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadFile(fileURLToPath(new URL('./rendering.html',import.meta.url)));
});

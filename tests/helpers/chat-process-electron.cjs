const {app,BrowserWindow}=require('electron');
app.setName('WeftMate UI02 Test');
app.setAppUserModelId('com.memoweft.weftmate.test.ui02');
app.setPath('userData',process.env.UI02_PROFILE);
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:1280,height:800,useContentSize:true,show:false,
    webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  window.webContents.setFrameRate(60);
  await window.loadURL(process.argv.find(value=>value.startsWith('http://127.0.0.1:')));
});
app.on('window-all-closed',()=>app.quit());

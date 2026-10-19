const {app,BrowserWindow}=require('electron');
app.setPath('userData',process.env.PROGRESS_RENDERER_PROFILE);
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{backgroundThrottling:false}});
  await window.loadURL('about:blank');
});

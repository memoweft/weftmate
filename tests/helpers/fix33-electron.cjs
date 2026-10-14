const {app,BrowserWindow}=require('electron');
app.whenReady().then(()=>{const window=new BrowserWindow({width:1000,height:850,show:true,focusable:false,webPreferences:{contextIsolation:true}});window.loadURL('about:blank');});
app.on('window-all-closed',()=>app.quit());

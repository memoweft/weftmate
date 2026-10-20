// Execute in Electron's main process before driving or judging its real UI.
export function presentAcceptanceWindow({BrowserWindow}){
 const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/personal/v1/ui'));
 if(!window)throw Error('Installed application window unavailable');
 if(window.isMinimized())window.restore();
 window.show();window.focus();
}

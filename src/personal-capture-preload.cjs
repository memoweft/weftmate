const { contextBridge, ipcRenderer } = require('electron');
let channel;
contextBridge.exposeInMainWorld('weftmateCapture', {
  ready: callback => ipcRenderer.once('wm:capture:ready', (_event, value) => { channel = value.channel; callback(value.dataUrl); }),
  select: rectangle => channel && ipcRenderer.invoke(channel, rectangle),
});

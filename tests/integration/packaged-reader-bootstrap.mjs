import {app,BrowserWindow} from 'electron';
import {pathToFileURL} from 'node:url';
globalThis.packagedReader = async ({module,project}) => {
  const reader=await import(pathToFileURL(module).href);
  const root=await reader.inspectProjectRoot(project),{files}=await reader.listProjectFiles(root);
  return (await reader.readProjectFile(root,files.find(f=>f.relativePath==='brief.md'))).text;
};
app.whenReady().then(async()=>{const window=new BrowserWindow({show:false});await window.loadURL('about:blank');});

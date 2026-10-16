import {app,Tray,session,BrowserWindow} from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {recordProcessDuringStartup} from './exit-supervisor.mjs';
// Playwright launches a quoted shell command on Windows; its immediate child
// PID belongs to cmd.exe. Register the actual Electron PID at entry instead.
if(process.env.BL29_OWNED_ROOT){
 const profile=process.argv.find(arg=>arg.startsWith('--user-data-dir='))?.slice(16);
 if(!profile)throw Error('Owned profile missing');
 globalThis.revProcessRegistration=recordProcessDuringStartup(process.env.BL29_OWNED_ROOT,process.pid,profile);
 fs.appendFileSync(join(process.env.BL29_OWNED_ROOT,'stages.jsonl'),JSON.stringify({at:new Date().toISOString(),stage:'launch',method:process.env.BL29_EXIT_METHOD,pid:process.pid,rss:process.memoryUsage().rss})+'\n');
}
app.getAppPath=()=>process.cwd();
const original=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.revTray=menu;return original.call(this,menu);};
let nativeHeaders;
app.once('ready',()=>{
 const requests=session.fromPartition('persist:weftmate-desktop').webRequest;
 const register=requests.onBeforeSendHeaders;
 requests.onBeforeSendHeaders=function(filter,listener){nativeHeaders=listener;return register.call(this,filter,listener);};
});
globalThis.revQueueTeardownRequest=()=>{
 const window=BrowserWindow.getAllWindows()[0],frame=window.webContents.mainFrame,origin=new URL(frame.url).origin;
 const details={webContentsId:window.webContents.id,frame,initiatorOrigin:origin,url:origin+'/personal/v1/auth/me',requestHeaders:{}};
 const exit=app.exit.bind(app);
 app.exit=code=>{
  // Deliver a previously queued session request after the real window has
  // been destroyed, reproducing the ordering seen in the failed vendor job.
  window.destroy();
  const result={destroyed:window.isDestroyed(),callbackCompleted:false,desktopCapability:false};
  try {nativeHeaders(details,response=>{result.callbackCompleted=true;result.desktopCapability=!!response.requestHeaders['X-WeftMate-Desktop'];});}
  catch(error){result.error=error.message;}
  fs.writeFileSync(join(process.env.BL29_EXIT_CASE_ROOT,'teardown-request.json'),JSON.stringify(result));
  exit(code);
 };
};
const baseline=process.env.REV_BASELINE==='1'?JSON.parse(fs.readFileSync(resolve(process.env.BL29_BASELINE_FILE),'utf8')):{};
const key=p=>{try{return (p instanceof URL?fileURLToPath(p):String(p)).replaceAll('\\','/').replace(process.cwd().replaceAll('\\','/')+'/','');}catch{return '';}};
const readSync=fs.readFileSync,readAsync=fsp.readFile;
const projectRead=(p,opt,value)=>{
 const path=key(p),s=baseline[path];let result=s===undefined?value:typeof opt==='string'||opt?.encoding?s:Buffer.from(s);
 if(path==='src/personal-access-ui/app.js'&&process.env.REV_BASELINE!=='1'){
  const text=String(result).replace('ui.loadAttachmentHasher =','globalThis.__revExitCore=core;ui.loadAttachmentHasher =');
  result=typeof result==='string'?text:Buffer.from(text);
 }return result;
};
fs.readFileSync=function(p,opt){const s=baseline[key(p)];return projectRead(p,opt,s===undefined?readSync.call(this,p,opt):s);};
fsp.readFile=async function(p,opt){const s=baseline[key(p)];return projectRead(p,opt,s===undefined?await readAsync.call(this,p,opt):s);};syncBuiltinESMExports();
registerHooks({load(url,context,nextLoad){const k=key(url.startsWith('file:')?new URL(url):url);let source=baseline[k];
 if(k==='src/main.mjs'){source??=readSync(new URL(url),'utf8');source+='\nglobalThis.revRuntimeOrigin=()=>runtimeOrigin;globalThis.revRuntimeClose=()=>webRuntime.close();globalThis.revAccessClose=()=>personalAccessService.close();\n';}
 if(k==='src/update.ts'){source??=readSync(new URL(url),'utf8');source+='\nexport function __revPrepareUpdate(){state.enabled=true;state.status="downloaded";autoUpdater={} as any;}\n';}
 if(source!==undefined)return {format:k.endsWith('.ts')?'module-typescript':'module',source,shortCircuit:true};return nextLoad(url,context);}});
globalThis.revUpdate=async()=>{const m=await import(pathToFileURL(resolve('src/update.ts')).href);m.__revPrepareUpdate();return m.quitAndInstall();};
await import(pathToFileURL(resolve('src/main.mjs')).href);

import {app,Tray} from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
app.getAppPath=()=>process.cwd();
const original=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.revTray=menu;return original.call(this,menu);};
const baseline=process.env.REV_BASELINE==='1'?JSON.parse(fs.readFileSync(resolve(process.env.BL29_BASELINE_FILE),'utf8')):{};
const key=p=>{try{return (p instanceof URL?fileURLToPath(p):String(p)).replaceAll('\\','/').replace(process.cwd().replaceAll('\\','/')+'/','');}catch{return '';}};
const readSync=fs.readFileSync,readAsync=fsp.readFile;
fs.readFileSync=function(p,opt){const s=baseline[key(p)];return s===undefined?readSync.call(this,p,opt):typeof opt==='string'||opt?.encoding?s:Buffer.from(s);};
fsp.readFile=async function(p,opt){const s=baseline[key(p)];return s===undefined?readAsync.call(this,p,opt):typeof opt==='string'||opt?.encoding?s:Buffer.from(s);};syncBuiltinESMExports();
registerHooks({load(url,context,nextLoad){const k=key(url.startsWith('file:')?new URL(url):url);let source=baseline[k];
 if(k==='src/main.mjs'){source??=readSync(new URL(url),'utf8');source+='\nglobalThis.revRuntimeOrigin=()=>runtimeOrigin;globalThis.revRuntimeClose=()=>webRuntime.close();globalThis.revAccessClose=()=>personalAccessService.close();\n';}
 if(k==='src/update.ts'){source??=readSync(new URL(url),'utf8');source+='\nexport function __revPrepareUpdate(){state.enabled=true;state.status="downloaded";autoUpdater={} as any;}\n';}
 if(source!==undefined)return {format:k.endsWith('.ts')?'module-typescript':'module',source,shortCircuit:true};return nextLoad(url,context);}});
globalThis.revUpdate=async()=>{const m=await import(pathToFileURL(resolve('src/update.ts')).href);m.__revPrepareUpdate();return m.quitAndInstall();};
await import(pathToFileURL(resolve('src/main.mjs')).href);

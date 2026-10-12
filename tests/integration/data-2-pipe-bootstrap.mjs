import '../../src/process-output.mjs';
import {app,dialog} from 'electron';
import {existsSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const profile=process.argv.find(arg=>arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
for(const key of ['appData','sessionData']){const dir=join(profile,key);mkdirSync(dir,{recursive:true});app.setPath(key,dir);}
const directory=join(profile,'pipe-test');
const streamErrors=[];
for(const [name,stream]of [['stdout',process.stdout],['stderr',process.stderr]])stream.on('error',error=>streamErrors.push({stream:name,code:error.code}));
let parentAlive=true;
while(parentAlive){try{process.kill(Number(process.env.DATA2_PARENT_PID),0);await new Promise(r=>setTimeout(r,10));}catch{parentAlive=false;}}
const electronHandlers=process.listeners('uncaughtException');
// Inspect the bootstrap handler without ever opening a baseline native dialog.
const original=dialog.showErrorBox;let baselineCalls=0;
let observed;const invocation=new Promise(resolve=>{observed=resolve;});
dialog.showErrorBox=()=>{baselineCalls++;observed();};
electronHandlers[0]?.(Object.assign(new Error('EPIPE: broken pipe, write'),{code:'EPIPE'}));
await invocation;
dialog.showErrorBox=original;
writeFileSync(join(directory,'baseline.json'),JSON.stringify({process:'Electron GUI main',registeredApplicationHandler:false,electronHandlerCount:electronHandlers.length,defaultErrorBoxCalls:baselineCalls,handlerSource:electronHandlers[0]?.toString()}));
// EPIPE used to happen here, before main reaches its own uncaughtException handler.
process.emitWarning('PRIVATE PATH MUST NOT APPEAR',{type:'Data2Warning',code:'DATA2_PIPE'});
for(let n=0;n<3;n++)console.error('synthetic broken console '+n);
app.on('browser-window-created',(_event,window)=>{window.setBounds({x:-20000,y:-20000,width:800,height:600});window.setFocusable(false);});
await import('./m2-exit-bootstrap.mjs');
let responded=false;
const timer=setInterval(()=>{
  if(!responded&&existsSync(join(directory,'request.json'))){
    responded=true;
    for(let n=0;n<3;n++)console.error('synthetic later console '+n);
    writeFileSync(join(directory,'alive.json'),JSON.stringify({alive:true,parentExited:true,streamErrors,applicationUncaughtHandlers:process.listenerCount('uncaughtException')}));
  }
  if(existsSync(join(directory,'stop'))){clearInterval(timer);app.quit();}
},250);

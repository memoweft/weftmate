import '../../src/process-output.mjs';
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createComputerUsageSampler } from '../../src/computer-usage-sampler.mjs';
import { EventEmitter } from 'node:events';
const profile=process.argv.find(arg=>arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
for(const key of ['appData','sessionData']){const dir=join(profile,key);mkdirSync(dir,{recursive:true});app.setPath(key,dir);}
app.on('browser-window-created', (_event, window) => {
  window.setBounds({x:-20000,y:-20000,width:1200,height:1000});window.setFocusable(false);window.webContents.setBackgroundThrottling(false);
});
registerHooks({load(url,context,next){
  if(url.endsWith('/src/personal-access/index.mjs'))return {format:'module',shortCircuit:true,source:readFileSync(new URL(url),'utf8').replace('clock = Date.now','clock = () => globalThis.data2HostNow ?? Date.now()').replace('  return service;', '  globalThis.health2={service,context}; return service;')};
  if(!url.endsWith('/src/personal-desktop.mjs'))return next(url,context);
  return {format:'module',shortCircuit:true,source:readFileSync(new URL(url),'utf8').replace('  const computerUsage = process.platform', '  const computerUsage = globalThis.data2LiveSampler = process.platform')};
}});
globalThis.data2CreateSampler=createComputerUsageSampler;
globalThis.data2StartSynthetic = owner => {
  const power = new EventEmitter();power.getSystemIdleTime=()=>globalThis.data2Idle??0;
  globalThis.data2Synthetic=createComputerUsageSampler({powerMonitor:power,owner:()=>owner,
    policy:owner=>globalThis.health2.service.computerUsagePolicy(owner),persist:(...args)=>globalThis.health2.service.recordComputerUsage(...args),
    now:()=>globalThis.data2Time,setTimer:()=>({unref(){}}),clearTimer:()=>{}});
};
await import('./m2-exit-bootstrap.mjs');

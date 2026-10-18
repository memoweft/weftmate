import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runManagedTestProcess } from './helpers/managed-test-process.mjs';
import { protectProcessOutput } from '../src/process-output.mjs';
test('broken console streams swallow EPIPE, ERR_STREAM_DESTROYED, EOF and synchronous write failures',()=>{
  const target:any=new EventEmitter();target.stdout=new EventEmitter();target.stderr=new EventEmitter();target.stdout.write=()=>{throw Object.assign(new Error('broken'),{code:'EPIPE'});};target.stderr.write=()=>false;
  protectProcessOutput(target);assert.equal(target.stdout.write('ignored'),false);
  for(const code of ['EPIPE','ERR_STREAM_DESTROYED','EOF'])for(const stream of [target.stdout,target.stderr])assert.doesNotThrow(()=>stream.emit('error',{code}));
});
test('Node warning console listener is replaced and warning logs contain only canonical name and code',()=>{
  const target:any=new EventEmitter();target.stdout=target.stderr=null;let consoleCalls=0;
  target.on('warning',function onWarning(){consoleCalls++;});const log:any[]=[];const sink=protectProcessOutput(target);
  target.emit('warning',{name:'DeprecationWarning',code:'DEP_TEST',message:'private path',stack:'private stack'});sink((event:any,data:any)=>log.push({event,data}));
  assert.equal(consoleCalls,0);assert.deepEqual(log,[{event:'process.warning',data:{name:'DeprecationWarning',code:'DEP_TEST'}}]);
  target.emit('warning',{name:'C:\\private',code:'C:\\private'});assert.deepEqual(log.at(-1).data,{name:'unknown',code:'unknown'});
});
// Inject a fault at dependency evaluation, not at a chosen source line. The
// sentinel stops the entry before it can start services or alter app data.
const applicationImportProbe = (entry: string, resultFile: string) => `
  const { registerHooks } = require('node:module');
  const { writeFileSync } = require('node:fs');
  const entry=${JSON.stringify(entry)}, applicationRoot=new URL('.',entry).href, protector=new URL('./process-output.mjs',entry).href;
  registerHooks({ load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith(applicationRoot) || url===entry || url===protector || result.format!=='module') return result;
    return { ...result, source: \`\n
      process.stdout.emit('error', Object.assign(Error('synthetic broken output'), {code:'EPIPE'}));
      process.stderr.emit('error', Object.assign(Error('synthetic broken output'), {code:'EPIPE'}));
      throw Object.assign(Error('application dependency reached'), {code:'APPLICATION_IMPORT_REACHED'});
    \` + String(result.source) };
  }});
  import(${JSON.stringify(entry)}).then(() => { throw Error('entry unexpectedly completed'); }).catch(error => {
    writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({code:error.code ?? 'unexpected'}));
    if (typeof process.versions.electron === 'string' && !process.env.ELECTRON_RUN_AS_NODE) require('electron').app.exit(0);
    else process.exitCode = 0;
  });
`;

test('main installs output protection before evaluating its first application dependency', {timeout:30000}, async()=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-main-output-'));
  const binary=createRequire(import.meta.url)('electron'), resultFile=join(root,'result.json'),driver=join(root,'probe.cjs');
  const profile=join(root,'profile');mkdirSync(profile);
  const setup=`const {app,dialog}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});dialog.showErrorBox=()=>{throw Error('unexpected native dialog');};\n`;
  writeFileSync(driver,setup+applicationImportProbe(new URL('../src/main.mjs',import.meta.url).href,resultFile));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  try{
    const result=await runManagedTestProcess(binary,[driver,'--no-sandbox','--headless','--noerrdialogs'],{env,commandRoots:[root],timeoutMs:20000});
    assert.equal(result.status,0);assert.equal(result.timedOut,false);
    assert.deepEqual(JSON.parse(readFileSync(resultFile,'utf8')),{code:'APPLICATION_IMPORT_REACHED'});
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('production rollback copies an independently runnable monitor with protection before application dependencies', {timeout:30000}, async()=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-monitor-output-'));
  const driver=join(root,'prepare.cjs'),resultFile=join(root,'prepared.json');
  // Only platform/OS services and the monitor spawn are substitutes. The
  // production rollback function and physical copy operations really run.
  writeFileSync(driver,`
    const {registerHooks,syncBuiltinESMExports}=require('node:module');
    const fs=require('node:fs'),{join}=require('node:path'),cp=require('node:child_process');
    process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});
    const root=${JSON.stringify(root)},program=join(root,'installation');fs.mkdirSync(program);
    const exe=join(program,'synthetic.exe');fs.writeFileSync(exe,'synthetic executable');
    Object.defineProperty(process,'platform',{value:'win32'});Object.defineProperty(process,'execPath',{value:exe});
    globalThis.rollbackApp={isPackaged:true,getPath:()=>join(root,'data'),getVersion:()=> '1.0.0'};
    registerHooks({resolve(specifier,context,nextResolve){
      if(specifier==='original-fs')return {url:'node:fs',shortCircuit:true};
      if(specifier==='electron')return {url:'fixture:electron',shortCircuit:true};
      const result=nextResolve(specifier,context);
      if(result.url===${JSON.stringify(new URL('../src/desktop-installation.mjs',import.meta.url).href)})return {url:'fixture:scope',shortCircuit:true};
      if(result.url===${JSON.stringify(new URL('../src/personal-update/watchdog-commands.mjs',import.meta.url).href)})return {url:'fixture:commands',shortCircuit:true};
      return result;
    },load(url,context,nextLoad){
      const sources={'fixture:electron':'export const app=globalThis.rollbackApp;',
        'fixture:scope':"export const installationScope=()=> 'CurrentUser';",
        'fixture:commands':'export const readUninstallRegistry=async()=>({});export const recoveryEnvironment=()=>({});'};
      return sources[url] ? {format:'module',source:sources[url],shortCircuit:true}:nextLoad(url,context);
    }});
    cp.spawn=(executable,args)=>{
      const child=new (require('node:events').EventEmitter)();child.unref=()=>{};
      const pending=JSON.parse(fs.readFileSync(join(args[1],'pending.json'),'utf8'));
      fs.writeFileSync(join(args[1],'monitor-ready.json'),JSON.stringify({token:pending.token}));
      queueMicrotask(()=>child.emit('spawn'));return child;
    };syncBuiltinESMExports();
    import(${JSON.stringify(new URL('../src/personal-update/app-rollback.mjs',import.meta.url).href)}).then(async({prepareAppRollback})=>{
      await prepareAppRollback({appData:join(root,'appdata'),configFile:join(root,'config.json'),nextVersion:'2.0.0',installer:join(root,'synthetic-installer.exe')});
      const pending=JSON.parse(fs.readFileSync(join(root,'appdata','WeftMate','app-recovery','pending.json'),'utf8'));
      fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({snapshot:pending.snapshot}));
    }).catch(()=>{process.exitCode=1;});
  `);
  try{
    const prepared=await runManagedTestProcess(process.execPath,[driver],{env:process.env,commandRoots:[root],timeoutMs:10000});
    assert.equal(prepared.status,0);
    const {snapshot}=JSON.parse(readFileSync(resultFile,'utf8'));
    const probe=join(root,'probe.cjs'),observed=join(root,'observed.json');
    const {pathToFileURL}=await import('node:url');
    writeFileSync(probe,applicationImportProbe(pathToFileURL(join(snapshot,'monitor.mjs')).href,observed));
    const monitorBinary=createRequire(import.meta.url)('electron');
    const result=await runManagedTestProcess(monitorBinary,[probe,root],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},commandRoots:[root],timeoutMs:10000});
    assert.equal(result.status,0);assert.equal(result.timedOut,false);
    assert.deepEqual(JSON.parse(readFileSync(observed,'utf8')),{code:'APPLICATION_IMPORT_REACHED'});
  }finally{rmSync(root,{recursive:true,force:true});}
});

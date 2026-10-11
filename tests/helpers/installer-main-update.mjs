/** Only the explicitly allocated debugger of the synthetic custom installation. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import WebSocket from 'ws';
const [port,installer,config]=process.argv.slice(2);assert.match(port,/^\d+$/);
const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const target=targets.find(r=>r.type==='node');assert.ok(target);
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.once('open',ok);socket.once('error',no)});
const args={installer:resolve(installer),configFile:resolve(config),installerSha256:createHash('sha256').update(readFileSync(installer)).digest('hex'),nextVersion:'0.1.2-preview.22'};
const expression=`(async()=>{const require=process.getBuiltinModule('module').createRequire(process.execPath);const {app}=require('electron');const {join}=require('node:path');const query=require(join(app.getAppPath(),'src/personal-update/watchdog-commands.mjs'));const before=await query.relevantProcesses([process.execPath,${JSON.stringify(args.installer)}]).then(rows=>({rows:rows.map(row=>({pid:row.ProcessId}))})).catch(error=>({code:error.code}));const {prepareAppRollback}=require(join(app.getAppPath(),'src/personal-update/app-rollback.mjs'));await prepareAppRollback({...${JSON.stringify(args)},appData:join(app.getPath('appData'),'WeftMate inst1qa')});await new Promise(resolve=>setTimeout(resolve,2000));const remaining=await query.relevantProcesses([process.execPath,${JSON.stringify(args.installer)}]).then(rows=>({rows:rows.map(row=>({pid:row.ProcessId}))})).catch(error=>({code:error.code}));setTimeout(()=>app.quit(),250);return {prepared:true,before,remaining,metrics:app.getAppMetrics().map(item=>({pid:item.pid,type:item.type})),executable:process.execPath}})()`;
try{const result=await new Promise((ok,no)=>{socket.on('message',raw=>{const r=JSON.parse(raw);if(r.id===1){if(r.error)no(Error(r.error.message));else ok(r.result)}});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});assert.equal(result.exceptionDetails,undefined);assert.equal(result.result?.value?.prepared,true);console.log(JSON.stringify(result.result.value));console.log('Real custom-location rollback monitor prepared and normal app quit requested.');}finally{socket.close();}

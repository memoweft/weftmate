import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import WebSocket from 'ws';
const [port,installer,configFile,control]=process.argv.slice(2);assert.match(port,/^\d+$/);
const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const target=targets.find(row=>row.type==='node');assert.ok(target);
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.once('open',ok);socket.once('error',no)});
const options={installer:resolve(installer),configFile:resolve(configFile),appData:resolve(control),installerSha256:createHash('sha256').update(readFileSync(installer)).digest('hex'),nextVersion:'0.2.1-preview.2'};
const expression=`(async()=>{const require=process.getBuiltinModule('module').createRequire(process.execPath);const {app}=require('electron');const {join}=require('node:path');const {prepareAppRollback}=require(join(app.getAppPath(),'src/personal-update/app-rollback.mjs'));await prepareAppRollback(${JSON.stringify(options)});setTimeout(()=>app.quit(),250);return {prepared:true,currentVersion:app.getVersion()}})()`;
try{const result=await new Promise((ok,no)=>{socket.on('message',raw=>{const row=JSON.parse(raw);if(row.id===1){if(row.error)no(Error(row.error.message));else ok(row.result)}});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));assert.equal(result.result?.value?.prepared,true);console.log(JSON.stringify(result.result.value));}finally{socket.close()}


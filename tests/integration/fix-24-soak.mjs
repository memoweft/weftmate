import { evidencePath } from '../helpers/evidence-path.mjs';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHostRelay} from '../../src/personal-relay/index.mjs';
import {createBackgroundRouteRecorder} from '../../src/background-model-selection.mjs';
import {createHostDiagnostics} from '../../src/host-diagnostics.mjs';
const out=evidencePath('fix-24');await mkdir(out,{recursive:true});
const original=execFileSync('git',['show','5e1766ca700e90217f16a5142f81cdfed1b68595:src/personal-relay/index.mjs'],{encoding:'utf8',windowsHide:true});
const source=original.replace(/from '([^']+)'/g,(m,p)=>p.startsWith('.')?`from '${new URL(p,pathToFileURL(resolve('src/personal-relay/index.mjs'))).href}'`:m);
const {createHostRelay:beforeFactory}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const root=await mkdtemp(join(tmpdir(),'weftmate-fix24-soak-')),runs=[];
for(const [name,factory]of [['before',beforeFactory],['after',createHostRelay]]){
 const log=createHostDiagnostics(join(root,name));log.begin({mode:'synthetic'});let attempts=0;
 const relay=await factory({root:join(root,name),identity:{relayReady:()=>false,relayRequest:async()=>{attempts++;throw Object.assign(Error('CLOUD_NOT_BOUND'),{code:'CLOUD_NOT_BOUND'})}},options:{binary:'synthetic-frpc',transportCaFile:'synthetic-ca',developmentTls:true,diagnostic:e=>log.write('host.failure',{source:'relay-command',code:e.code})},setPublicOrigin:()=>{},executeCommand:async()=>({stdout:'0.71.0'})});
 relay.start('http://127.0.0.1');
 const route=name==='after'?createBackgroundRouteRecorder((event,data)=>log.write(event,data)):null;
 const tick=()=>{if(route)route.record('synthetic-owner',{profileId:'synthetic-chat',configured:true});else log.write('background.route',{profileId:'synthetic-chat',sessionId:'synthetic-session',configured:true});};
 tick();const timer=setInterval(tick,450);runs.push({name,log,relay,route,timer,attempts:()=>attempts});
}
const started=Date.now();console.log('FIX-24 before/after synthetic 10-minute soak started');
try{await new Promise(done=>setTimeout(done,600000));const report={durationMs:Date.now()-started,realModelRequests:0,runs:[]};for(const r of runs){clearInterval(r.timer);await r.relay.close();r.route?.close();const records=r.log.records();report.runs.push({name:r.name,relayCredentialRequests:r.attempts(),relayErrors:records.filter(row=>row.source==='relay-command').length,backgroundRouteEvents:records.filter(row=>row.event==='background.route').length});await writeFile(join(out,`soak-${r.name}.jsonl`),records.filter(row=>row.event==='background.route'||row.source==='relay-command').map(JSON.stringify).join('\n')+'\n');}await writeFile(join(out,'soak.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}finally{for(const r of runs){clearInterval(r.timer);await r.relay.close();r.route?.close();}await rm(root,{recursive:true,force:true});}

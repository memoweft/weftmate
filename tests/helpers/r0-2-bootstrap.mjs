/** Launch production Electron shell around component adapters owned by this fixture. */
import { app, dialog } from 'electron';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSystemStatusManager } from '../../src/system-status-runtime.mjs';
import { createHostDiagnostics } from '../../src/host-diagnostics.mjs';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
import { certificateInfo } from '../../src/personal-relay/certificates.mjs';
import { tlsSpki } from '../../src/personal-relay/tls.mjs';
import { startR02Fixture } from './r0-2-fixture.mjs';
import { syntheticCertificate } from './r0-2-certificates.mjs';

const root = process.env.R02_PROFILE;
if (!root) throw Error('Synthetic profile required');
app.setPath('userData',root); app.getLoginItemSettings = () => ({openAtLogin:false});
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const pause = ms => new Promise(done=>setTimeout(done,ms));

void app.whenReady().then(async()=>{
const services = Object.fromEntries(['host','memory','model','relay'].map(id=>[id,{server:null,origin:null}]));
async function start(id) {
  const item=services[id]; if (item.server) return;
  item.server=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ready:true}));});
  await new Promise(done=>item.server.listen(0,'127.0.0.1',done));
  item.origin=`http://127.0.0.1:${item.server.address().port}`;
}
async function stop(id) {const item=services[id];if(!item.server)return;await new Promise(done=>item.server.close(done));item.server=null;}
async function reachable(id) {try {return (await fetch(services[id].origin+'/health',{signal:AbortSignal.timeout(500)})).ok;}catch{return false;}}
for(const id of Object.keys(services)) await start(id);
const validCertificate=syntheticCertificate(false),expiredCertificate=syntheticCertificate(true),certificateFile=join(root,'synthetic-certificate.pem');
writeFileSync(certificateFile,validCertificate);
const prior=createHostDiagnostics(root,{version:'0.1.0'});prior.begin({mode:'personal-host'});
const diagnostics=createHostDiagnostics(root,{version:'0.1.0'});diagnostics.begin({mode:'personal-host'});
const sensitiveMarkers=['R02_SENSITIVE_DIALOGUE_MUST_NOT_EXPORT','R02_SENSITIVE_MEMORY_MUST_NOT_EXPORT','R02_SENSITIVE_KEY_MUST_NOT_EXPORT','R02_SENSITIVE_TOKEN_MUST_NOT_EXPORT'];
writeFileSync(join(root,'synthetic-private-data.json'),JSON.stringify({dialogue:sensitiveMarkers[0],memory:sensitiveMarkers[1],apiKey:sensitiveMarkers[2],accessToken:sensitiveMarkers[3]}));
diagnostics.write('host.event',{body:sensitiveMarkers[0],memory:sensitiveMarkers[1],apiKey:sensitiveMarkers[2],token:sensitiveMarkers[3]});
diagnostics.failure('uncaughtException',new Error(sensitiveMarkers.join(' ')));
const repairs=Object.fromEntries(['host','memory','model','relay','certificate'].map(id=>[id,0]));
let semantic={state:'ready'},autoMemory=false,modelRequests=0;
const recover = async id => {repairs[id]++;await pause(550);if(id==='model'){if(!await reachable(id))throw Error('Synthetic model address remains unreachable');}else if(id==='certificate')writeFileSync(certificateFile,validCertificate);else {await start(id);if(id==='memory')semantic={state:'ready'};}};
const manager=createSystemStatusManager({
  readHost:async()=>({state:await reachable('host')?'ready':'unavailable',version:'0.1.0'}),
  readMemory:async()=>{if(autoMemory&&!await reachable('memory')){await start('memory');diagnostics.write('component.recovery',{phase:'memory',status:'completed',action:'retry'});}return {state:await reachable('memory')?'ready':'unavailable',version:'0.1.0',runtime:{semantic_recall:semantic}};},
  readModel:async()=>({configured:true,state:await reachable('model')?'ready':'unavailable'}),
  readRelay:async()=>({state:await reachable('relay')?'online':'offline',...certificateInfo(readFileSync(certificateFile),{domain:'r0-2.invalid',spki:tlsSpki(readFileSync(certificateFile))})}),
  repairs:Object.fromEntries(Object.keys(repairs).map(id=>[id,()=>recover(id)])),diagnostics,
  metrics:()=>({startupMs:1200,firstTokenMs:[800,1100,900],rssBytes:120*1024**2}),versions:()=>({appVersion:'0.1.0',runtimeVersion:'0.1.0',platform:process.platform==='win32'?'windows':'linux'}),
});
const fixture=await startR02Fixture({root,systemManager:manager});
dialog.showSaveDialog=async()=>({canceled:false,filePath:join(root,'diagnostics.zip')});
let quitting=false;app.on('before-quit',()=>quitting=true);
const desktop=createPersonalDesktop({origin:fixture.origin,systemManager:manager,isQuitting:()=>quitting});await desktop.ready;
globalThis.r02={fixture,manager,repairs,diagnostics,desktop,root,sensitiveMarkers,
  async fault(id){if(id==='certificate')writeFileSync(certificateFile,expiredCertificate);else await stop(id);if(id==='memory')semantic={state:'unavailable',reason:'bridge-disconnected'};},
  async restore(id){if(id==='certificate')writeFileSync(certificateFile,validCertificate);else await start(id);if(id==='memory')semantic={state:'ready'};},
  async autoMemory(){autoMemory=true;await stop('memory');await manager.status();autoMemory=false;},
  semantic(value){semantic=value;},
  async close(){await fixture.close();for(const id of Object.keys(services))await stop(id);diagnostics.exit('user-quit');},
  get modelRequests(){return modelRequests;},
};
});

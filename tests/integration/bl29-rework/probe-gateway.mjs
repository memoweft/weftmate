import { outputPath } from './evidence.mjs';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeTimelineLog} from '../../../src/runtime/dsh-adapter/timeline.mjs';
import {createGatewayV1} from '../../../src/runtime/gateway/routes/v1.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),report=[];
for(const mode of ['gateway-close','cordis-dispose','uncached-dispose']){
 const root=mkdtempSync(join(tmpdir(),'rev-bl29-gateway-')),effects=[];
 const session={id:'s',header:{agentPreset:'personal-remote'},events:[]};
 const read=nativeTimelineLog({on(){},get:key=>key==='sessions'?new Map([['s',session]]):key==='sessionPersistence'?{config:{root:join(root,'sessions')},listSnapshots:()=>[]}:undefined,effect:fn=>effects.push(fn())},{cache:mode!=='uncached-dispose'});
 const ok=value=>({result:{ok:true,value}}),client={sessions:{list:async()=>ok({items:[{sessionId:'s'}]})},events:{},workspace:{},llm:{},settings:{}};
 const gateway=createGatewayV1({client,readLog:read});
 const server=createServer((q,s)=>void gateway.handle(q,s));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;let received=false;
 const pending=fetch(origin+'/weftmate/api/v1/sessions/s/history?waitMs=1200&waitSeq=-1&limit=1').then(async r=>{received=true;return {status:r.status,body:await r.json()};});
 await pause(100);const at=Date.now();gateway.close();if(mode.endsWith('dispose'))for(const dispose of effects)await dispose();
 let serverClosed=false;const closing=new Promise(r=>server.close(()=>{serverClosed=true;r();}));await pause(100);
 const row={mode,receivedAfterClose100ms:received,serverClosed100ms:serverClosed};row.response=await pending;row.responseAfterCloseMs=Date.now()-at;server.closeIdleConnections();await closing;row.closeMs=Date.now()-at;
 read.close();await pause(20);rmSync(root,{recursive:true,force:true});report.push(row);
}
writeFileSync(outputPath('gateway.json'),JSON.stringify(report,null,2));console.log(report);

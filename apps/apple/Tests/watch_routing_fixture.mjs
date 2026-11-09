// Real personal/v1 routes and deterministic model SSE; isolated credentials and native-log backend.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersonalAccessService} from '../../../src/personal-access/index.mjs';
import {syntheticBackend} from './a5_synthetic_backend.mjs';
process.umask(0o077);
const root=await realpath(await mkdtemp(join(tmpdir(),'wm-watch-routing-'))),runtime=syntheticBackend(root);
const sendMessage=runtime.backend.sendMessage;
runtime.backend.sendMessage=async args=>{
 const receipt=await sendMessage(args);
 if(args.text.includes('长历史')){
  const session=runtime.sessions.get(args.sessionId);
  for(let i=0;i<225;i++)session.events.push({seq:session.events.length,time:Date.now(),type:'assistant/message',data:{content:[{type:'text',text:'合成进度片段 '+i}]}});
 }
 return receipt;
};
const host=await createPersonalAccessService({root:join(root,'host'),port:0,backend:runtime.backend});runtime.attach(host);
const started=await host.start(),grant=await host.issueSetupGrant();
const setup=await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'watch-tester',password:'synthetic-watch-only',deviceName:'合成电脑'})});
if(!setup.ok)throw Error('Fixture setup '+setup.status);
let questions=0,classifications=0;
const model=createServer(async(req,res)=>{
 if(req.url==='/stop'){res.end('ok');setTimeout(()=>void close(),20);return;}
 if(req.url==='/report'){res.setHeader('content-type','application/json');res.end(JSON.stringify({questions,classifications,sends:runtime.operations.filter(o=>o.kind==='send').length}));return;}
 if(req.headers.authorization!=='Bearer synthetic-watch-key'){res.writeHead(401);res.end();return;}
 const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));
 const classify=body.messages.some(m=>m.role==='system'&&m.content.includes('仅判断执行设备'));
 const text=body.messages.filter(m=>m.role==='user').at(-1)?.content ?? '';
 if(classify)classifications++;else questions++;
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.flushHeaders();
 if(text.includes('慢速'))await new Promise(r=>setTimeout(r,400));
 const content=classify ? (text.includes('无效分类')?'not-a-device':'phone') : '手机已经回答：'+text;
 res.end('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: [DONE]\n\n');
});
model.listen(0,'127.0.0.1');await once(model,'listening');
console.log(JSON.stringify({host:started.origin,hostId:started.hostId,model:`http://127.0.0.1:${model.address().port}`,root}));
async function close(){model.closeAllConnections();model.close();await host.close();await rm(root,{recursive:true,force:true});process.exit();}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());

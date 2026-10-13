import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { startNativeFixture } from '../and-4/fixture.mjs';

// AND-4's synthetic catalog id has no real provider. Supply its explicit,
// authenticated verification result so model selection tests only client focus.
export async function startComposerFixture() {
  const base=await startNativeFixture();
  let contentRevision=1;
  const server=createServer(async (req,res)=>{
    try {
      if(req.url==='/personal/v1/model-services') {
        const auth=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});
        if(!auth.ok){res.writeHead(auth.status,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'UNAUTHORIZED'}}));return;}
        res.writeHead(200,{'content-type':'application/json'});
        res.end(JSON.stringify({services:[{serviceId:'synthetic-service',name:'合成 MiMo 服务',baseUrl:'https://model.example/v1',interfaceType:'openai-compatible',configured:true,hasCredential:true,
          models:[{modelId:'mimo-v2.6-flash',name:'MiMo v2.6 Flash',displayName:'MiMo v2.6 Flash',profileId:'synthetic',profileIds:['synthetic'],configured:true,available:true}]}]}));return;
      }
      if(req.url==='/personal/v1/models/synthetic/verify') {
        const response=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});
        const identity=await response.json();
        if(!response.ok || req.headers['x-weftmate-csrf']!==identity.csrfToken) {
          res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'FORBIDDEN'}}));return;
        }
        for await(const _ of req) {}
        res.writeHead(200,{'content-type':'application/json'});
        res.end(JSON.stringify({configured:true,reachable:true,modelListed:true,inferenceVerified:false}));return;
      }
      const headers={...req.headers,origin:base.origin};delete headers.host;delete headers.connection;delete headers['content-length'];
      const response=await fetch(`${base.origin}${req.url}`,{method:req.method,headers,
        ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{}),redirect:'manual'});
      const output=Object.fromEntries(response.headers);delete output['content-length'];delete output['content-encoding'];
      if(response.headers.getSetCookie().length)output['set-cookie']=response.headers.getSetCookie();
      if(req.url==='/__qa/long' && response.ok)contentRevision++;
      if(req.url==='/personal/v1/status' || /^\/personal\/v1\/sessions\/[^/?]+$/.test(req.url) || /\/personal\/v1\/(chats|sessions)\/[^/]+\/(events|changes)/.test(req.url)) {
        const value=await response.json();
        if(req.url==='/personal/v1/status')value.presence={...value.presence,runtime:'ready',model:'ready'};
        else if(/^\/personal\/v1\/sessions\/[^/?]+$/.test(req.url))value.modelProfileId='synthetic';
        else {
          value.contentRevision=contentRevision;
          for(const event of value.items || value.upserts || value.events || [])
            if(event.type==='user.message' && event.data?.text==='合成流式')event.data.receiptId='rpc:synthetic';
        }
        res.writeHead(response.status,output);res.end(JSON.stringify(value));return;
      }
      res.writeHead(response.status,output);if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
    } catch { if(!res.headersSent)res.writeHead(503);res.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,credentials:{...base.credentials,origin},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await base.close();}};
}

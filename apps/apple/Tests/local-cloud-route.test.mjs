import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {localCloudRoute} from './local_cloud_route.mjs';

test('local discovery preserves authorization failures and forwards authoritative session bytes',async()=>{
  const secret=randomUUID(),seen=[];
  const upstream=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    seen.push({path:req.url,proof:req.headers.dpop,body:Buffer.concat(chunks).toString()});
    res.setHeader('content-type','application/json');
    if(req.url.endsWith('/hosts/connect')) {
      const allowed=req.headers.authorization===secret;
      res.writeHead(allowed?200:403);res.end(JSON.stringify(allowed?{hostId:'isolated',status:'offline',baseUrl:null,resource:'real-grant'}:{error:{code:'FORBIDDEN'}}));
    } else {res.setHeader('set-cookie','synthetic='+secret+'; HttpOnly');res.end(JSON.stringify({authoritative:secret}));}
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const origin='http://127.0.0.1:'+port,audit=[];
  const route=await localCloudRoute({origin,upstreamPort:upstream.address().port,hostOrigin:()=> 'http://127.0.0.1:7654',audit});
  try {
    const denied=await fetch(origin+'/personal/v1/cloud/hosts/connect',{method:'POST',body:'{}'});
    assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{error:{code:'FORBIDDEN'}});
    const allowed=await fetch(origin+'/personal/v1/cloud/hosts/connect',{method:'POST',headers:{authorization:secret,dpop:secret},body:'{}'});
    assert.deepEqual(await allowed.json(),{hostId:'isolated',status:'online',baseUrl:'http://127.0.0.1:7654',resource:'real-grant'});
    const session=await fetch(origin+'/personal/v1/cloud/auth/session',{method:'POST',headers:{dpop:secret},body:'unchanged'});
    assert.deepEqual(await session.json(),{authoritative:secret});assert.equal(session.headers.getSetCookie()[0],'synthetic='+secret+'; HttpOnly');
    assert.equal(seen.at(-1).body,'unchanged');assert.equal(seen.at(-1).proof,secret);assert.equal(audit.length,3);
  } finally {await route.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));}
});

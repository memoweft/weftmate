import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {startNativeFixture} from '../and-4/fixture.mjs';
import {progressEvents} from '../../helpers/fix-36-timeline.mjs';
import {servePersonalAccessUi} from '../../../src/personal-access-ui/index.mjs';
export async function startProgressFixture() {
  const base=await startNativeFixture(),sid='session-11111111-1111-4111-8111-111111111111';
  let events=[],running=false,revision=1,timer;
  const set=mode=>{revision++;running=['running','approval'].includes(mode);events=progressEvents(mode,sid);};
  const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const server=createServer(async(req,res)=>{try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(await servePersonalAccessUi(req,res))return;
    if(path==='/__qa/progress'){clearInterval(timer);set(new URL(req.url,'http://localhost').searchParams.get('mode')||'completed');return json(res,{ok:true});}
    if(/\/personal\/v1\/(chats|sessions)\/[^/]+\/(events|changes)$/.test(path)) return json(res,{[path.endsWith('/changes')?'upserts':path.includes('/sessions/')?'events':'items']:events,contentRevision:revision,nextSeq:events.length,nextCursor:String(events.length),syncCursor:String(events.length),liveRevision:revision,liveEvents:[],hasMore:false,hasOlder:false});
    if(path==='/personal/v1/commands' && req.method==='POST') {
      const auth=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}});
      if(!auth.ok)return json(res,{error:{code:'UNAUTHORIZED'}},401);
      const identity=await auth.json();if(req.headers['x-weftmate-csrf']!==identity.csrfToken)return json(res,{error:{code:'FORBIDDEN'}},403);
      let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);
      if(['session.message','chat.message'].includes(body.kind)) {
        set('running');const final=progressEvents('completed',sid);final[0].data.receiptId='rpc:fix36';final[0].data.requestId=body.requestId;events=final.slice(0,3);running=true;
        timer=setInterval(()=>{events=final.slice(0,Math.min(final.length,events.length+2));revision++;if(events.length===final.length){clearInterval(timer);running=false;}},180);
      }
      return json(res,{command:{...body,commandId:randomUUID(),sessionId:sid,state:'accepted_by_dsh',receiptId:'rpc:fix36',createdAt:new Date().toISOString()}},202);
    }
    const headers={...req.headers,origin:base.origin};delete headers.host;delete headers.connection;delete headers['content-length'];
    const response=await fetch(`${base.origin}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{}),redirect:'manual'});
    const output=Object.fromEntries(response.headers);delete output['content-length'];delete output['content-encoding'];if(response.headers.getSetCookie().length)output['set-cookie']=response.headers.getSetCookie();
    if(/^\/personal\/v1\/chats\/[^/]+$/.test(path) && response.ok) {
      const value=await response.json();if(value.chat)Object.assign(value.chat,{title:'查看当前时间',running,contentRevision:revision});res.writeHead(response.status,output);return res.end(JSON.stringify(value));
    }
    res.writeHead(response.status,output);if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch(error){json(res,{error:{code:'FIX36_FIXTURE_FAILURE',message:error.message}},500);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,credentials:{...base.credentials,origin},async close(){clearInterval(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await base.close();}};
}

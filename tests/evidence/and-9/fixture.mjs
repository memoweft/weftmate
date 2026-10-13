import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {startNativeFixture} from '../and-4/fixture.mjs';

/** Actual account authentication and native transport, deterministic synthetic model services. */
export async function startSettingsFixture(){
  const base=await startNativeFixture(),requests=[];
  const id='model-service-11111111-1111-4111-8111-111111111111';
  let services=[],selected='synthetic',legacy=false,failed=false,thinking=false,profileName=null,profileRevision=0,replyRunning=false,inFlightModel='synthetic';
  const model=(n)=>({modelId:n===0?'mimo-v2.6-flash':n===1?'mimo-v2.6-pro':`chat-${n}`,name:n===0?'MiMo v2.6 Flash':n===1?'MiMo v2.6 Pro':`合成型号 ${n}`,enabled:true,profileId:n===0?'synthetic':`synthetic-${n}`,profileIds:[n===0?'synthetic':`synthetic-${n}`],deepThinking:n===0?{supported:true}:{supported:false},capabilities:{vision:n!==1},lastUsedAt:n<2?new Date().toISOString():undefined});
  function reset(){profileName=null;profileRevision=0;selected='synthetic';legacy=failed=thinking=false;services=[{serviceId:id,name:'合成 MiMo 服务',baseUrl:'https://model.example/v1',interfaceType:'openai-compatible',revision:1,selectedModelId:'mimo-v2.6-flash',models:Array.from({length:16},(_,n)=>model(n)),catalog:{status:'available',checkedAt:new Date().toISOString()}}];}
  reset();
  const json=(res,b,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(b));};
  const view=()=>({services,models:services.flatMap(s=>s.models.map(m=>({id:m.profileId,name:m.name,model:m.modelId,configured:m.enabled,deepThinking:m.deepThinking}))),modelSettings:{defaultModelProfileId:selected},selected:services.flatMap(s=>s.models.map(m=>({serviceId:s.serviceId,...m}))).find(m=>m.profileId===selected)});
  const server=createServer(async(req,res)=>{try{
    const u=new URL(req.url,'http://fixture'),p=u.pathname;
    if(p.startsWith('/__and9/')){const action=p.split('/').at(-1);if(action==='reset'){reset();replyRunning=false;}if(action==='running'){replyRunning=true;inFlightModel=selected;}if(action==='idle')replyRunning=false;if(action==='empty')services=[];if(action==='legacy')legacy=true;if(action==='failure')failed=true;if(action==='recover')failed=false;return json(res,{services,selected,thinking,replyRunning,inFlightModel,requests:requests.filter(r=>r.path!==p)});}
    if(p==='/v1/models')return json(res,{data:[{id:'phone-flash',name:'手机快速模型',capabilities:{reasoning:true}},{id:'phone-pro',name:'手机专业模型'}]});
    const own=p.startsWith('/personal/v1/model-services')||p.endsWith('/thinking')||p==='/personal/v1/models'||p==='/personal/v1/auth/profile';
    if(own){
      const auth=await fetch(`${base.origin}/personal/v1/auth/me`,{headers:{cookie:req.headers.cookie||''}}),me=await auth.json();if(!auth.ok)return json(res,{error:{code:'UNAUTHORIZED'}},401);
      let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
      if(req.method!=='GET'&&req.headers['x-weftmate-csrf']!==me.csrfToken)return json(res,{error:{code:'FORBIDDEN'}},403);
      requests.push({method:req.method,path:p,modelId:body.modelId,sessionId:body.sessionId,expectedRevision:body.expectedRevision});
      if(p==='/personal/v1/auth/profile'){if(body.expectedRevision!==profileRevision)return json(res,{error:{code:'PROFILE_REVISION_CHANGED'}},409);profileName=body.displayName;profileRevision++;return json(res,{account:{...me.account,displayName:profileName,profileRevision}});}
      if(p==='/personal/v1/models')return json(res,{models:view().models});
      if(p.endsWith('/thinking')){if(req.method==='PATCH')thinking=body.enabled;return json(res,{supported:true,enabled:thinking});}
      if(legacy)return json(res,{error:{code:'NOT_FOUND'}},404);if(failed)return json(res,{error:{code:'TEMPORARILY_UNAVAILABLE'}},503);
      if(req.method==='GET')return json(res,view());
      const sid=p.split('/')[4],service=services.find(s=>s.serviceId===sid);
      if(p.endsWith('/select')){if(!service)return json(res,{error:{code:'NOT_FOUND'}},404);const m=service.models.find(m=>m.modelId===body.modelId);selected=m.profileId;service.selectedModelId=m.modelId;m.lastUsedAt=new Date().toISOString();return json(res,{profileId:selected,service,models:view().models});}
      if(p.endsWith('/refresh'))return json(res,{service,...view()});
      if(req.method==='DELETE'){if(body.expectedRevision!==service.revision)return json(res,{error:{code:'REVISION_CHANGED'}},409);services=services.filter(s=>s!==service);return json(res,view());}
      if(req.method==='POST') {const s={serviceId:`model-service-${randomUUID()}`,name:body.name,baseUrl:body.baseUrl,interfaceType:body.interfaceType,revision:1,models:[model(0),model(1)],selectedModelId:'mimo-v2.6-flash',catalog:{status:body.apiKey==='wrong'?'authentication_failed':body.baseUrl?.includes('manual')?'unsupported':'available',checkedAt:new Date().toISOString()}};if(s.catalog.status!=='available')s.models=[];services.push(s);return json(res,{service:s,...view()},201);}
      if(req.method==='PATCH'){if(body.expectedRevision!==service.revision)return json(res,{error:{code:'REVISION_CHANGED'}},409);for(const key of ['name','baseUrl','interfaceType'])if(body[key])service[key]=body[key];if(body.apiKey)service.catalog.status=body.apiKey==='wrong'?'authentication_failed':'available';if(body.models)for(const row of body.models){const m=service.models.find(m=>m.modelId===row.modelId);if(m)m.enabled=row.enabled;}if(body.modelId&&!service.models.some(m=>m.modelId===body.modelId))service.models.push({modelId:body.modelId,name:body.modelId,enabled:true,manual:true,profileId:'manual'});service.revision++;return json(res,{service,...view()});}
    }
    const headers={...req.headers,origin:base.origin};delete headers.host;delete headers.connection;delete headers['content-length'];
    const response=await fetch(`${base.origin}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{}),redirect:'manual'});
    const output=Object.fromEntries(response.headers);delete output['content-length'];delete output['content-encoding'];if(response.headers.getSetCookie().length)output['set-cookie']=response.headers.getSetCookie();
    if((p.startsWith('/personal/v1/chats/')&&!p.endsWith('/events')&&!p.endsWith('/changes')||p==='/personal/v1/auth/me')&&response.ok){const value=await response.json();if(value.chat)Object.assign(value.chat,{selectedModelProfileId:selected,modelProfileId:replyRunning?inFlightModel:selected,running:replyRunning});if(p==='/personal/v1/auth/me'&&profileName)Object.assign(value.account,{displayName:profileName,profileRevision});res.writeHead(response.status,output);res.end(JSON.stringify(value));return;}
    res.writeHead(response.status,output);if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch{if(!res.headersSent)json(res,{error:{code:'FIXTURE_FAILED'}},500);else res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,credentials:{...base.credentials,origin},requests,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await base.close();}};
}

/** Synthetic access host and mobile bridge. No vendor, models or daily data. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';

export async function startR02Fixture({ root, systemManager }) {
  const backend = {
    getStatus: async () => ({ runtime:'ready', referenceScan:'ready', capabilities:{chat:{available:true,inferenceVerified:false}} }),
    listModels: async () => [{id:'synthetic',name:'合成模型',model:'synthetic',configured:true}],
    preflight: async () => ({ok:true}), createSession: async ({sessionId}) => ({sessionId}),
    sendMessage: async () => { throw Error('R0-2 acceptance must never send model requests'); },
    cancelSession: async () => ({accepted:true}), readEvents: async () => ({events:[],nextSeq:-1,hasMore:false}),
    describeSession: async () => null,
  };
  const service = await createPersonalAccessService({root:join(root,'access'),port:0,backend,systemManager,uiHandler:servePersonalAccessUi});
  const {origin} = await service.start(), {grant} = await service.issueSetupGrant();
  const credentials = {username:'R02Synthetic',password:'synthetic-'+randomUUID(),deviceName:'synthetic-host'};
  const setup = await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant,...credentials})});
  assert.equal(setup.status,201);
  const auth = await setup.json(), cookie = setup.headers.get('set-cookie').split(';')[0];
  const request = async (path,body,method=body?'POST':'GET') => {
    const response = await fetch(origin+'/personal/v1'+path,{method,headers:{origin,cookie,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},...(body?{body:JSON.stringify(body)}:{})});
    const data = await response.json(); assert.ok(response.ok,JSON.stringify(data)); return data;
  };
  await request('/onboarding',{step:'first',completed:true},'PATCH');
  const owner = createHash('sha256').update(origin+'|'+auth.account.ownerId).digest('hex');
  const bridgeCalls=[];
  const bridge = async (method,params) => {
    bridgeCalls.push(method+(params.path?' '+params.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id'):''));
    if (method === 'app.bootstrap') return {deviceId:auth.device.id,loggedIn:true,username:'合成诊断账号',owner,busy:false,model:{source:'host',displayName:'合成模型'}};
    if (method === 'auth.me') return {device:auth.device,deviceId:auth.device.id,displayName:'合成诊断账号',connectionVerified:true,owner};
    if (method === 'host.status') return request('/status');
    if (method === 'host.business') return request(params.path.replace('/personal/v1',''),params.body,params.method);
    if (method === 'settings.appearance') return {value:'light'};
    if (method === 'shared.sessions.list') return {source:'host',hostAvailable:true,sessions:[]};
    if (method === 'shared.outbox.list') return {source:'host',commands:[]};
    if (method === 'shared.projects.list') return {projects:[]};
    if (method === 'updates.status') return {activeVersion:'synthetic'};
    if (method === 'models.host') return {models:[{profileId:'synthetic',displayName:'合成模型',model:'synthetic',configured:true}]};
    if (method === 'models.list') return {models:[]};
    if (method === 'attachments.list') return {attachments:[]};
    if (method === 'conversations.list') return {conversations:[]};
    if (method === 'diagnostics.status') return {state:'ready',previous:null,uncleanCount7Days:0,summary:'合成手机记录'};
    if (method === 'cloud.callback') return {};
    if (['events.subscribe','app.ready','app.activity','app.failed','diagnostics.record','clipboard.copy'].includes(method)) return {};
    throw Error('Unsupported synthetic bridge method: '+method);
  };
  const assets = new Set(readdirSync(new URL('../../apps/mobile-ui/www/',import.meta.url),{recursive:true}).map(name=>String(name).replaceAll('\\','/')));
  const bridgeCode = `window.weftNative={postMessage(raw){const m=JSON.parse(raw);fetch('/bridge',{method:'POST',body:raw}).then(r=>r.json()).then(v=>window.weftNative.onmessage({data:JSON.stringify({id:m.id,ok:!v.error,result:v.result,error:v.error})}))},onmessage:null}`;
  const mobileServer = createServer(async (req,res) => {
    try {
      const path = new URL(req.url,'http://127.0.0.1').pathname;
      if (path === '/bridge') {let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw);res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({result:await bridge(input.method,input.params||{})}));}
      if (path === '/bridge.js') {res.writeHead(200,{'content-type':'text/javascript'});return res.end(bridgeCode);}
      const name = path === '/' ? 'index.html' : path.slice(1);
      if (!assets.has(name)||name.includes('..')) {res.writeHead(404);return res.end();}
      let content = readFileSync(new URL('../../apps/mobile-ui/www/'+name,import.meta.url));
      if (name === 'index.html') content = Buffer.from(content.toString().replace("connect-src 'none'","connect-src 'self'").replace('<script defer src="app.js">','<script defer src="bridge.js"></script><script defer src="app.js">'));
      res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(content);
    } catch {res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'SYNTHETIC_BRIDGE_UNAVAILABLE'}}));}
  });
  await new Promise(done=>mobileServer.listen(0,'127.0.0.1',done));
  return {origin,credentials,request,service,bridgeCalls,mobileUrl:`http://127.0.0.1:${mobileServer.address().port}`,
    async close(){await new Promise(done=>mobileServer.close(done));await service.close();}};
}

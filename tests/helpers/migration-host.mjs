/** Real main.mjs + pinned DSH, synthetic provider and isolated local identity. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from './local-ui-session.mjs';

export async function until(fn, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('MIGRATION_SMOKE_TIMEOUT');
}
export async function migrationHost({ executable, source = resolve(process.env.FX21_SOURCE || '.'), old = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-fx21-')), profile = join(root, 'profile');
  mkdirSync(profile); writeFileSync(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const h = { root, profile, app: null, requests: [], source, executable, old };
  const server = createServer(async (req, res) => {
    if (req.url.endsWith('/models')) return res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({data:[{id:'synthetic-fx21',context_window:32768}]}));
    if (req.method === 'GET') return res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({total_slots:1,n_ctx:32768,currentModelId:'synthetic-fx21',switching:false,probe:{health:true}}));
    let raw = ''; for await (const b of req) raw += b;
    const input = JSON.parse(raw); h.requests.push(input);
    const message = h.respond ? await h.respond(input) : {role:'assistant',content:'主对话首条消息成功，合成回复。'};
    const usage = {prompt_tokens:20,completion_tokens:10,total_tokens:30};
    if (input.stream) {
      res.writeHead(200, {'content-type':'text/event-stream'});
      res.end(`data: ${JSON.stringify({id:randomUUID(),choices:[{index:0,delta:message,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:message.tool_calls?'tool_calls':'stop'}],usage})}\n\ndata: [DONE]\n\n`);
    } else res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({id:randomUUID(),choices:[{index:0,message,finish_reason:'stop'}],usage}));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  h.credentials = {username:'fx21-'+randomUUID(),password:'synthetic-'+randomUUID(),deviceName:'FX21 synthetic desktop'};
  const factory = old ? (await import(pathToFileURL(join(source,'src/personal-access/index.mjs')))).createPersonalAccessService : createPersonalAccessService;
  const prep = await factory({root:join(profile,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>({})]))});
  const prepared = await prep.start(), grant = await prep.issueSetupGrant();
  try { assert.equal((await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...h.credentials})})).status,201); }
  finally { await prep.close(); }
  const config = join(root,'desktop-config.json');
  writeFileSync(config,JSON.stringify({schemaVersion:1,dataDirectory:profile,accessPort:0,updates:{channel:'preview'}}));
  h.launch = async () => {
    const env = {...process.env};
    for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
    env.WEFTMATE_MEMOWEFT_ENABLED = '0';
    env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
    const passwordStore = process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : [];
    h.app = await _electron.launch({executablePath:h.executable || createRequire(import.meta.url)('electron'),args:h.executable?[...passwordStore,`--desktop-config=${config}`]:[h.source,...passwordStore,`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],cwd:h.source,env,timeout:90000});
    h.stderr = []; h.app.process().stderr?.on('data', chunk => { h.stderr.push(String(chunk)); if (h.stderr.length > 200) h.stderr.shift(); });
    h.page = await h.app.firstWindow(); h.page.setDefaultTimeout(15000);
    await h.page.waitForURL('**/personal/v1/ui*');
    await localUiSession(h.page,h.credentials,'FX21',{mainChat:!h.old});
    await h.page.locator('#assistant-view').waitFor({state:'visible'});
    h.origin = new URL(h.page.url()).origin;
  };
  h.api = (path,body,method=body?'POST':'GET') => h.page.evaluate(async ({path,body,method}) => {
    const me = await (await fetch('/personal/v1/auth/me')).json();
    const response = await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  },{path,body,method});
  h.receipt = async command => until(async () => {
    const row = (await h.api('/commands/'+command.commandId)).body.command;
    if (['rejected','failed','uncertain'].includes(row.state)) throw new Error(JSON.stringify(row));
    return row.state === 'accepted_by_dsh' && row;
  });
  h.mainFirst = async () => {
    const chat = (await h.api('/chats/main')).body.chat;
    assert.equal(chat.activeSessionId,null);
    const response = await h.api('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:chat.chatId,targetDeviceId:h.hostId,modelProfileId:h.modelId,text:'合成新账号第一句话'});
    assert.equal(response.status,202,JSON.stringify(response));
    const receipt = await h.receipt(response.body.command);
    const events = await until(async () => {
      const r = await h.api('/sessions/'+receipt.sessionId+'/events?limit=200');
      return r.body.events?.some(e => e.type==='assistant.message' && e.data?.text?.includes('主对话首条消息成功')) && r.body.events.some(e=>e.type==='turn.ended') && r.body.events;
    });
    return {chatId:chat.chatId,sessionId:receipt.sessionId,reply:events.find(e=>e.type==='assistant.message').data.text};
  };
  h.close = async () => { await h.app?.close(); h.app=null; server.closeAllConnections(); await new Promise(r=>server.close(r)); rmSync(root,{recursive:true,force:true}); };
  try {
    await h.launch();
    const requestId = randomUUID();
    const added = await h.api('/account/models',{requestId,name:'FX21 合成模型',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'synthetic-fx21',apiKey:'synthetic-fx21-key'});
    assert.equal(added.status,202,JSON.stringify(added.body)+' :: '+h.stderr.join('').split('\n').filter(line=>/weftmate|rror/.test(line)).slice(-12).join(' | ').slice(0,1800));
    await until(async () => (await h.api('/account/models/by-request/'+requestId)).body.operation?.status==='succeeded');
    h.modelId=(await h.api('/models')).body.models.find(m=>m.name==='FX21 合成模型').id;
    h.hostId=(await h.api('/status')).body.hostId;
    await h.page.reload(); await h.page.locator('#assistant-view').waitFor({state:'visible'});
    return h;
  } catch(error) { await h.close(); throw error; }
}

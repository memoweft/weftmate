import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { snapshot, verify } from '../src/personal-backup/archive.mjs';
import { ordinaryContextAfterTemporary } from '../src/plugins/weftmate-personal-memory.mjs';

test('temporary sessions freeze each turn, retain recall, reject main changes, persist and truly expire', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-mem2-unit-'));
  let now = Date.now(), service: any;
  const removed: string[] = [];
  const backend = { getStatus: async () => ({}), listModels: async () => [{id:'local', configured:true, sourceKind:'local'}],
    preflight: async () => ({}), createSession: async ({sessionId}: any) => ({sessionId}),
    sendMessage: async () => ({accepted:true, receiptId:'receipt'}), cancelSession: async () => ({accepted:true}),
    deleteSession: async ({sessionId}: any) => { removed.push(sessionId); return {deleted:true}; },
    readEvents: async () => ({events:[], nextSeq:-1}), describeSession: async (sessionId: string) => ({sessionId, agentPreset:'personal-remote', modelProfileId:'local', running:false}) };
  try {
    service = await createPersonalAccessService({root, port:0, backend, clock:()=>now});
    let {origin, hostId} = await service.start();
    const grant = await service.issueSetupGrant();
    const setup = await fetch(origin+'/personal/v1/auth/setup', {method:'POST', headers:{origin, 'content-type':'application/json'},
      body:JSON.stringify({grant:grant.grant, username:'synthetic-mem2', password:'synthetic-password-long', deviceName:'fixture'})});
    assert.equal(setup.status,201);
    const cookie = setup.headers.get('set-cookie')!.split(';')[0], auth = await setup.json();
    const api = async (route: string, body?: any, method = body ? 'POST' : 'GET') => {
      const r = await fetch(origin+'/personal/v1'+route, {method, headers:{origin,cookie,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken}, body:body && JSON.stringify(body)});
      return {status:r.status, ...await r.json()};
    };
    async function create(temporary = false) {
      const requestId = crypto.randomUUID();
      let result = temporary ? await api('/sessions/temporary', {requestId,modelProfileId:'local'})
        : await api('/commands', {requestId,kind:'session.create',targetDeviceId:hostId,modelProfileId:'local'});
      for (let i=0; i<100 && result.command.state !== 'accepted_by_dsh'; i++) { await new Promise(r=>setTimeout(r,10)); result=await api('/commands/by-request/'+requestId); }
      assert.equal(result.command.state,'accepted_by_dsh'); return result.command.sessionId;
    }
    const ordinary = await create(), temporary = await create(true), ownerId = (await api('/status')).ownerId;
    const policy = (id: string, turn: number) => service.memoryTurnPolicy(ownerId,id,turn);
    assert.equal((await policy(ordinary,1)).ingest,true);
    assert.equal((await api(`/sessions/${ordinary}/metadata`, {memoryMode:'off'}, 'PATCH')).status,200);
    assert.equal((await policy(ordinary,1)).ingest,true, 'in-flight turn retains its policy');
    assert.equal((await policy(ordinary,2)).ingest,false);
    assert.equal((await policy(ordinary,2)).recall,true);
    assert.equal((await policy(temporary,1)).ingest,false);
    assert.equal((await api(`/sessions/${temporary}/metadata`, {recallEnabled:false, autoDeleteDays:1}, 'PATCH')).status,200);
    assert.equal((await policy(temporary,2)).recall,false);
    assert.equal((await api(`/sessions/${temporary}/metadata`, {autoDeleteDays:2}, 'PATCH')).status,400);
    assert.equal((await api(`/sessions/${temporary}/fork`, {})).status,409);
    const main = (await api('/chats/main')).chat;
    assert.equal((await api(`/chats/${main.chatId}/metadata`, {requestId:'main-private', expectedRevision:main.revision, memoryMode:'off'}, 'PATCH')).status,409);
    assert.equal((await api(`/sessions/${ordinary}/metadata`, {memoryMode:'on'}, 'PATCH')).status,200);
    assert.equal((await policy(ordinary,3)).resetContext,true);
    await service.close();
    service = await createPersonalAccessService({root, port:0, backend, clock:()=>now});
    assert.equal((await policy(temporary,1)).recall,true,'restart preserves old policy');
    now += 86400001; await service.expireTemporaryChats();
    assert.deepEqual(removed,[temporary]);
    assert.equal(service.ownerForSession(temporary),null);
    assert.ok(service.ownerForSession(ordinary));
  } finally { await service?.close(); await rm(root,{recursive:true,force:true}); }
});

test('returning to ordinary mode keeps new ordinary exchanges and excludes private history, compaction and experience', () => {
  const messages = [
    {id:'private',source:{kind:'user'}}, {id:'private-reply',source:{kind:'assistant'}},
    {id:'summary',source:{kind:'plugin'}}, {id:'ordinary',source:{kind:'user'}},
    {id:'ordinary-reply',source:{kind:'assistant'}}, {id:'new',source:{kind:'user'}},
    {id:'tool',source:{kind:'tool'}}, {id:'experience',source:{kind:'plugin'}},
  ];
  const events = [{type:'turn/start',data:{turn:1}}, {type:'user/message',data:{id:'private'}},
    {type:'assistant/message',data:{message:{id:'private-reply'}}}, {type:'turn/start',data:{turn:2}},
    {type:'user/message',data:{id:'ordinary'}}, {type:'assistant/message',data:{message:{id:'ordinary-reply'}}}];
  assert.deepEqual(ordinaryContextAfterTemporary(messages,events,2).map(row=>row.id), ['ordinary','ordinary-reply','new','tool']);
});

test('new backups omit temporary native logs, workspaces, commands and disposable history caches', async () => {
  const root = await mkdtemp(join(tmpdir(),'weftmate-mem2-backup-'));
  try {
    const profile = join(root,'profile'), sentinel='合成临时原话-只在本次聊天';
    for (const [name, text] of Object.entries({
      'personal-access/store.json': JSON.stringify({accounts:{owner:{sessions:{'session-private':{temporary:true,title:sentinel},'session-normal':{}},commands:{cmd:{sessionId:'session-private',payload:{text:sentinel}}}}}}),
      'dsh-home/sessions/project/session-private/events.jsonl':sentinel,
      'workspace/owner/session-private/experience.md':sentinel,
      'dsh-home/weftmate-history.sqlite':sentinel,
      'dsh-home/sessions/project/session-normal/events.jsonl':'ordinary',
    })) { const target=join(profile,name); await mkdir(join(target,'..'),{recursive:true}); await writeFile(target,text); }
    // Synthetic projection file: do not exercise SQLite parsing in this fixture.
    const result=await snapshot({root:profile,directory:join(root,'backups'),databaseBackup:async (source: string,target: string)=>writeFile(target,await readFile(source))});
    const restored=join(root,'restored'), manifest=await verify(join(root,'backups',result.id),restored);
    const store=await readFile(join(restored,'personal-access/store.json'),'utf8');
    assert.ok(!store.includes(sentinel)); assert.ok(store.includes('session-normal'));
    assert.ok(!JSON.stringify(manifest).includes('session-private'));
    assert.equal(await readFile(join(profile,'workspace/owner/session-private/experience.md'),'utf8'),sentinel,'live temporary conversation remains until expiry');
  } finally { await rm(root,{recursive:true,force:true}); }
});

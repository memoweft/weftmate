import test from 'node:test';
import { tamperCiphertext } from './helpers/tamper-ciphertext.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { webcrypto, randomBytes } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createOfflineService } from '../src/personal-offline/index.mjs';
import { sealReplica } from '../src/personal-offline/crypto.mjs';
import { openTask } from '../src/personal-offline/crypto.mjs';
import { memorySnapshot, replicaDelta, offlineBoundary } from '../src/personal-offline/snapshot.mjs';
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs';
import { createAuthenticationOperations } from '../src/personal-access/authentication.mjs';
import { csrfForToken, digest } from '../src/personal-access/common.mjs';
import '../src/ui-core/offline.js';

const W = (globalThis as any).WeftOffline;
const identity = { ownerId: 'owner-test', hostId: 'host-test', deviceId: 'device-test' };
const permissions = { allow_local_read: true, allow_cloud_read: true, allow_inference: true };
const memory = (id = 'preferred-tea', text = '用户喝茶喜欢茉莉花茶，不加糖。') => ({ item_id: id, object_kind: 'cognition', current_state: 'current',
  permissions: [permissions], value: { content: text }, provenance: [{ evidence_id: 'source-' + id, permissions, currentness_state: 'current',
    model_content_available: true, evidence: { content_available: true, summary: text } }], updated_at: '2026-10-09' });
async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'weftmate-m3a-unit-')); t.after(() => rm(root, { recursive: true, force: true }));
  let items = [memory(), memory('travel', '用户去青海旅行。')], generation = 1, accepted: any[] = [];
  const context: any = { root, timestamp: Date.now, rootState: { hostId: identity.hostId },
    authenticate: () => ({ ...identity, via: 'cookie', device: { authKind: 'cloud',scopes:['sessions:read','commands:write','account:manage'] } }),
    accountState: () => ({ sessions: {} }), modelSelectable: () => true,
    backend: { listModels: () => [{ id: 'mimo', configured: true, sourceKind: 'cloud', name: 'MiMo' }] },
    service: { currentChatModelProfile: () => 'mimo' },
    accountModelManager: { readOfflineModel: async () => ({ baseUrl: 'https://model.example/v1', modelId: 'mimo', apiKey: 'synthetic-secret' }) },
    cloudIdentity: { publishOffline: async (_owner: string, value: number) => { generation = value; return { hostId: identity.hostId, accountId: 'account-test', generation, capabilities:{offlineTasks:1} }; } },
    memoryManager: { enabled: true, status: async () => ({ state: 'ready' }), query: async (_: any, _method: any, input: any) => ({ world_revision: generation, ...(input.operation === 'list' ? { items } : {}) }),
      ingest: async (_: any, boundary: any) => { assert.ok(boundary.source_messages.every((m: any) => ['user', 'assistant'].includes(m.role))); accepted.push(boundary); return { state: 'accepted' }; }, discardOfflinePending: async () => {} },
    readJson: (request: any) => request.body, json: (_response: any, _status: any, value: any) => value };
  const service = await createOfflineService(context);
  t.after(() => service.close());
  const host = (route: string, body: any) => service.handle({ method: 'POST', body }, {}, new URL('http://127.0.0.1/personal/v1' + route), identity.ownerId);
  return { service, host, context, root, accepted, generation: () => generation, remove: () => { items = []; } };
}

test('device sync summary counts acknowledged originals once and keeps receipt separate from memory formation', async t => {
  const f=await fixture(t),vault=await W.browserVault('device-status',{indexedDB:new IDBFactory(),crypto:webcrypto});
  assert.equal(f.service.deviceStatus(identity.ownerId,identity.deviceId),null);
  await f.host('/offline/sync',{publicJwk:await vault.key(),generation:0,hashes:{}});
  const turn={id:'status-turn',conversationId:'status-chat',timestamp:Date.now(),messages:[{role:'user',text:'private-original'}]};
  await f.host('/offline/turns',{generation:1,turns:[turn]});
  await f.host('/offline/turns',{generation:1,turns:[turn]});
  const status=f.service.deviceStatus(identity.ownerId,identity.deviceId);
  assert.equal(status.receivedOriginals,1);assert.ok(status.lastReceivedAt);assert.ok(status.replicaPublishedAt);
  assert.equal(status.memoryState,'submitted');
  assert.ok(!JSON.stringify(status).includes('private-original'));
  const reopened=await createOfflineService(f.context);t.after(()=>reopened.close());
  assert.deepEqual(reopened.deviceStatus(identity.ownerId,identity.deviceId),status);
  await f.service.invalidate(identity.ownerId);
  assert.equal(f.service.deviceStatus(identity.ownerId,identity.deviceId).receivedOriginals,0);
});

test('device envelope authenticates contents and identity; storage is encrypted and key replacement removes old values', async () => {
  const indexedDB = new IDBFactory(), vault = await W.browserVault('test', { indexedDB, crypto: webcrypto });
  const jwk = await vault.key(), payload = { secret: 'unique-m3a-private-source' };
  const envelope = sealReplica(payload, jwk, identity);
  assert.ok(!JSON.stringify(envelope).includes(payload.secret));
  assert.deepEqual(await vault.open(envelope, identity), payload);
  await assert.rejects(vault.open(envelope, { ...identity, deviceId: 'other' }));
  const tampered = { ...envelope, ciphertext: tamperCiphertext(envelope.ciphertext) };
  await assert.rejects(vault.open(tampered, identity));
  await vault.save(payload); assert.deepEqual(await vault.load(), payload);
  await vault.clear(); assert.equal((await vault.load()).snapshot, null);
  await assert.rejects(vault.open(envelope, identity), 'destroyed device key cannot reopen an old envelope'); vault.close();
});
test('native phone composer shares the encrypted conversation vault, restores and clears at the account boundary', async () => {
  const indexedDB = new IDBFactory(), vault = await W.browserVault('native-composer', { indexedDB, crypto: webcrypto });
  const engine = await W.create({ vault, identity, phoneModel: () => null, accountCheck: async () => ({}), crypto: webcrypto });
  await engine.saveComposer('phone-conversation', '合成账号的私有草稿');
  await engine.saveComposer('second-conversation', '另一条合成草稿');
  assert.equal((await vault.load()).nativeDrafts['phone-conversation'], '合成账号的私有草稿');
  await engine.saveComposer('phone-conversation', '合成账号的私有草稿');
  assert.deepEqual((await vault.load()).nativeComposer, { conversationId: 'phone-conversation', draft: '合成账号的私有草稿' });
  engine.close();
  const restoredVault = await W.browserVault('native-composer', { indexedDB, crypto: webcrypto });
  const restored = await W.create({ vault: restoredVault, identity, phoneModel: () => null, accountCheck: async () => ({}), crypto: webcrypto });
  assert.equal(restored.view().nativeComposer.draft, '合成账号的私有草稿');
  await restored.clear(); assert.equal((await restoredVault.load()).nativeComposer, undefined); restored.close();
});
test('S7 text tasks work without a cloud chat model, while old replica callers retain the model-required contract',async t=>{
  const f=await fixture(t),sessions={ 'local-dialogue':{origin:'personal-remote',modelProfileId:'local',title:'合成本地对话'} };
  f.context.accountState=()=>({sessions});f.context.backend.listModels=()=>[{id:'local',configured:true,sourceKind:'local'}];f.context.service.currentChatModelProfile=()=> 'local';
  const vault=await W.browserVault('task-only',{indexedDB:new IDBFactory(),crypto:webcrypto}),jwk=await vault.key();
  await assert.rejects(f.host('/offline/sync',{publicJwk:jwk,generation:0,hashes:{}}),{code:'OFFLINE_MODEL_REQUIRED'});
  let uploaded:any;
  const engine=await W.create({vault,identity,host:f.host,crypto:webcrypto,taskDevice:async()=> 'phone',control:async()=>({authorized:true,hostId:identity.hostId,accountId:'account-test',generation:1,capabilities:{offlineTasks:1}}),
    tasks:async(_action:string,body:any)=>{uploaded=body;return {id:body.id,state:'waiting',hostId:body.hostId};}});
  await engine.sync();assert.equal(engine.view().chatReady,false);assert.equal(engine.view().taskReady,true);assert.equal(engine.view().snapshot.model,null);
  await assert.rejects(engine.send('聊天'),{code:'OFFLINE_MODEL_REQUIRED'});await engine.submitTask('上线后读一下合成说明','task:local-dialogue');
  const recipient=JSON.parse(await readFile(path.join(f.root,'cloud-identity/offline-task-recipient.json'),'utf8'));
  const body=openTask(uploaded.envelope,recipient,{purpose:'offline-task',id:uploaded.id,hostId:identity.hostId,accountId:'account-test',deviceId:'phone',generation:1});assert.equal(body.sessionId,'local-dialogue');engine.close();
});

test('replica filters private, muted, invalid and mixed-currentness sources, and computes removals', async () => {
  const allowed = memory(), privateItem = memory('health', '私密健康内容');
  privateItem.permissions = [{ ...permissions, allow_cloud_read: false }];
  const muted = { ...memory('muted'), lifecycle: { muted_at: '2026-10-09' } };
  const mixed = memory('mixed'); mixed.provenance[0].model_content_available = false;
  const manager = { enabled: true, query: async () => ({ world_revision: 1, items: [allowed, privateItem, muted, mixed] }) };
  const snapshot = await memorySnapshot(manager, identity.ownerId);
  assert.deepEqual(snapshot.items.map((i: any) => i.id), ['mixed', 'preferred-tea']);
  assert.equal(snapshot.items[0].sources[0].summary, null);
  const first = replicaDelta(snapshot); assert.equal(first.items.length, 2);
  assert.equal(replicaDelta(snapshot, first.hashes).items.length, 0);
  assert.deepEqual(replicaDelta({ ...snapshot, items: [] }, first.hashes).remove, ['mixed', 'preferred-tea']);
});

test('temporary history never enters the encrypted replica, including a switch during the native read', async t => {
  const f=await fixture(t), vault=await W.browserVault('temporary',{indexedDB:new IDBFactory(),crypto:webcrypto});
  const sessions: any={ordinary:{modelProfileId:'mimo'},private:{modelProfileId:'mimo',memoryMode:'off'},
    restored:{modelProfileId:'mimo',memoryMode:'on',hasTemporaryContent:true},racing:{modelProfileId:'mimo'}};
  const reads: string[]=[];f.context.accountState=()=>({sessions});
  f.context.backend.readEvents=async ({sessionId}:any)=>{
    reads.push(sessionId);
    if(sessionId==='racing')sessions.racing.hasTemporaryContent=true;
    return {events:[{type:'user.message',data:{text:sessionId==='ordinary'?'ordinary history':'PRIVATE_SENTINEL'}}]};
  };
  const engine=await W.create({vault,identity,host:f.host,control:async()=>({authorized:true,hostId:identity.hostId,accountId:'account-test',generation:1,capabilities:{offlineTasks:1}}),crypto:webcrypto});
  try {
    await engine.sync();
    assert.deepEqual(reads,['racing','ordinary']);
    assert.deepEqual(engine.view().snapshot.recent.map((row:any)=>row.id),['ordinary']);
    assert.ok(!JSON.stringify(await vault.load()).includes('PRIVATE_SENTINEL'));
  } finally {engine.close();}
});

test('AUTH-1 native desktop publishes encrypted offline memory; replaying its Cookie remotely is refused before publication', async t => {
  const f = await fixture(t), vault = await W.browserVault('auth1-desktop', { indexedDB:new IDBFactory(), crypto:webcrypto });
  const token = randomBytes(32).toString('base64url'), csrf = csrfForToken(token), origin = 'http://127.0.0.1';
  const account = { account:{authEpoch:1}, sessions:{}, devices:{ [identity.deviceId]:{
    authKind:'desktop',authEpoch:1,revoked:false,expiresAt:new Date(Date.now()+60_000).toISOString(),
    tokenHash:digest(token),csrfHash:digest(csrf),scopes:['account:manage'] } } };
  Object.assign(f.context,{origin,allowedOrigins:['https://relay.synthetic.invalid'],trustedProxy:true,
    libraryDesktopToken:'synthetic-native-private-capability',accountState:()=>account,
    rootState:{hostId:identity.hostId,accounts:{[identity.ownerId]:account}}});
  f.context.authenticate = createAuthenticationOperations(f.context).authenticate;
  let published = 0;
  const publish = f.context.cloudIdentity.publishOffline;
  f.context.cloudIdentity.publishOffline = async (...args:any[]) => { published++; return publish(...args); };
  const body = {publicJwk:await vault.key(),generation:0};
  const base = {method:'POST',body,headers:{host:'127.0.0.1',origin,cookie:'wm_personal_session='+token,
    'x-weftmate-csrf':csrf,'x-weftmate-desktop':f.context.libraryDesktopToken},socket:{remoteAddress:'127.0.0.1'}};
  const request = (changes:any={}) => f.service.handle({...base,...changes,headers:{...base.headers,...changes.headers}}, {},
    new URL(origin+'/personal/v1/offline/sync'),identity.ownerId);
  try {
    const envelope = await request();
    const content = await vault.open(envelope,identity);
    assert.equal(content.items.length,2);
    assert.equal(published,1);
    for (const changes of [
      {socket:{remoteAddress:'192.0.2.25'}},
      {headers:{'x-forwarded-for':'127.0.0.1'}},
      {headers:{forwarded:'for=127.0.0.1'}},
      {headers:{origin:'https://public.synthetic.invalid'}},
      {headers:{'x-weftmate-desktop':undefined}},
      {headers:{host:'relay.synthetic.invalid',origin:'https://relay.synthetic.invalid',
        'x-forwarded-proto':'https','x-forwarded-host':'relay.synthetic.invalid'}},
    ]) await assert.rejects(request(changes),(error:any)=>error.status===403);
    assert.equal(published,1,'remote replay does not reach publication or memory reads');
  } finally {vault.close();}
});

test('host accepts evidence dependencies on uploaded turns without adding sources to the replica', async t => {
  const f = await fixture(t);
  const vault = await W.browserVault('e2-host-dependencies', { indexedDB: new IDBFactory(), crypto: webcrypto });
  t.after(() => vault.close());
  await f.host('/offline/sync', { publicJwk: await vault.key(), generation: 0, hashes: {} });
  const turn = { id: 'e2-source-turn', conversationId: 'synthetic', timestamp: Date.now(), dependencyComplete: true,
    memoryRefs: [{ kind: 'cognition', id: 'tea' }, { kind: 'evidence', id: 'tea-source' }],
    messages: [{ role: 'user', text: '合成问题' }, { role: 'assistant', text: '合成答复' }] };
  await f.host('/offline/turns', { generation: 1, turns: [turn] });
  assert.deepEqual(f.accepted[0].source_messages[1].model_context_dependencies.world_items,
    turn.memoryRefs.map(ref => ({ object_kind: ref.kind, item_id: ref.id })));
});

test('online sync → cloud-only relevant recall → offline preference → idempotent import → forget cannot resurrect', async t => {
  const f = await fixture(t), vault = await W.browserVault('roundtrip', { indexedDB: new IDBFactory(), crypto: webcrypto });
  let lastBody: any;
  vault.complete = async (body: any) => { lastBody = body; return { choices: [{ message: { content: '你喜欢茉莉花茶，不加糖。' } }], usage: { total_tokens: 42 } }; };
  const engine = await W.create({ vault, identity, host: f.host, control: async () => ({ authorized: true, hostId: identity.hostId, accountId: 'account-test', generation: f.generation() }), crypto: webcrypto });
  await engine.sync(); const encrypted = await readFile(path.join(f.root, 'offline-metadata.json'), 'utf8');
  assert.ok(!encrypted.includes('茉莉花茶') && !encrypted.includes('synthetic-secret'));
  const reply = await engine.send('我喝茶喜欢什么？');
  assert.deepEqual(reply.memoryIds, ['preferred-tea']);
  assert.ok(!JSON.stringify(lastBody).includes('青海')); assert.equal(lastBody.tools, undefined);
  const turns = structuredClone(engine.view().turns);
  await engine.sync(); assert.equal(f.accepted.length, 1); assert.equal(engine.view().turns.length, 0);
  await f.host('/offline/turns', { generation: 1, turns }); assert.equal(f.accepted.length, 1);
  await assert.rejects(f.host('/offline/turns', { generation: 1, turns: [{ ...turns[0], messages: [{ role: 'user', text: '更改正文' }] }] }), /REQUEST_CONFLICT/);
  assert.ok(!JSON.stringify(f.accepted[0].source_messages).includes('来源：'));
  assert.deepEqual(f.accepted[0].source_messages[1].model_context_dependencies.world_items,
    [{ object_kind: 'cognition', item_id: 'preferred-tea' }], 'forgotten memories can cascade into imported assistant context');
  f.remove(); await f.service.invalidate(identity.ownerId);
  await assert.rejects(engine.send('喝茶？'), /OFFLINE_RESET_REQUIRED/);
  assert.equal(engine.view().conversations.length, 0); assert.equal(engine.view().snapshot, null);
  await assert.rejects(f.host('/offline/turns', { generation: 1, turns }), /OFFLINE_RESET_REQUIRED/);
  await engine.sync(); assert.equal(engine.view().snapshot.items.length, 0); engine.close();
});

test('encrypted offline replica carries only account personalization and uses the shared prompt without making settings Evidence', async t => {
  const f=await fixture(t), vault=await W.browserVault('st1-personalization',{indexedDB:new IDBFactory(),crypto:webcrypto});
  const settings={preferredName:'小合成',tone:'concise',fixedInstructions:'末尾加 —WM',webSearch:false};
  f.context.accountState=()=>({sessions:{},personalization:settings});let sent:any;
  vault.complete=async(body:any)=>{sent=body;return {choices:[{message:{content:'好的。\n—WM'}}]}};
  const engine=await W.create({vault,identity,host:f.host,control:async()=>({authorized:true,hostId:identity.hostId,accountId:'account-test',generation:1,capabilities:{offlineTasks:1}}),crypto:webcrypto});
  try {
    await engine.sync();assert.equal(engine.view().snapshot.personalization.preferredName,'小合成');
    await engine.send('你好');assert.match(sent.messages[0].content,/小合成/);assert.match(sent.messages[0].content,/末尾加 —WM/);assert.equal(sent.tools,undefined);
    await engine.sync();assert.doesNotMatch(JSON.stringify(f.accepted),/末尾加 —WM|preferredName/);
  } finally {engine.close()}
});

test('revocation erases pending conversations, and unavailable control plane sends no model request', async t => {
  const f = await fixture(t), vault = await W.browserVault('revoke', { indexedDB: new IDBFactory(), crypto: webcrypto });
  let calls = 0, status = 0;
  vault.complete = async () => { calls++; return { choices: [{ message: { content: '已收到' } }] }; };
  const engine = await W.create({ vault, identity, host: f.host, crypto: webcrypto, control: async () => {
    if (status) throw Object.assign(new Error('denied'), { status });
    return { authorized: true, hostId: identity.hostId, accountId: 'account-test', generation: f.generation() };
  } });
  await engine.sync(); await engine.send('测试偏好'); status = 503;
  await assert.rejects(engine.send('不能发送')); assert.equal(calls, 1);
  status = 403; await assert.rejects(engine.check());
  assert.equal(engine.view().snapshot, null); assert.equal(engine.view().turns.length, 0);
  assert.equal((await vault.load()).conversations.length, 0); engine.close();
});

test('offline import uses the original Core boundary hash and stable event id', () => {
  const turn = { id: 'turn-one', conversationId: 'chat-one', timestamp: 1791548400123, messages: [{ role: 'user', text: '偏好与共同经历' }] };
  const boundary = offlineBoundary(identity.deviceId, turn);
  assertOwnerBoundBoundary(boundary.parent_session_id, boundary);
  assert.equal(boundary.source_messages[0].timestamp, 1791548400, 'Core timestamps use seconds, phone storage uses milliseconds');
  assert.deepEqual(offlineBoundary(identity.deviceId, turn), boundary);
});

test('renewing a host cookie preserves the physical device import identity and deduplication', async t => {
  const f = await fixture(t), mutableIdentity = { ...identity };
  f.context.cloudIdentity.offlineDeviceId = () => 'trusted-physical-device';
  f.context.authenticate = () => ({ ...mutableIdentity, via: 'cookie', device: { authKind: 'cloud',scopes:['sessions:read','commands:write','account:manage'] } });
  const vault = await W.browserVault('renewal', { indexedDB: new IDBFactory(), crypto: webcrypto });
  vault.complete = async () => ({ choices: [{ message: { content: '已收到偏好' } }] });
  const engine = await W.create({ vault, identity: mutableIdentity, host: f.host,
    control: async () => ({ authorized: true, hostId: identity.hostId, accountId: 'account-test', generation: 1 }), crypto: webcrypto });
  await engine.sync(); await engine.send('新的偏好');
  const turns = structuredClone(engine.view().turns);
  mutableIdentity.deviceId = 'renewed-cookie-device';
  await engine.sync(); assert.equal(f.accepted.length, 1);
  await f.host('/offline/turns', { generation: 1, turns }); assert.equal(f.accepted.length, 1);
  engine.close();
});

test('another cloud account on the same host cannot authorize use of this replica', async t => {
  const f = await fixture(t), vault = await W.browserVault('other-account', { indexedDB: new IDBFactory(), crypto: webcrypto });
  let calls = 0;
  vault.complete = async () => { calls++; return {}; };
  const engine = await W.create({ vault, identity, host: f.host, crypto: webcrypto,
    control: async () => ({ authorized: true, hostId: identity.hostId, accountId: 'other-account', generation: 1 }) });
  await engine.sync(); await assert.rejects(engine.send('我喝茶喜欢什么？'), /OFFLINE_RESET_REQUIRED/);
  assert.equal(calls, 0); assert.equal((await vault.load()).snapshot, null); engine.close();
});

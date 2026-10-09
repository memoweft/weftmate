import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createOfflineService } from '../src/personal-offline/index.mjs';
import { sealReplica } from '../src/personal-offline/crypto.mjs';
import { memorySnapshot, replicaDelta, offlineBoundary } from '../src/personal-offline/snapshot.mjs';
import { assertOwnerBoundBoundary } from '../src/personal-memory/boundary.mjs';
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
    authenticate: () => ({ ...identity, via: 'cookie', device: { authKind: 'cloud' } }),
    accountState: () => ({ sessions: {} }), modelSelectable: () => true,
    backend: { listModels: () => [{ id: 'mimo', configured: true, sourceKind: 'cloud', name: 'MiMo' }] },
    service: { currentChatModelProfile: () => 'mimo' },
    accountModelManager: { readOfflineModel: async () => ({ baseUrl: 'https://model.example/v1', modelId: 'mimo', apiKey: 'synthetic-secret' }) },
    cloudIdentity: { publishOffline: async (_owner: string, value: number) => { generation = value; return { hostId: identity.hostId, accountId: 'account-test', generation }; } },
    memoryManager: { enabled: true, query: async (_: any, _method: any, input: any) => ({ world_revision: generation, ...(input.operation === 'list' ? { items } : {}) }),
      ingest: async (_: any, boundary: any) => { assert.ok(boundary.source_messages.every((m: any) => ['user', 'assistant'].includes(m.role))); accepted.push(boundary); return { state: 'accepted' }; }, discardOfflinePending: async () => {} },
    readJson: (request: any) => request.body, json: (_response: any, _status: any, value: any) => value };
  const service = await createOfflineService(context);
  t.after(() => service.close());
  const host = (route: string, body: any) => service.handle({ method: 'POST', body }, {}, new URL('http://127.0.0.1/personal/v1' + route), identity.ownerId);
  return { service, host, context, root, accepted, generation: () => generation, remove: () => { items = []; } };
}

test('device envelope authenticates contents and identity; storage is encrypted and key replacement removes old values', async () => {
  const indexedDB = new IDBFactory(), vault = await W.browserVault('test', { indexedDB, crypto: webcrypto });
  const jwk = await vault.key(), payload = { secret: 'unique-m3a-private-source' };
  const envelope = sealReplica(payload, jwk, identity);
  assert.ok(!JSON.stringify(envelope).includes(payload.secret));
  assert.deepEqual(await vault.open(envelope, identity), payload);
  await assert.rejects(vault.open(envelope, { ...identity, deviceId: 'other' }));
  const tampered = { ...envelope, ciphertext: 'A' + envelope.ciphertext.slice(1) };
  if (tampered.ciphertext === envelope.ciphertext) tampered.ciphertext = 'B' + envelope.ciphertext.slice(1);
  await assert.rejects(vault.open(tampered, identity));
  await vault.save(payload); assert.deepEqual(await vault.load(), payload);
  await vault.clear(); assert.equal((await vault.load()).snapshot, null);
  await assert.rejects(vault.open(envelope, identity), 'destroyed device key cannot reopen an old envelope'); vault.close();
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
  const engine=await W.create({vault,identity,host:f.host,control:async()=>({authorized:true,hostId:identity.hostId,accountId:'account-test',generation:1}),crypto:webcrypto});
  try {
    await engine.sync();
    assert.deepEqual(reads,['racing','ordinary']);
    assert.deepEqual(engine.view().snapshot.recent.map((row:any)=>row.id),['ordinary']);
    assert.ok(!JSON.stringify(await vault.load()).includes('PRIVATE_SENTINEL'));
  } finally {engine.close();}
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
  f.context.authenticate = () => ({ ...mutableIdentity, via: 'cookie', device: { authKind: 'cloud' } });
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

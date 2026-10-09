import { accountPersonalization } from '../personal-access/personalization.mjs';
import { hasPrivateContent } from '../personal-access/temporary-chats.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { failure, plainObject } from '../personal-access/common.mjs';
import { durableWrite } from '../personal-access/store.mjs';
import { hash, publicDeviceKey, sealReplica } from './crypto.mjs';
import { memorySnapshot, offlineBoundary, replicaDelta, REPLICA_LIMITS } from './snapshot.mjs';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
export async function createOfflineService(context) {
  const file = path.join(context.root, 'offline-metadata.json');
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, owners: {} }; }
  if (state.version !== 1 || !state.owners) throw failure('STORE_CORRUPT', 500);
  let queue = Promise.resolve();
  const serial = fn => { const work = queue.then(fn); queue = work.catch(() => {}); return work; };
  const owner = id => state.owners[id] ??= { generation: 1, devices: {}, receipts: {} };
  const save = () => durableWrite(file, state);
  const publish = async ownerId => {
    const current = owner(ownerId);
    // An unavailable control plane must not issue an offline replica whose purge state cannot be checked.
    if (!context.cloudIdentity) throw failure('OFFLINE_CLOUD_REQUIRED', 409);
    return context.cloudIdentity.publishOffline(ownerId, current.generation);
  };
  async function cloudModel(ownerId) {
    const models = await context.backend.listModels();
    const preferred = context.service.currentChatModelProfile(ownerId);
    const selected = models.filter(m => m.configured && m.sourceKind === 'cloud' && context.modelSelectable(ownerId, m.id))
      .sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred))[0];
    if (!selected) throw failure('OFFLINE_MODEL_REQUIRED', 409);
    const model = await context.accountModelManager?.readOfflineModel?.({ ownerId, profileId: selected.id });
    if (!model?.apiKey || !model.baseUrl || !model.modelId) throw failure('OFFLINE_MODEL_REQUIRED', 409);
    return { ...model, profileId: selected.id, name: selected.name };
  }
  async function recent(ownerId) {
    const result = [];
    const cloudProfiles = new Set((await context.backend.listModels()).filter(model => model.sourceKind === 'cloud').map(model => model.id));
    for (const [sessionId, session] of Object.entries(context.accountState(ownerId).sessions).reverse()) {
      if (hasPrivateContent(session) || session.deleting || session.archived || !cloudProfiles.has(session.modelProfileId)) continue;
      const page = await context.backend.readEvents({ ownerId, sessionId, limit: 20 }).catch(() => null);
      const currentSession = context.accountState(ownerId).sessions[sessionId];
      if (!currentSession || hasPrivateContent(currentSession)) continue;
      const messages = (page?.events ?? []).filter(e => ['user.message', 'assistant.message'].includes(e.type) && typeof e.data?.text === 'string' &&
        (!owner(ownerId).purgedAt || Date.parse(e.at ?? e.timestamp ?? '') > owner(ownerId).purgedAt))
        .slice(-20).map(e => ({ role: e.type === 'user.message' ? 'user' : 'assistant', text: e.data.text.slice(0, 4000) }));
      if (messages.length) result.push({ id: sessionId, messages });
      if (result.length === REPLICA_LIMITS.conversations) break;
    }
    return result;
  }
  return {
    close: () => queue,
    invalidate(ownerId) { return serial(async () => {
      const current = owner(ownerId); current.generation++; current.receipts = {}; current.purgedAt = context.timestamp();
      // No recalled text or source text is kept here, including failed cleanup retries.
      for (const device of Object.values(current.devices)) device.hashes = {};
      await save();
      await context.memoryManager?.discardOfflinePending?.(ownerId);
      if (Object.keys(current.devices).length) await publish(ownerId);
      return { generation: current.generation };
    }); },
    async handle(request, response, url, ownerId) {
      const route = url.pathname.slice('/personal/v1/offline'.length);
      if (request.method !== 'POST' || url.search || !['/sync', '/turns'].includes(route)) throw failure('NOT_FOUND', 404);
      const current = context.authenticate(request, 'account:manage');
      if (current.ownerId !== ownerId || current.via !== 'cookie' || !['cloud', 'password'].includes(current.device.authKind)) throw failure('FORBIDDEN', 403);
      const body = await context.readJson(request, 256 * 1024);
      if (!plainObject(body)) throw failure('INVALID_REQUEST');
      const result = await serial(async () => {
        context.authenticate(request, 'account:manage');
        const account = owner(ownerId), deviceId = context.cloudIdentity?.offlineDeviceId?.(ownerId, current.deviceId) ?? current.deviceId;
        if (route === '/sync') {
          if (Object.keys(body).some(k => !['publicJwk', 'generation', 'hashes'].includes(k))) throw failure('INVALID_REQUEST');
          if (!Number.isSafeInteger(body.generation) || body.generation < 0) throw failure('INVALID_REQUEST');
          const publicJwk = publicDeviceKey(body.publicJwk);
          const control = await publish(ownerId);
          const snapshot = await memorySnapshot(context.memoryManager, ownerId);
          const model = await cloudModel(ownerId);
          const generation = account.generation;
          const known = body.generation === generation ? body.hashes ?? {} : {};
          const recentMessages = await recent(ownerId);
          const metadata = { generation, reset: body.generation !== generation, model, recent: recentMessages,
            personalization: accountPersonalization(context.accountState(ownerId)), control, syncedAt: new Date(context.timestamp()).toISOString() };
          let payload = { ...replicaDelta(snapshot, known), ...metadata };
          // Bound the resulting replica, not just this delta; otherwise small
          // incremental responses could grow an unbounded on-device snapshot.
          while (Buffer.byteLength(JSON.stringify({ ...payload, items: snapshot.items })) > REPLICA_LIMITS.bytes) {
            if (recentMessages.length) recentMessages.pop();
            else if (snapshot.items.length) snapshot.items.pop();
            else throw failure('BODY_TOO_LARGE', 413);
            snapshot.truncated = true;
            payload = { ...replicaDelta(snapshot, known), ...metadata };
          }
          context.authenticate(request, 'account:manage');
          account.devices[deviceId] = { publicJwk, keyId: hash(publicJwk) };
          await save();
          return sealReplica(payload, publicJwk, { ownerId, hostId: context.rootState.hostId, deviceId: current.deviceId });
        }
        if (Object.keys(body).some(k => !['generation', 'turns'].includes(k)) || !Array.isArray(body.turns) || body.turns.length > 50) throw failure('INVALID_REQUEST');
        if (!account.devices[deviceId] || body.generation !== account.generation) throw failure('OFFLINE_RESET_REQUIRED', 409);
        await publish(ownerId);
        const receipts = [];
        for (const turn of body.turns) {
          if (!turn || !ID.test(turn.id) || !ID.test(turn.conversationId) || !Number.isSafeInteger(turn.timestamp) || turn.timestamp < 0 ||
              !Array.isArray(turn.messages) || turn.messages.length < 1 || turn.messages.length > 2 || turn.messages[0]?.role !== 'user' ||
              turn.messages.some((m, i) => m.role !== (i === 0 ? 'user' : 'assistant') || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 16384)) throw failure('INVALID_REQUEST');
          if (turn.dependencyComplete !== undefined && typeof turn.dependencyComplete !== 'boolean' ||
              turn.memoryRefs !== undefined && (!Array.isArray(turn.memoryRefs) || turn.memoryRefs.length > 64 ||
                turn.memoryRefs.some(ref => !['cognition', 'entity', 'relationship', 'event'].includes(ref?.kind) ||
                  typeof ref.id !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(ref.id)))) throw failure('INVALID_REQUEST');
          if (new Set((turn.memoryRefs ?? []).map(ref => `${ref.kind}:${ref.id}`)).size !== (turn.memoryRefs ?? []).length) throw failure('INVALID_REQUEST');
          const receiptId = hash(`${deviceId}:${turn.id}`), digest = hash(turn), prior = account.receipts[receiptId];
          if (prior && prior !== digest) throw failure('REQUEST_CONFLICT', 409);
          if (!prior) {
            if (!context.memoryManager?.enabled) throw failure('MEMORY_UNAVAILABLE', 503);
            const ingest = await context.memoryManager.ingest(ownerId, offlineBoundary(deviceId, turn), { offline: true });
            if (ingest.state !== 'accepted') throw failure('MEMORY_UNAVAILABLE', 503);
            account.receipts[receiptId] = digest; await save();
          }
          receipts.push({ id: turn.id, state: 'synced' });
        }
        context.authenticate(request, 'account:manage');
        return { generation: account.generation, receipts };
      });
      context.authenticate(request, 'account:manage');
      if (route !== '/sync') for (const receipt of result.receipts ?? []) await context.activity?.record(ownerId, {
        key: `offline:${current.deviceId}:${receipt.id}`, type: 'memory.submission.completed', title: '补交完成',
        summary: '离线对话已同步到电脑。', level: 'silent',
      });
      return context.json(response, 200, result);
    },
  };
}

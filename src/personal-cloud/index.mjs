import { randomBytes, randomUUID } from 'node:crypto';
import { importJWK, SignJWT } from 'jose';
import { csrfForToken, digest, exactKeys, failure } from '../personal-access/common.mjs';
import { SESSION_MS } from '../personal-access/constants.mjs';
import { cloudConfiguration, createCloudVerifier } from './proofs.mjs';
import { openIdentity } from './storage.mjs';

const bindingKey = (issuer, sub) => JSON.stringify([issuer, sub]);
export function cloudIdentityFromEnvironment(env = process.env) {
  return env.WEFTMATE_CLOUD_ISSUER ? { issuer: env.WEFTMATE_CLOUD_ISSUER } : null;
}

export async function createHostCloudIdentity(context, options) {
  const config = cloudConfiguration(options);
  const hostId = context.rootState.hostId;
  const store = await openIdentity(context.root, hostId);
  const verifier = createCloudVerifier(config, hostId, context.timestamp);
  const installationKey = await importJWK(store.state.installation.privateJwk, 'ES256');
  let poll;
  let syncing = null;
  const activeResponses = new Map();
  async function edit(change) {
    const next = structuredClone(store.state);
    const result = await change(next);
    await store.write(next);
    return result;
  }
  function local(request, direct = false) {
    const current = context.authenticate(request, 'account:manage');
    if (direct) {
      context.requireBrowserOrigin(request, true);
      if (store.state.sessions[current.deviceId] || current.device.authKind !== 'password')
        throw failure('LOCAL_SESSION_REQUIRED', 403);
    }
    return current;
  }
  async function signedRequest(route, data) {
    const proof = await new SignJWT({ ...data, action: route }).setProtectedHeader({ alg: 'ES256', typ: 'wm-host-request+jwt' })
      .setIssuer(hostId).setAudience(config.issuer).setIssuedAt().setExpirationTime('60s')
      .setJti(randomUUID()).sign(installationKey);
    return callCloud(route, { hostId, proof });
  }
  async function callCloud(route, body, token) {
    let response;
    try {
      response = await fetch(`${config.base}${route}`, { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json',
          origin: new URL(config.issuer).origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw failure(result?.error?.code === 'CLAIM_CONFLICT' ? 'CLOUD_BINDING_CONFLICT' : 'CLOUD_UNAVAILABLE',
        response.status === 409 ? 409 : 503);
      return result;
    } catch (error) {
      if (error.code === 'CLOUD_BINDING_CONFLICT') throw error;
      throw failure('CLOUD_UNAVAILABLE', 503);
    }
  }
  function closeInvalidResponses() {
    for (const [response, request] of activeResponses) {
      try { context.authenticate(request, 'sessions:read'); }
      catch { response.destroy(); }
    }
  }
  function assertSession(ownerId, deviceId) {
    if (context.accountState(ownerId).devices[deviceId]?.revoked) throw failure('UNAUTHORIZED', 401);
    const session = store.state.sessions[deviceId];
    if (!session) throw failure('UNAUTHORIZED', 401);
    const binding = store.state.bindings[session.bindingKey];
    const device = store.state.devices[session.trustId];
    if (!binding || binding.status !== 'active' || binding.ownerId !== ownerId ||
        device?.status !== 'trusted' || device.ownerId !== ownerId ||
        session.epoch < (store.state.epochs[session.bindingKey] ?? 0)) throw failure('UNAUTHORIZED', 401);
  }
  async function applyEvents(encoded) {
    const envelope = await verifier.events(encoded);
    if (!Array.isArray(envelope.events) || !Number.isSafeInteger(envelope.watermark) || envelope.watermark < 0)
      throw failure('CLOUD_TOKEN_INVALID', 401);
    await context.serial(async () => {
      await edit(next => {
        let previous = -1;
        for (const event of envelope.events) {
          if (!Number.isSafeInteger(event.seq) || event.seq <= previous || event.seq > envelope.watermark ||
              typeof event.sub !== 'string' || !['epoch', 'device'].includes(event.kind)) throw failure('CLOUD_TOKEN_INVALID', 401);
          previous = event.seq;
          if (event.seq <= next.watermark) continue;
          const key = bindingKey(config.issuer, event.sub);
          if (event.kind === 'epoch') {
            if (!Number.isSafeInteger(event.epoch) || event.epoch < 0) throw failure('CLOUD_TOKEN_INVALID', 401);
            next.epochs[key] = Math.max(next.epochs[key] ?? 0, event.epoch);
          } else {
            if (typeof event.deviceId !== 'string') throw failure('CLOUD_TOKEN_INVALID', 401);
            for (const device of Object.values(next.devices)) {
              if (device.bindingKey === key && device.cloudDeviceId === event.deviceId &&
                  (!event.jkt || event.jkt === device.jkt)) device.status = 'revoked';
            }
          }
        }
        next.watermark = Math.max(next.watermark, envelope.watermark);
      });
      await revokeInvalidSessions();
    });
    closeInvalidResponses();
  }
  async function syncRevocations() {
    if (syncing) return syncing;
    syncing = (async () => {
      for (const [id, event] of Object.entries(store.state.outbox)) {
        const { action = '/hosts/devices/revoke', ...data } = event;
        await signedRequest(action, { ...data, requestId: id });
        await context.serial(() => edit(next => { delete next.outbox[id]; }));
      }
      const result = await signedRequest('/hosts/revocations', { afterSeq: store.state.watermark });
      await applyEvents(result.eventToken);
    })().finally(() => { syncing = null; });
    return syncing;
  }
  async function revokeLocalDevice(ownerId, deviceId) {
    const session = store.state.sessions[deviceId];
    if (!session || store.state.bindings[session.bindingKey]?.ownerId !== ownerId) return;
    if (store.state.devices[session.trustId]?.status === 'revoked') return;
    await edit(next => {
      const device = next.devices[session.trustId];
      device.status = 'revoked';
      next.outbox[randomUUID()] = { sub: next.bindings[session.bindingKey].sub,
        deviceId: device.cloudDeviceId, jkt: device.jkt };
    });
    await revokeInvalidSessions();
    closeInvalidResponses();
  }
  // Access-store flags also stop queued commands before they reach DSH.
  async function revokeInvalidSessions() {
    const invalid = [];
    for (const [deviceId, session] of Object.entries(store.state.sessions)) {
      const ownerId = store.state.bindings[session.bindingKey]?.ownerId;
      if (!context.rootState.accounts[ownerId]?.devices[deviceId] ||
          context.rootState.accounts[ownerId].devices[deviceId].revoked) continue;
      try { assertSession(ownerId, deviceId); } catch { invalid.push({ ownerId, deviceId }); }
    }
    if (!invalid.length) return;
    await context.mutateRoot(next => {
      for (const { ownerId, deviceId } of invalid) {
        next.accounts[ownerId].devices[deviceId].revoked = true;
        next.accounts[ownerId].devices[deviceId].revokedAt = new Date(context.timestamp()).toISOString();
      }
    });
  }
  async function handle(request, response, url) {
    const pathname = url.pathname;
    if (!(pathname.startsWith('/personal/v1/cloud/') ||
        ['/personal/v1/auth/cloud-session', '/personal/v1/auth/cloud-nonce'].includes(pathname))) return false;
    try {
      if (url.search) throw failure('INVALID_REQUEST');
      const route = pathname.replace('/personal/v1', '');
      if (route === '/cloud/devices/pending' && request.method === 'GET') {
        const current = local(request);
        const devices = Object.entries(store.state.devices).filter(([, d]) => d.ownerId === current.ownerId && d.status === 'pending')
          .map(([id, d]) => ({ id, name: d.name, requestedAt: d.requestedAt, fingerprint: d.jkt }));
        context.json(response, 200, { devices }); return true;
      }
      if (request.method !== 'POST' && !(route === '/cloud/binding' && request.method === 'DELETE'))
        throw failure('METHOD_NOT_ALLOWED', 405);
      context.requireBrowserOrigin(request);
      const body = await context.readJson(request, 16 * 1024);
      if (route === '/auth/cloud-nonce') {
        exactKeys(body, [], []);
        const nonce = randomBytes(32).toString('base64url');
        await context.serial(() => edit(next => {
          for (const [id, expiry] of Object.entries(next.nonces)) if (expiry <= context.timestamp()) delete next.nonces[id];
          next.nonces[nonce] = context.timestamp() + 120_000;
        }));
        context.json(response, 200, { nonce, expiresIn: 120 }, { 'dpop-nonce': nonce }); return true;
      }
      if (route === '/cloud/claims') {
        local(request, true);
        exactKeys(body, [], []);
        const current = local(request, true);
        const claimId = await context.serial(() => edit(next => {
          local(request, true);
          const found = Object.entries(next.claims).find(([id, c]) => c.ownerId === current.ownerId &&
            (c.status !== 'active' || Object.values(next.bindings).some(b => b.claimId === id && b.status === 'active')));
          if (found) return found[0];
          const id = randomUUID();
          next.claims[id] = { ownerId: current.ownerId, status: 'pending' }; return id;
        }));
        const result = await callCloud('/hosts/claims', { claimId, hostId,
          publicJwk: store.state.installation.publicJwk, tlsSpki: store.state.tls.spki });
        await context.serial(() => edit(next => { next.claims[claimId].challenge = result.challenge; }));
        context.json(response, 200, { claimId, hostId, challenge: result.challenge }); return true;
      }
      if (route === '/cloud/binding' && request.method === 'POST') {
        local(request, true);
        exactKeys(body, ['claimId', 'accessToken'], ['claimId', 'accessToken']);
        const identity = await verifier.verify(body.accessToken, config.base, 'cloud:account');
        const key = bindingKey(config.issuer, identity.sub);
        const current = local(request, true);
        await context.serial(() => edit(next => {
          local(request, true);
          const claim = next.claims[body.claimId];
          if (!claim || claim.ownerId !== current.ownerId || !claim.challenge) throw failure('CLAIM_INVALID', 400);
          if (next.bindings[key] && next.bindings[key].ownerId !== current.ownerId ||
              Object.values(next.bindings).some(b => b.ownerId === current.ownerId && b.sub !== identity.sub && b.status !== 'unbound') ||
              claim.sub && claim.sub !== identity.sub) throw failure('CLOUD_BINDING_CONFLICT', 409);
          if (next.bindings[key]?.status === 'active') return;
          next.bindings[key] = { issuer: config.issuer, sub: identity.sub, ownerId: current.ownerId,
            hostId, claimId: body.claimId, status: 'pending' };
          claim.sub = identity.sub;
        }));
        const claim = store.state.claims[body.claimId];
        const proof = await new SignJWT({ claimId: body.claimId, challenge: claim.challenge, sub: identity.sub })
          .setProtectedHeader({ alg: 'ES256', typ: 'wm-host-claim+jwt' }).setIssuer(hostId)
          .setAudience(config.issuer).setIssuedAt().setExpirationTime('60s').sign(installationKey);
        await callCloud('/hosts/claims/confirm', { claimId: body.claimId, proof }, body.accessToken);
        await context.serial(() => edit(next => {
          local(request, true);
          if (next.bindings[key]?.claimId !== body.claimId || next.bindings[key].status === 'unbound')
            throw failure('CLOUD_BINDING_CONFLICT', 409);
          next.bindings[key].status = 'active'; next.claims[body.claimId].status = 'active';
        }));
        context.json(response, 200, { bound: true, ownerId: current.ownerId, hostId }); return true;
      }
      if (route === '/cloud/binding' && request.method === 'DELETE') {
        const current = local(request, true);
        exactKeys(body, [], []);
        await context.serial(async () => {
          await edit(next => {
            local(request, true);
            for (const b of Object.values(next.bindings)) if (b.ownerId === current.ownerId && b.status !== 'unbound') {
              b.status = 'unbound';
              next.outbox[randomUUID()] = { action: '/hosts/memberships/unbind', sub: b.sub, claimId: b.claimId };
            }
            for (const d of Object.values(next.devices)) if (d.ownerId === current.ownerId) d.status = 'revoked';
          });
          await revokeInvalidSessions();
        });
        closeInvalidResponses(); context.json(response, 200, { unbound: true }); return true;
      }
      const decision = /^\/cloud\/devices\/([a-f0-9-]+)\/decision$/.exec(route);
      if (decision) {
        const current = local(request);
        exactKeys(body, ['decision'], ['decision']);
        if (!['allow', 'deny'].includes(body.decision)) throw failure('INVALID_REQUEST');
        await context.serial(() => edit(next => {
          local(request);
          const device = next.devices[decision[1]];
          if (!device || device.ownerId !== current.ownerId) throw failure('NOT_FOUND', 404);
          const status = body.decision === 'allow' ? 'trusted' : 'denied';
          if (device.status !== 'pending' && device.status !== status) throw failure('DEVICE_DECISION_CONFLICT', 409);
          device.status = status;
        }));
        context.json(response, 200, { decision: body.decision }); return true;
      }
      if (route === '/cloud/pairings') {
        const current = local(request, true);
        exactKeys(body, [], []);
        const challenge = randomBytes(32).toString('base64url');
        await context.serial(() => edit(next => {
          local(request, true);
          next.pairings[digest(challenge)] = { ownerId: current.ownerId, expiresAt: context.timestamp() + 120_000 };
        }));
        context.json(response, 201, { challenge, expiresIn: 120, hostId, tlsSpki: store.state.tls.spki,
          publicJwk: store.state.installation.publicJwk, origin: context.requestAuthority(request) }); return true;
      }
      if (route === '/auth/cloud-session' || route === '/cloud/pairings/redeem') {
        const fields = ['accessToken', 'deviceName', ...(route.endsWith('/redeem') ? ['challenge'] : [])];
        exactKeys(body, fields, fields);
        if (request.headers.cookie || request.headers.authorization) throw failure('AMBIGUOUS_AUTH');
        const name = context.deviceName(body.deviceName);
        const identity = await verifier.verify(body.accessToken);
        const proof = await verifier.proof(body.accessToken, request.headers.dpop, request.method,
          `${context.requestAuthority(request)}${pathname}`);
        if (proof.jkt !== identity.cnf.jkt) throw failure('DPOP_INVALID', 401);
        const key = bindingKey(config.issuer, identity.sub);
        const result = await context.serial(async () => {
          let trustId;
          await edit(next => {
            if ((next.nonces[proof.nonce] ?? 0) <= context.timestamp() || next.replays[proof.replayId])
              throw failure('DPOP_REPLAY', 401);
            const binding = next.bindings[key];
            if (!binding || binding.status !== 'active') throw failure('CLOUD_NOT_BOUND', 403);
            if (identity.auth_epoch < (next.epochs[key] ?? 0)) throw failure('UNAUTHORIZED', 401);
            for (const [id, expiry] of Object.entries(next.replays)) if (expiry <= context.timestamp()) delete next.replays[id];
            delete next.nonces[proof.nonce]; next.replays[proof.replayId] = context.timestamp() + 120_000;
            trustId = Object.keys(next.devices).find(id => {
              const d = next.devices[id]; return d.bindingKey === key && d.jkt === proof.jkt && d.cloudDeviceId === identity.device_id;
            });
            if (!trustId) {
              trustId = randomUUID(); next.devices[trustId] = { ownerId: binding.ownerId, bindingKey: key,
                cloudDeviceId: identity.device_id, jkt: proof.jkt, publicJwk: proof.jwk, name,
                requestedAt: new Date(context.timestamp()).toISOString(), status: 'pending' };
            }
            const device = next.devices[trustId];
            if (route.endsWith('/redeem')) {
              const pairing = next.pairings[digest(body.challenge)];
              if (!pairing || pairing.expiresAt <= context.timestamp() || pairing.ownerId !== binding.ownerId)
                throw failure('PAIRING_INVALID', 401);
              delete next.pairings[digest(body.challenge)]; device.status = 'trusted';
            }
          });
          const device = store.state.devices[trustId];
          if (device.status === 'pending') return { pending: true, requestId: trustId };
          if (device.status !== 'trusted') throw failure('DEVICE_NOT_TRUSTED', 403);
          const deviceId = `device-${randomUUID()}`;
          const token = randomBytes(32).toString('base64url');
          const csrfToken = csrfForToken(token);
          const expiresAt = new Date(context.timestamp() + SESSION_MS).toISOString();
          // Journal first. A crash before access-store write leaves only an inert session reference.
          await edit(next => { next.sessions[deviceId] = { bindingKey: key, trustId, epoch: identity.auth_epoch }; });
          await context.mutate(device.ownerId, next => {
            next.devices[deviceId] = { name, tokenHash: digest(token), csrfHash: digest(csrfToken),
              scopes: ['sessions:read', 'commands:write', 'account:manage'], authKind: 'cloud', authEpoch: next.account.authEpoch,
              revoked: false, enrolledAt: new Date(context.timestamp()).toISOString(), expiresAt };
          });
          return { ...context.publicAuth(device.ownerId, deviceId,
            context.accountState(device.ownerId).devices[deviceId], csrfToken), token };
        });
        if (result.pending) context.json(response, 202, { status: 'pending_approval', requestId: result.requestId });
        else { const { token, ...body } = result;
          context.json(response, 200, body, { 'set-cookie': context.sessionCookie(token,
            context.requestAuthority(request).startsWith('https:')) }); }
        return true;
      }
      throw failure('NOT_FOUND', 404);
    } catch (error) {
      const known = CLOUD_CODES.has(error?.code);
      context.json(response, known ? error.status ?? 400 : 503,
        { error: { code: known ? error.code : 'SERVICE_UNAVAILABLE' } }); return true;
    }
  }
  return { handle, assertSession, revokeLocalDevice, applyEvents, syncRevocations, closeInvalidResponses,
    validSession(ownerId, deviceId) {
      try { assertSession(ownerId, deviceId); return true; } catch { return false; }
    },
    track(request, response) {
      if (request.method !== 'GET' && !/^\/personal\/v1\/models\/[^/]+\/chat\/completions$/.test(request.url ?? '')) return;
      try {
        context.authenticate(request, 'sessions:read');
        activeResponses.set(response, request); response.once('close', () => activeResponses.delete(response));
      } catch { /* Handler returns the authentication error. */ }
    },
    start() { void syncRevocations().catch(() => {});
      poll = setInterval(() => { void syncRevocations().catch(() => {}); }, 60_000); poll.unref(); },
    close() { clearInterval(poll); for (const response of activeResponses.keys()) response.destroy(); },
  };
}

const CLOUD_CODES = new Set(['INVALID_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'METHOD_NOT_ALLOWED',
  'ORIGIN_NOT_ALLOWED', 'UNSUPPORTED_MEDIA_TYPE', 'BODY_TOO_LARGE', 'AMBIGUOUS_AUTH', 'LOCAL_SESSION_REQUIRED',
  'CLOUD_TOKEN_INVALID', 'DPOP_INVALID', 'DPOP_REPLAY', 'CLOUD_UNAVAILABLE', 'CLOUD_BINDING_CONFLICT',
  'CLAIM_INVALID', 'CLOUD_NOT_BOUND', 'DEVICE_NOT_TRUSTED', 'DEVICE_DECISION_CONFLICT', 'PAIRING_INVALID',
  'STORAGE_UNAVAILABLE', 'SERVICE_CLOSING']);

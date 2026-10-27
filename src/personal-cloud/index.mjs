import { randomBytes, randomUUID } from 'node:crypto';
import { importJWK, SignJWT } from 'jose';
import { csrfForToken, digest, exactKeys, failure } from '../personal-access/common.mjs';
import { SESSION_MS } from '../personal-access/constants.mjs';
import { cloudConfiguration, createCloudVerifier } from './proofs.mjs';
import { openIdentity } from './storage.mjs';
import { hashPassword, validPassword } from '../personal-access/password.mjs';
import { PAIRING_MS, pairingJkt, hostCommitment, phoneCommitment, verificationCode, pairingState, pairingStatus } from './pairing.mjs';

const bindingKey = (issuer, sub) => JSON.stringify([issuer, sub]);
export function cloudIdentityFromEnvironment(env = process.env) {
    return env.WEFTMATE_CLOUD_ISSUER ? { issuer: env.WEFTMATE_CLOUD_ISSUER,
    clientId: env.WEFTMATE_CLOUD_WEB_CLIENT_ID || 'weftmate-web',
    allowInsecureLoopback: env.WEFTMATE_CLOUD_ALLOW_INSECURE_LOOPBACK === 'true' } : null;
}

export async function createHostCloudIdentity(context, options) {
  const config = cloudConfiguration(options);
  const fetcher = options.fetcher ?? fetch;
  const hostId = context.rootState.hostId;
  const store = await openIdentity(context.root, hostId);
  const verifier = createCloudVerifier(config, hostId, context.timestamp, fetcher);
  const installationKey = await importJWK(store.state.installation.privateJwk, 'ES256');
  let poll;
  let syncing = null;
  let offlineTasksSupported=false, cloudBackupSupported=false;
  let multiHostSupported=false;
  const computerLabels = new Map();
  let desktopQueue = Promise.resolve();
  const activeResponses = new Map();
  async function edit(change) {
    const next = structuredClone(store.state);
    const result = await change(next);
    await store.write(next);
    return result;
  }
  function local(request, direct = false) {
    const current = context.authenticate(request, 'account:manage');
    if (current.device.authKind === 'desktop') context.requireLocalDesktop(request);
    if (direct) {
      context.requireBrowserOrigin(request, true);
      if (!['password', 'desktop'].includes(current.device.authKind) &&
          store.state.devices[store.state.sessions[current.deviceId]?.trustId]?.isHost !== true)
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
  function deviceStatus(next, trustId, isHost = false) {
    const d = next.devices[trustId];
    next.outbox[randomUUID()] = { action: '/hosts/devices/status', sub: next.bindings[d.bindingKey].sub,
      deviceId: d.cloudDeviceId, jkt: d.jkt, status: d.status, ...(isHost ? { isHost: true } : {}) };
  }
  function trustVerifiedDevice(next, key, identity, proof, name, isHost = false, pairingConfirmed = false) {
    const binding = next.bindings[key];
    // Offlining is durable for this cloud device ID, including key rotation.
    // A legacy pairing challenge cannot turn a revoked/denied device back on.
    if (!isHost && Object.values(next.devices).some(d => d.bindingKey === key &&
        d.cloudDeviceId === identity.device_id && ['denied', 'revoked'].includes(d.status)))
      throw failure('DEVICE_NOT_TRUSTED', 403);
    if (!isHost && !pairingConfirmed) {
      const trusted = Object.values(next.devices).some(d => d.bindingKey === key && d.cloudDeviceId === identity.device_id && d.jkt === proof.jkt && d.status === 'trusted');
      const pairingOpen = Object.values(next.pairings).some(p => p.version === 2 && p.ownerId === binding.ownerId &&
        !['completed', 'cancelled', 'expired'].includes(pairingState(p, context.timestamp())));
      if (pairingOpen && !trusted || Object.values(next.devices).some(d => d.bindingKey === key &&
          d.cloudDeviceId === identity.device_id && (d.pairingRequired || d.pairedJkt && d.pairedJkt !== proof.jkt)))
        throw failure('PAIRING_CONFIRMATION_REQUIRED', 403);
    }
    if (pairingConfirmed) for (const d of Object.values(next.devices))
      if (d.bindingKey === key && d.cloudDeviceId === identity.device_id) { delete d.pairingRequired; d.pairedJkt = proof.jkt; }
    let trustId = Object.keys(next.devices).find(id => {
      const d = next.devices[id]; return d.bindingKey === key && d.jkt === proof.jkt && d.cloudDeviceId === identity.device_id;
    });
    const firstLogin = !trustId || next.devices[trustId].status === 'pending';
    const at = new Date(context.timestamp()).toISOString();
    if (!trustId) {
      trustId = randomUUID(); next.devices[trustId] = { ownerId: binding.ownerId, bindingKey: key,
        cloudDeviceId: identity.device_id, jkt: proof.jkt, publicJwk: proof.jwk, name,
        requestedAt: at, status: 'trusted' };
    }
    const device = next.devices[trustId];
    device.status = 'trusted'; device.name = name;
    device.firstLoginAt ??= at; device.lastUsedAt = at;
    if (isHost) device.isHost = true;
    if (firstLogin || isHost) deviceStatus(next, trustId, isHost);
    return { trustId, firstLogin, ownerId: binding.ownerId };
  }
  async function hostTrust(trustId) {
    const device = store.state.devices[trustId];
    const binding = store.state.bindings[device.bindingKey];
    const payload = { sub: binding.sub, hostId, deviceId: device.cloudDeviceId, jkt: device.jkt,
      tlsSpki: store.state.tls.spki, publicJwk: store.state.installation.publicJwk,
      origin: context.origin, relay: context.service.relayStatus() };
    const trustToken = await new SignJWT(payload).setProtectedHeader({ alg: 'ES256', typ: 'wm-host-trust+jwt' })
      .setIssuer(hostId).setAudience(device.jkt).setIssuedAt().setExpirationTime('120s').setJti(randomUUID()).sign(installationKey);
    return { ...payload, trustToken, expiresIn: 120 };
  }
  async function notifyNewDevice(transition, name) {
    if (!transition.firstLogin) return;
    await context.activity.record(transition.ownerId, { key: transition.trustId, type: 'system.device.signed_in',
      title: '有一台新设备登录', summary: `${name} 已登录。可以在设备设置中查看并将它下线。`, level: 'important',
      source: { deviceId: transition.trustId },
      actions: [{ kind: 'view_settings', label: '查看设备', target: { category: 'devices', deviceId: transition.trustId } }] });
  }
  async function issueSession(trustId, identity, name) {
    const device = store.state.devices[trustId];
    if (device.status !== 'trusted') throw failure('DEVICE_NOT_TRUSTED', 403);
    const deviceId = `device-${randomUUID()}`, token = randomBytes(32).toString('base64url');
    const csrfToken = csrfForToken(token);
    const expiresAt = new Date(context.timestamp() + SESSION_MS).toISOString();
    await edit(next => { next.sessions[deviceId] = { bindingKey: device.bindingKey, trustId, epoch: identity.auth_epoch }; });
    await context.mutate(device.ownerId, next => {
      next.devices[deviceId] = { name, tokenHash: digest(token), csrfHash: digest(csrfToken),
        scopes: ['sessions:read', 'commands:write', 'account:manage'], authKind: 'cloud', authEpoch: next.account.authEpoch,
        revoked: false, enrolledAt: new Date(context.timestamp()).toISOString(), expiresAt };
    });
    return { ...context.publicAuth(device.ownerId, deviceId, context.accountState(device.ownerId).devices[deviceId], csrfToken), token };
  }
  function sessionReply(response, request, result) {
    const { token, ...body } = result;
    if (request.url === '/personal/v1/auth/cloud-channel') context.json(response, 200, {...body, token});
    else context.json(response, 200, body, { 'set-cookie': context.sessionCookie(token,
      context.requestAuthority(request).startsWith('https:')) });
  }
  async function callCloud(route, body, token) {
    let response;
    try {
      response = await fetcher(`${config.base}${route}`, { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(route.startsWith('/hosts/relay/dns/') ? 125_000 : 5000), headers: { 'content-type': 'application/json',
          origin: new URL(config.issuer).origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok && route.startsWith('/hosts/relay/dns/')) throw failure(result?.error?.code ?? 'CLOUD_UNAVAILABLE', 503);
      if (!response.ok) throw failure(result?.error?.code === 'CLAIM_CONFLICT' ? 'CLOUD_BINDING_CONFLICT' : 'CLOUD_UNAVAILABLE',
        response.status === 409 ? 409 : 503);
      return result;
    } catch (error) {
      if (error.code === 'CLOUD_BINDING_CONFLICT' || error.code === 'PROXY_CONFIGURATION_INVALID' || route.startsWith('/hosts/relay/dns/') && error.code) throw error;
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
        device?.status !== 'trusted' || device.ownerId !== ownerId || device.pairedJkt && device.pairedJkt !== device.jkt ||
        session.epoch < (store.state.epochs[session.bindingKey] ?? 0)) throw failure('UNAUTHORIZED', 401);
  }
  async function applyEvents(encoded) {
    const envelope = await verifier.events(encoded);
    if (!Array.isArray(envelope.events) || !Number.isSafeInteger(envelope.watermark) || envelope.watermark < 0)
      throw failure('CLOUD_TOKEN_INVALID', 401);
    await context.serial(async () => {
      await edit(next => {
        if (envelope.memberships !== undefined) {
          if (!Array.isArray(envelope.memberships) || envelope.memberships.some(m => typeof m.sub !== 'string' || !Number.isSafeInteger(m.epoch) || m.epoch < 0))
            throw failure('CLOUD_TOKEN_INVALID', 401);
          for (const [key, binding] of Object.entries(next.bindings)) {
            if (binding.status !== 'active') continue;
            const member = envelope.memberships.find(m => m.sub === binding.sub);
            if (!member) {
              binding.status = 'unbound';
              for (const device of Object.values(next.devices)) if (device.bindingKey === key) device.status = 'revoked';
              for (const [id, event] of Object.entries(next.outbox)) if (event.sub === binding.sub) delete next.outbox[id];
            } else next.epochs[key] = Math.max(next.epochs[key] ?? 0, member.epoch);
            if(member?.computers?.length>1 && member.computers.every(c=>typeof c.hostId==='string'&&typeof c.name==='string'&&c.name.length<=128)) {
              const self=member.computers.find(c=>c.hostId===hostId);if(self)computerLabels.set(binding.ownerId,self.displayName||self.name);
            } else computerLabels.delete(binding.ownerId);
          }
        }
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
    offlineTasksSupported=envelope.capabilities?.offlineTasks===1;
    multiHostSupported=envelope.capabilities?.multiHost===1;
    cloudBackupSupported=envelope.capabilities?.cloudBackup===1;
  }
  async function syncRevocations() {
    if (syncing) {
      // A login-status write in the older sync can fail after the account was
      // deleted. This caller still needs its own authoritative membership read.
      try { await syncing; } catch {}
      // That response may have been captured before this caller's revocation.
      // Fetch a fresh authoritative snapshot even when the outbox is empty.
      return syncRevocations();
    }
    syncing = (async () => {
      // Read authoritative membership before flushing pending status records:
      // a deleted account must not leave a failing outbox blocking revocation.
      const result = await signedRequest('/hosts/revocations', { afterSeq: store.state.watermark });
      await applyEvents(result.eventToken);
      let flushed = false;
      for (const [id, event] of Object.entries(store.state.outbox)) {
        const { action = '/hosts/devices/revoke', ...data } = event;
        await signedRequest(action, { ...data, requestId: id });
        flushed = true;
        await context.serial(() => edit(next => { delete next.outbox[id]; }));
      }
      if (store.state.hostName) {
        const binding = Object.values(store.state.bindings).find(b => b.status === 'active');
        if (binding) await signedRequest('/hosts/status', { name: store.state.hostName, sub: binding.sub });
      }
      if (flushed) {
        const updated = await signedRequest('/hosts/revocations', { afterSeq: store.state.watermark });
        await applyEvents(updated.eventToken);
      }
    })().finally(() => { syncing = null; });
    return syncing;
  }
  async function revokeLocalDevice(ownerId, deviceId) {
    const session = store.state.sessions[deviceId];
    if (!session || store.state.bindings[session.bindingKey]?.ownerId !== ownerId) return;
    if (store.state.devices[session.trustId]?.status === 'revoked') return;
    await edit(next => {
      const device = next.devices[session.trustId];
      for (const item of Object.values(next.devices)) if (item.bindingKey === session.bindingKey && item.cloudDeviceId === device.cloudDeviceId)
        item.status = 'revoked';
      next.outbox[randomUUID()] = { sub: next.bindings[session.bindingKey].sub,
        deviceId: device.cloudDeviceId, jkt: device.jkt };
      deviceStatus(next, session.trustId);
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
        ['/personal/v1/auth/cloud-session', '/personal/v1/auth/cloud-nonce', '/personal/v1/auth/cloud-desktop',
          '/personal/v1/auth/cloud-offline', '/personal/v1/auth/cloud-channel'].includes(pathname))) return false;
    try {
      if (url.search) throw failure('INVALID_REQUEST');
      const route = pathname.replace('/personal/v1', '');
      if (route === '/cloud/config' && request.method === 'GET') {
        context.json(response, 200, { issuer: config.issuer, hostId,
          clientId: options.clientId || 'weftmate-web', capabilities: { cloudChannel: 1, offlinePhoneFirst: 1 } }); return true;
      }
      if (route === '/cloud/binding' && request.method === 'GET') {
        const current = local(request);
        const binding = Object.values(store.state.bindings).find(b => b.ownerId === current.ownerId && b.status !== 'unbound');
        context.json(response, 200, { status: binding?.status || 'unbound',
          canManage: current.via === 'cookie' && (['password', 'desktop'].includes(current.device.authKind) ||
            store.state.devices[store.state.sessions[current.deviceId]?.trustId]?.isHost === true) &&
            context.requestAuthority(request) === context.origin &&
            !Object.keys(request.headers).some(k => k === 'forwarded' || k.startsWith('x-forwarded-')), hostId }); return true;
      }
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
      if (route === '/auth/cloud-offline') {
        context.requireBrowserOrigin(request, true);
        exactKeys(body, ['cloudAccountId','password','deviceName'], ['cloudAccountId','password','deviceName']);
        const binding = store.state.bindings[bindingKey(config.issuer, body.cloudAccountId)];
        if (!binding?.desktop || !binding.emergencyPasswordSet) throw failure('UNAUTHORIZED', 401);
        sessionReply(response, request, await context.loginAccount({
          username: context.accountState(binding.ownerId).account.username,
          password: body.password, deviceName: body.deviceName })); return true;
      }
      if (route === '/cloud/emergency-password') {
        const current = local(request, true);
        exactKeys(body, ['password'], ['password']);
        const binding = Object.values(store.state.bindings).find(b => b.ownerId === current.ownerId && b.desktop && b.status === 'active');
        if (!binding || binding.emergencyPasswordSet || !['cloud', 'desktop'].includes(current.device.authKind)) throw failure('FORBIDDEN', 403);
        if (!validPassword(body.password)) throw failure('INVALID_REQUEST');
        const password = await context.hashWork(() => hashPassword(body.password));
        await context.serial(async () => {
          local(request, true);
          if (store.state.bindings[bindingKey(binding.issuer, binding.sub)].emergencyPasswordSet) throw failure('FORBIDDEN', 403);
          await context.mutate(current.ownerId, next => { next.account.password = password; });
          await edit(next => { next.bindings[bindingKey(binding.issuer, binding.sub)].emergencyPasswordSet = true; });
        });
        context.json(response, 200, { configured: true }); return true;
      }
      if (route === '/auth/cloud-nonce') {
        exactKeys(body, [], []);
        const nonce = randomBytes(32).toString('base64url');
        await context.serial(() => edit(next => {
          for (const [id, expiry] of Object.entries(next.nonces)) if (expiry <= context.timestamp()) delete next.nonces[id];
          next.nonces[nonce] = context.timestamp() + 120_000;
        }));
        context.json(response, 200, { nonce, expiresIn: 120 }, { 'dpop-nonce': nonce }); return true;
      }
      if (route === '/auth/cloud-desktop') {
        context.requireLocalDesktop(request);
        const current = local(request, true);
        if (current.device.authKind !== 'desktop') throw failure('LOCAL_SESSION_REQUIRED', 403);
        exactKeys(body, ['accessToken','deviceName'], ['accessToken','deviceName']);
        if (request.headers.authorization) throw failure('AMBIGUOUS_AUTH');
        const name = context.deviceName(body.deviceName);
        const identity = await verifier.verify(body.accessToken, config.base, 'cloud:account');
        const proof = await verifier.proof(body.accessToken, request.headers.dpop, 'POST', `${context.origin}${pathname}`);
        if (proof.jkt !== identity.cnf?.jkt) throw failure('DPOP_INVALID', 401);
        await context.serial(() => edit(next => {
          if ((next.nonces[proof.nonce] ?? 0) <= context.timestamp() || next.replays[proof.replayId])
            throw failure('DPOP_REPLAY', 401);
          delete next.nonces[proof.nonce]; next.replays[proof.replayId] = context.timestamp() + 120000;
        }));
        const task = desktopQueue.then(async () => {
          const key = bindingKey(config.issuer, identity.sub);
          let binding = store.state.bindings[key];
          if (binding?.status === 'unbound') {
            if(binding.ownerId !== current.ownerId)throw failure('CLOUD_BINDING_CONFLICT',409);
            await context.serial(()=>edit(next=>{next.bindings[key].status='pending';}));
            binding=store.state.bindings[key];
          }
          if (binding && binding.ownerId !== current.ownerId ||
              Object.values(store.state.bindings).some(b => b.ownerId === current.ownerId && b.sub !== identity.sub && b.status !== 'unbound'))
            throw failure('CLOUD_BINDING_CONFLICT', 409);
          if (identity.auth_epoch < (store.state.epochs[key] ?? 0)) throw failure('UNAUTHORIZED', 401);
          if (!binding) {
            // The native window has already selected its existing local owner.
            // Cloud login attaches to that owner; it never substitutes an empty
            // account or infers ownership from an email address.
            const claimId = randomUUID();
            await context.serial(async () => {
              local(request, true);
              await edit(next => {
                next.bindings[key] = { issuer: config.issuer, sub: identity.sub, ownerId: current.ownerId,
                  hostId, claimId, status: 'pending', desktop: true };
                next.claims[claimId] = { ownerId: current.ownerId, sub: identity.sub, status: 'pending' };
              });
            });
            binding = store.state.bindings[key];
          }
          if (binding.status !== 'active') {
            const claim = await callCloud('/hosts/claims', { claimId: binding.claimId, hostId,
              publicJwk: store.state.installation.publicJwk, tlsSpki: store.state.tls.spki });
            const signature = await new SignJWT({ claimId: binding.claimId, challenge: claim.challenge, sub: identity.sub })
              .setProtectedHeader({ alg: 'ES256', typ: 'wm-host-claim+jwt' }).setIssuer(hostId)
              .setAudience(config.issuer).setIssuedAt().setExpirationTime('60s').sign(installationKey);
            await callCloud('/hosts/claims/confirm', { claimId: binding.claimId, proof: signature }, body.accessToken);
          }
          return context.serial(async () => {
            let transition;
            await edit(next => {
              local(request, true);
              if (next.bindings[key]?.ownerId !== current.ownerId || next.bindings[key].status === 'unbound')
                throw failure('CLOUD_BINDING_CONFLICT', 409);
              next.bindings[key].status = 'active'; next.bindings[key].desktop = true;
              next.claims[binding.claimId].status = 'active';
              next.epochs[key] = Math.max(next.epochs[key] ?? 0, identity.auth_epoch); next.hostName = name;
              transition = trustVerifiedDevice(next, key, identity, proof, name, true);
            });
            return transition;
          });
        });
        desktopQueue = task.catch(() => {});
        const transition = await task;
        await notifyNewDevice(transition, name);
        const result = context.publicAuth(current.ownerId, current.deviceId, current.device, current.csrfToken);
        context.json(response, 200, { ...result, hostTrust: await hostTrust(transition.trustId), cloudAuthenticated: true });
        void syncRevocations().catch(() => {}); return true;
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
        await context.serial(async () => {
          await edit(next => {
            local(request, true);
            if (next.bindings[key]?.claimId !== body.claimId || next.bindings[key].status === 'unbound')
              throw failure('CLOUD_BINDING_CONFLICT', 409);
            next.bindings[key].status = 'active'; next.claims[body.claimId].status = 'active';
            next.epochs[key] = Math.max(next.epochs[key] ?? 0, identity.auth_epoch);
          });
          await revokeInvalidSessions();
          closeInvalidResponses();
        });
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
          deviceStatus(next, decision[1]);
        }));
        void syncRevocations().catch(() => {});
        context.json(response, 200, { decision: body.decision }); return true;
      }
      const trust = /^\/cloud\/devices\/([a-f0-9-]+)\/trust$/.exec(route);
      if (trust) {
        const current = local(request);
        exactKeys(body, [], []);
        const device = store.state.devices[trust[1]];
        if (!device || device.ownerId !== current.ownerId) throw failure('NOT_FOUND', 404);
        if (device.status !== 'trusted') throw failure('DEVICE_NOT_TRUSTED', 403);
        context.json(response, 200, await hostTrust(trust[1])); return true;
      }
      if (route === '/cloud/pairings') {
        const current = local(request, true);
        exactKeys(body, [], []);
        const challenge = randomBytes(32).toString('base64url');
        const result = await context.serial(() => edit(next => {
          local(request, true);
          const binding = Object.values(next.bindings).find(b => b.ownerId === current.ownerId && b.status === 'active');
          if (!binding) throw failure('CLOUD_NOT_BOUND', 403);
          for (const [id, p] of Object.entries(next.pairings)) {
            if (p.expiresAt < context.timestamp() - 600_000) delete next.pairings[id];
            else if (p.ownerId === current.ownerId && p.state !== 'completed') p.state = 'cancelled';
          }
          const expiresAt = context.timestamp() + PAIRING_MS, origin = context.requestAuthority(request), relay = context.service.relayStatus();
          const transcript = [2, config.issuer, binding.sub, hostId, next.tls.spki, pairingJkt(next.installation.publicJwk),
            challenge, expiresAt, origin, relay?.baseUrl || ''];
          const hostNonce = randomBytes(32).toString('base64url');
          next.pairings[digest(challenge)] = { version: 2, ownerId: current.ownerId, expiresAt, transcript, hostNonce, state: 'waiting' };
          return { version: 2, challenge, expiresIn: 120, expiresAt, hostId, tlsSpki: next.tls.spki,
            publicJwk: next.installation.publicJwk, origin, relay, issuer: config.issuer, sub: binding.sub,
            hostCommitment: hostCommitment(transcript, hostNonce) };
        }));
        context.json(response, 201, result); return true;
      }
      if (route === '/cloud/pairings/status' || route === '/cloud/pairings/decision') {
        const current = local(request, true), decision = route.endsWith('/decision');
        exactKeys(body, decision ? ['challenge', 'decision', 'verificationCode'] : ['challenge'], decision ? ['challenge', 'decision'] : ['challenge']);
        if (typeof body.challenge !== 'string' || decision && !['confirm', 'cancel'].includes(body.decision)) throw failure('INVALID_REQUEST');
        const result = await context.serial(() => edit(next => {
          local(request, true);
          const p = next.pairings[digest(body.challenge)];
          if (!p || p.version !== 2 || p.ownerId !== current.ownerId) throw failure('PAIRING_INVALID', 401);
          if (decision) {
            const state = pairingState(p, context.timestamp());
            if (['completed', 'cancelled', 'expired'].includes(state)) throw failure('PAIRING_INVALID', 401);
            if (body.decision === 'cancel') p.state = 'cancelled';
            else {
              if (state !== 'comparing' || body.verificationCode !== verificationCode(p)) throw failure('PAIRING_CONFLICT', 409);
              const binding = next.bindings[bindingKey(config.issuer, p.transcript[2])];
              if (binding?.status !== 'active' || binding.ownerId !== current.ownerId) throw failure('CLOUD_NOT_BOUND', 403);
              p.state = 'confirmed';
            }
          }
          return pairingStatus(p, context.timestamp());
        }));
        context.json(response, 200, result); return true;
      }
      const pairingAction = /^\/cloud\/pairings\/(join|reveal|redeem)$/.exec(route)?.[1];
      if (route === '/auth/cloud-session' || route === '/auth/cloud-channel' || pairingAction) {
        const fields = ['accessToken', 'deviceName', ...(pairingAction ? ['challenge'] : []),
          ...(pairingAction === 'join' ? ['phoneCommitment'] : pairingAction === 'reveal' ? ['phoneNonce'] : [])];
        exactKeys(body, fields, fields);
        if (pairingAction && (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge) ||
            pairingAction === 'join' && !/^[A-Za-z0-9_-]{43}$/.test(body.phoneCommitment) ||
            pairingAction === 'reveal' && !/^[A-Za-z0-9_-]{43}$/.test(body.phoneNonce))) throw failure('INVALID_REQUEST');
        // Browsers cannot remove a revoked HttpOnly Cookie. It is never used as
        // exchange authority; only the verified cloud token and device proof count.
        if (request.headers.authorization) throw failure('AMBIGUOUS_AUTH');
        const name = context.deviceName(body.deviceName);
        const identity = await verifier.verify(body.accessToken);
        const proof = await verifier.proof(body.accessToken, request.headers.dpop, request.method,
          `${context.requestAuthority(request)}${pathname}`);
        if (proof.jkt !== identity.cnf.jkt) throw failure('DPOP_INVALID', 401);
        const key = bindingKey(config.issuer, identity.sub);
        const result = await context.serial(async () => {
          let transition, pending;
          await edit(next => {
            if ((next.nonces[proof.nonce] ?? 0) <= context.timestamp() || next.replays[proof.replayId])
              throw failure('DPOP_REPLAY', 401);
            const binding = next.bindings[key];
            if (!binding || binding.status !== 'active') throw failure('CLOUD_NOT_BOUND', 403);
            if (identity.auth_epoch < (next.epochs[key] ?? 0)) throw failure('UNAUTHORIZED', 401);
            for (const [id, expiry] of Object.entries(next.replays)) if (expiry <= context.timestamp()) delete next.replays[id];
            delete next.nonces[proof.nonce]; next.replays[proof.replayId] = context.timestamp() + 120_000;
            if (pairingAction) {
              const p = next.pairings[digest(body.challenge)];
              if (!p || p.version !== 2 || p.expiresAt <= context.timestamp() || p.ownerId !== binding.ownerId || p.transcript[2] !== identity.sub ||
                  ['cancelled', 'completed'].includes(p.state))
                throw failure('PAIRING_INVALID', 401);
              if (pairingAction === 'join') {
                if (p.phone && (p.phone.deviceId !== identity.device_id || p.phone.jkt !== proof.jkt || p.phone.commitment !== body.phoneCommitment))
                  throw failure('PAIRING_CONFLICT', 409);
                if (!p.phone) {
                  if (Object.values(next.devices).some(d => d.bindingKey === key && d.cloudDeviceId === identity.device_id && ['denied', 'revoked'].includes(d.status)))
                    throw failure('DEVICE_NOT_TRUSTED', 403);
                  p.phone = { deviceId: identity.device_id, jkt: proof.jkt, commitment: body.phoneCommitment, name };
                  p.state = 'committed';
                  let device = Object.values(next.devices).find(d => d.bindingKey === key && d.cloudDeviceId === identity.device_id && d.jkt === proof.jkt);
                  if (!device) next.devices[randomUUID()] = device = { ownerId: binding.ownerId, bindingKey: key,
                    cloudDeviceId: identity.device_id, jkt: proof.jkt, publicJwk: proof.jwk, name,
                    requestedAt: new Date(context.timestamp()).toISOString(), status: 'pending' };
                  device.pairingRequired = true;
                }
              } else {
                if (!p.phone || p.phone.deviceId !== identity.device_id || p.phone.jkt !== proof.jkt) throw failure('PAIRING_INVALID', 401);
                if (pairingAction === 'reveal') {
                  if (phoneCommitment(body.challenge, identity.device_id, proof.jkt, body.phoneNonce) !== p.phone.commitment) throw failure('PAIRING_INVALID', 401);
                  if (p.state === 'committed') { p.phone.nonce = body.phoneNonce; p.state = 'comparing'; }
                } else {
                  if (p.state !== 'confirmed') throw failure('PAIRING_CONFIRMATION_REQUIRED', 403);
                  p.state = 'completed';
                }
              }
              if (pairingAction !== 'redeem') { pending = { state: p.state, hostNonce: p.hostNonce, expiresAt: p.expiresAt }; return; }
            }
            transition = trustVerifiedDevice(next, key, identity, proof, name, false, pairingAction === 'redeem');
          });
          if (pending) return { pending };
          return { session: await issueSession(transition.trustId, identity, name), transition };
        });
        if (result.pending) { context.json(response, 200, result.pending); return true; }
        closeInvalidResponses();
        await notifyNewDevice(result.transition, name);
        void syncRevocations().catch(() => {});
        sessionReply(response, request, { ...result.session, hostTrust: await hostTrust(result.transition.trustId) });
        return true;
      }
      throw failure('NOT_FOUND', 404);
    } catch (error) {
      const known = CLOUD_CODES.has(error?.code);
      context.json(response, known ? error.status ?? 400 : 503,
        { error: { code: known ? error.code : 'SERVICE_UNAVAILABLE' } }); return true;
    }
  }
  return { browserConfiguration: () => ({ issuer: config.issuer }),
    offlineAccount(sub,cloudDeviceId,jkt) {
      for(const [deviceId,session] of Object.entries(store.state.sessions)){
        const binding=store.state.bindings[session.bindingKey],device=store.state.devices[session.trustId];
        if(binding?.sub===sub&&device?.cloudDeviceId===cloudDeviceId&&device.jkt===jkt){
          try{assertSession(binding.ownerId,deviceId);return {ownerId:binding.ownerId,deviceId};}catch{}
        }
      }
      return null;
    },
    offlineSource(ownerId,cloudDeviceId,jkt) {
      const binding=Object.values(store.state.bindings).find(b=>b.ownerId===ownerId&&b.status==='active');
      const source=binding&&this.offlineAccount(binding.sub,cloudDeviceId,jkt);
      return source?.deviceId;
    },
    async eraseLocalAccount(ownerId, removeBinding, keepDeviceId) {
      await edit(next => {
        const bindings = new Set(Object.entries(next.bindings).filter(([,row])=>row.ownerId===ownerId).map(([id])=>id));
        for (const [id,row] of Object.entries(next.sessions)) if (bindings.has(row.bindingKey) && (removeBinding || id !== keepDeviceId)) delete next.sessions[id];
        const keepTrust = next.sessions[keepDeviceId]?.trustId;
        for (const [id,row] of Object.entries(next.devices)) if (row.ownerId===ownerId && (removeBinding || id!==keepTrust)) delete next.devices[id];
        for (const [id,row] of Object.entries(next.pairings)) if (row.ownerId===ownerId) delete next.pairings[id];
        if (removeBinding) for (const id of bindings) { delete next.bindings[id]; delete next.epochs[id]; }
      });
      closeInvalidResponses();
    },
    offlineDeviceId(ownerId, deviceId) {
      if (context.accountState(ownerId).devices[deviceId]?.authKind !== 'cloud') return deviceId;
      assertSession(ownerId, deviceId);
      return store.state.sessions[deviceId].trustId;
    },
    async publishOffline(ownerId, generation) {
      const binding = Object.values(store.state.bindings).find(item => item.ownerId === ownerId && item.status === 'active');
      if (!binding) throw failure('CLOUD_NOT_BOUND', 409);
      const result=await signedRequest('/hosts/offline/publish', { sub: binding.sub, generation });
      offlineTasksSupported=result.capabilities?.offlineTasks===1;
      cloudBackupSupported=result.capabilities?.cloudBackup===1;
      return { url: `${config.base}/hosts/offline/status`, hostId, accountId: binding.sub, generation, ...(offlineTasksSupported?{capabilities:{offlineTasks:1}}:{}) };
    },
    isInstallationOwner: ownerId => Object.values(store.state.bindings).some(binding => binding.ownerId === ownerId && binding.desktop === true && binding.status === 'active'),
    // Any active binding counts: accounts bound through the claim flow have no `desktop` flag but still need the relay.
    relayReady: () => Object.values(store.state.bindings).some(binding => binding.status === 'active'),
    tls: () => structuredClone(store.state.tls), relayRequest: signedRequest, handle, assertSession, revokeLocalDevice, applyEvents, syncRevocations, closeInvalidResponses,
    offlineTasksSupported:()=>offlineTasksSupported,
    computerLabel:ownerId=>computerLabels.get(ownerId),
    cloudBackupSupported:()=>cloudBackupSupported,
    backupAccount(ownerId) {
      const binding=Object.values(store.state.bindings).find(b=>b.ownerId===ownerId&&b.status==='active');
      return binding ? { accountId:binding.sub, issuer:binding.issuer } : null;
    },
    async backupRequest(ownerId, action, body={}) {
      if (!cloudBackupSupported) throw failure('CLOUD_BACKUP_UNAVAILABLE',503);
      const account=this.backupAccount(ownerId);
      if (!account || !/^\/backups\/(?:key\/(?:read|write)|start|chunk\/(?:upload|download)|complete|list|delete|clear)$/.test(action)) throw failure('CLOUD_NOT_BOUND',409);
      const proof=await new SignJWT({...body,sub:account.accountId,action}).setProtectedHeader({alg:'ES256',typ:'wm-host-request+jwt'})
        .setIssuer(hostId).setAudience(config.issuer).setIssuedAt().setExpirationTime('60s').setJti(randomUUID()).sign(installationKey);
      let response;
      try { response=await fetcher(`${config.base}${action}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
        headers:{'content-type':'application/json',origin:new URL(config.issuer).origin},body:JSON.stringify({hostId,proof})}); }
      catch { throw failure('CLOUD_UNAVAILABLE',503); }
      const result=await response.json();
      if (!response.ok) throw Object.assign(failure(result.error?.code ?? 'CLOUD_UNAVAILABLE',response.status),{usage:result.error?.details?.usage ?? result.error?.usage ?? result.usage});
      return result;
    },
    cloudDeviceId(ownerId, deviceId) {
      const session = store.state.sessions[deviceId], device = store.state.devices[session?.trustId];
      return device?.ownerId === ownerId ? device.cloudDeviceId : undefined;
    },
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
  'CLOUD_TOKEN_INVALID', 'CLOUD_DEVICE_VERIFICATION_REQUIRED', 'DPOP_INVALID', 'DPOP_REPLAY', 'CLOUD_UNAVAILABLE', 'CLOUD_BINDING_CONFLICT',
  'CLAIM_INVALID', 'CLOUD_NOT_BOUND', 'DEVICE_NOT_TRUSTED', 'DEVICE_DECISION_CONFLICT', 'PAIRING_INVALID', 'PAIRING_CONFLICT', 'PAIRING_CONFIRMATION_REQUIRED',
  'INVALID_CREDENTIALS', 'LOGIN_RATE_LIMITED', 'DEVICE_LIMIT', 'CAPACITY_LIMIT', 'ACCOUNT_ALREADY_EXISTS',
  'STORAGE_UNAVAILABLE', 'SERVICE_CLOSING']);

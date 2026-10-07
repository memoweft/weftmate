import { csrfForToken, digest, exactKeys, failure, id } from './common.mjs';
import {
  COOKIE,
  CSRF_HEADER,
  LEGACY_SCOPES,
  MAX_ACCOUNTS,
  MAX_ACTIVE_PASSWORD_DEVICES,
  MAX_BODY,
  SESSION_MS,
  SETUP_GRANT_MS,
  SINGLE_ACCOUNT_VERSION
} from './constants.mjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { avatarImage, displayName, publicProfile } from './profile.mjs';
import { hashPassword, normalizeUsername, validPassword, verifyPassword } from './password.mjs';
import { createPersonalSyncStore } from '../personal-sync/index.mjs';
import { createAttachmentStore } from '../personal-sync/attachments.mjs';
import path from 'node:path';
import { createSharedAttachmentStore } from './shared-attachments.mjs';

export function createAuthenticationOperations(context) {
  function hashWork(task) {
    if (context.queuedHashes >= 4) throw failure('LOGIN_RATE_LIMITED', 429);
    context.queuedHashes++;
    const result = context.hashQueue.then(task);
    context.hashQueue = result.catch(() => {});
    return result.finally(() => { context.queuedHashes--; });
  }

  function requestAuthority(request) {
    const host = request.headers.host;
    if (typeof host !== 'string') return null;
    if (host === new URL(context.origin).host) {
      return Object.keys(request.headers).some((key) => key === 'forwarded' || key.startsWith('x-forwarded-'))
        ? null : context.origin;
    }
    const configured = context.allowedOrigins.find((candidate) => new URL(candidate).host === host);
    if (!configured || !context.trustedProxy || request.headers.forwarded !== undefined ||
        !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(request.socket.remoteAddress) ||
        request.headers['x-forwarded-proto'] !== 'https' ||
        request.headers['x-forwarded-host'] !== host) return null;
    return configured;
  }

  function matchingOrigin(request) {
    const authority = requestAuthority(request);
    const supplied = request.headers.origin;
    return typeof supplied === 'string' && supplied === authority ? authority : null;
  }

  function requireBrowserOrigin(request, setup = false) {
    const matched = matchingOrigin(request);
    if (!matched) throw failure('ORIGIN_NOT_ALLOWED', 403);
    if (setup && (matched !== context.origin || request.headers.host !== new URL(context.origin).host ||
        Object.keys(request.headers).some((key) => key === 'forwarded' || key.startsWith('x-forwarded-')))) {
      throw failure('ORIGIN_NOT_ALLOWED', 403);
    }
    return matched;
  }

  function cookieToken(request) {
    const header = request.headers.cookie;
    if (typeof header !== 'string' || header.length > 4096) return null;
    const matches = header.split(';').map((item) => item.trim())
      .filter((item) => item.startsWith(`${COOKIE}=`));
    if (matches.length !== 1) return null;
    const token = matches[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{40,128}$/.test(token) ? token : null;
  }

  function ownerForRequest(request) {
    const bearer = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(request.headers.authorization ?? '');
    const token = bearer?.[1] ?? cookieToken(request);
    if (!token) return null;
    const hash = Buffer.from(digest(token), 'hex');
    for (const [ownerId, account] of Object.entries(context.rootState.accounts)) {
      if (Object.values(account.devices).some((device) => {
        const stored = Buffer.from(device.tokenHash, 'hex');
        return stored.length === hash.length && timingSafeEqual(stored, hash);
      })) return ownerId;
    }
    return null;
  }

  function authenticate(request, scope) {
    const authorization = request.headers.authorization;
    const fromCookie = cookieToken(request);
    const namedCookie = typeof request.headers.cookie === 'string' &&
      request.headers.cookie.split(';').some((item) => item.trim().startsWith(`${COOKIE}=`));
    if (authorization !== undefined && namedCookie) throw failure('AMBIGUOUS_AUTH');
    let token;
    let via;
    if (authorization !== undefined) {
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]+$/.test(authorization)) {
        throw failure('UNAUTHORIZED', 401);
      }
      token = authorization.slice(7);
      via = 'bearer';
    } else if (fromCookie !== null) {
      token = fromCookie;
      via = 'cookie';
    } else throw failure('UNAUTHORIZED', 401);
    const ownerId = ownerForRequest(request);
    if (ownerId === null) throw failure('UNAUTHORIZED', 401);
    const state = context.accountState(ownerId);
    const hash = Buffer.from(digest(token), 'hex');
    const selected = Object.entries(state.devices).find(([, item]) => {
      const stored = Buffer.from(item.tokenHash, 'hex');
      return stored.length === hash.length && timingSafeEqual(stored, hash);
    });
    if (!selected || selected[1].revoked) throw failure('UNAUTHORIZED', 401);
    const [deviceId, device] = selected;
    if (device.authKind === 'cloud') {
      if (!context.cloudIdentity || Date.parse(device.expiresAt) <= context.timestamp() ||
          state.account === null || device.authEpoch !== state.account.authEpoch) throw failure('UNAUTHORIZED', 401);
      context.cloudIdentity.assertSession(ownerId, deviceId);
    }
    if (device.authKind === 'password' &&
        (Date.parse(device.expiresAt) <= context.timestamp() || state.account === null ||
          device.authEpoch !== state.account.authEpoch)) throw failure('UNAUTHORIZED', 401);
    if (!device.scopes.includes(scope) || (scope === 'account:manage' && via !== 'cookie')) {
      throw failure('FORBIDDEN', 403);
    }
    if (via === 'cookie' && ['POST', 'DELETE', 'PATCH', 'PUT'].includes(request.method)) {
      requireBrowserOrigin(request);
      const csrf = request.headers[CSRF_HEADER];
      if (typeof csrf !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(csrf) ||
          !device.csrfHash || !timingSafeEqual(Buffer.from(digest(csrf), 'hex'), Buffer.from(device.csrfHash, 'hex'))) {
        throw failure('FORBIDDEN', 403);
      }
    }
    return { ownerId, deviceId, device, via,
      csrfToken: via === 'cookie' ? csrfForToken(token) : null };
  }

  function json(response, status, value, headers = {}) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    });
    response.end(JSON.stringify(value));
  }

  function sessionCookie(token, secure) {
    return `${COOKIE}=${token}; Path=/personal/v1; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  }

  function clearCookie(secure) {
    return `${COOKIE}=; Path=/personal/v1; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  }

  function newPasswordDevice(next, name, at) {
    if (Object.values(next.devices).filter((device) => device.authKind === 'password' && !device.revoked &&
        Date.parse(device.expiresAt) > at && device.authEpoch === next.account.authEpoch).length >= MAX_ACTIVE_PASSWORD_DEVICES) {
      throw failure('DEVICE_LIMIT', 429);
    }
    const deviceId = `device-${randomUUID()}`;
    const token = randomBytes(32).toString('base64url');
    const csrfToken = csrfForToken(token);
    const expiresAt = new Date(at + SESSION_MS).toISOString();
    next.devices[deviceId] = {
      name, tokenHash: digest(token), csrfHash: digest(csrfToken),
      scopes: ['sessions:read', 'commands:write', 'account:manage'],
      revoked: false, enrolledAt: new Date(at).toISOString(),
      authKind: 'password', authEpoch: next.account.authEpoch, expiresAt,
    };
    return { deviceId, token, csrfToken, expiresAt };
  }

  function rotatePasswordDevice(next, deviceId, at) {
    const device = next.devices[deviceId];
    const token = randomBytes(32).toString('base64url');
    const csrfToken = csrfForToken(token);
    const expiresAt = new Date(at + SESSION_MS).toISOString();
    device.tokenHash = digest(token);
    device.csrfHash = digest(csrfToken);
    device.authEpoch = next.account.authEpoch;
    device.expiresAt = expiresAt;
    device.lastSeenAt = new Date(at).toISOString();
    device.revoked = false;
    delete device.revokedAt;
    return { deviceId, token, csrfToken, expiresAt };
  }

  function publicAuth(ownerId, deviceId, device, csrfToken) {
    return { account: { ...publicProfile(context.accountState(ownerId).account), ownerId },
      device: { id: deviceId, name: device.name, expiresAt: device.expiresAt },
      csrfToken };
  }

  async function readJson(request, maxBytes = MAX_BODY) {
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
      throw failure('UNSUPPORTED_MEDIA_TYPE', 415);
    }
    let length = 0;
    const parts = [];
    for await (const part of request) {
      length += part.length;
      if (length > maxBytes) throw failure('BODY_TOO_LARGE', 413);
      parts.push(part);
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw failure('INVALID_REQUEST'); }
  }

  function deviceName(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) throw failure('INVALID_REQUEST');
    return value.trim();
  }

  function assertLoginWindow(ownerId) {
    if (context.accountState(ownerId).authLimits.lockUntil > context.timestamp()) throw failure('LOGIN_RATE_LIMITED', 429);
  }

  async function recordFailedPassword(ownerId, at) {
    await context.mutate(ownerId, (next) => {
      const limits = next.authLimits;
      limits.failures = at - limits.lastFailureAt > 15 * 60 * 1000 ? 1 : limits.failures + 1;
      limits.lastFailureAt = at;
      limits.lockUntil = limits.failures >= 5
        ? at + Math.min(15 * 60 * 1000, 30_000 * 2 ** Math.min(limits.failures - 5, 5)) : 0;
    });
  }

  async function setupAccount(body) {
    const ownerId = context.rootState.legacyOwnerId;
    exactKeys(body, ['grant', 'username', 'password', 'deviceName'],
      ['grant', 'username', 'password', 'deviceName']);
    const user = normalizeUsername(body.username);
    const name = deviceName(body.deviceName);
    if (!user || !validPassword(body.password) || typeof body.grant !== 'string' ||
        !/^[A-Za-z0-9_-]{40,128}$/.test(body.grant)) throw failure('INVALID_REQUEST');
    if (context.accountState(ownerId).account !== null) throw failure('ACCOUNT_ALREADY_CONFIGURED', 409);
    if (Object.values(context.rootState.accounts).some((entry) =>
      entry.account?.usernameCanonical === user.canonical)) throw failure('ACCOUNT_ALREADY_EXISTS', 409);
    const grant = context.accountState(ownerId).setupGrant;
    if (!grant || grant.expiresAt <= context.timestamp() ||
        !timingSafeEqual(Buffer.from(digest(body.grant), 'hex'), Buffer.from(grant.hash, 'hex'))) {
      throw failure('INVALID_SETUP_GRANT', 401);
    }
    const password = await hashWork(() => hashPassword(body.password));
    const result = await context.serial(() => context.mutate(ownerId, (next) => {
      if (next.account !== null) throw failure('ACCOUNT_ALREADY_CONFIGURED', 409);
      if (Object.values(context.rootState.accounts).some((entry) =>
        entry.account?.usernameCanonical === user.canonical)) throw failure('ACCOUNT_ALREADY_EXISTS', 409);
      if (!next.setupGrant || next.setupGrant.expiresAt <= context.timestamp() ||
          !timingSafeEqual(Buffer.from(digest(body.grant), 'hex'), Buffer.from(next.setupGrant.hash, 'hex'))) {
        throw failure('INVALID_SETUP_GRANT', 401);
      }
      const at = context.timestamp();
      next.account = { username: user.display, usernameCanonical: user.canonical,
        password, authEpoch: 1, displayName: user.display, avatar: null, profileRevision: 0 };
      next.setupGrant = null;
      next.authLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
      for (const device of Object.values(next.devices)) {
        device.revoked = true;
        device.revokedAt = new Date(at).toISOString();
      }
      return newPasswordDevice(next, name, at);
    }));
    return { ...publicAuth(ownerId, result.deviceId,
      context.accountState(ownerId).devices[result.deviceId], result.csrfToken), token: result.token };
  }

  async function registerAccount(body) {
    exactKeys(body, ['username', 'password', 'deviceName', 'displayName'],
      ['username', 'password', 'deviceName']);
    const user = normalizeUsername(body.username);
    const name = deviceName(body.deviceName);
    if (!user || !validPassword(body.password)) throw failure('INVALID_REQUEST');
    const nickname = body.displayName === undefined ? user.display : displayName(body.displayName);
    if (Object.values(context.rootState.accounts).some((entry) => entry.account?.usernameCanonical === user.canonical)) {
      throw failure('ACCOUNT_ALREADY_EXISTS', 409);
    }
    if (context.registeredAccountCount() >= MAX_ACCOUNTS) throw failure('CAPACITY_LIMIT', 429);
    const password = await hashWork(() => hashPassword(body.password));
    const ownerId = `owner-${randomUUID()}`;
    const newSync = await createPersonalSyncStore({ root: context.syncRoot(ownerId), ownerId });
    let result;
    try {
      result = await context.serial(() => context.mutateRoot((nextRoot) => {
        if (Object.values(nextRoot.accounts).some((entry) => entry.account?.usernameCanonical === user.canonical)) {
          throw failure('ACCOUNT_ALREADY_EXISTS', 409);
        }
        if (Object.values(nextRoot.accounts).filter((entry) => entry.account !== null).length >= MAX_ACCOUNTS) {
          throw failure('CAPACITY_LIMIT', 429);
        }
        if (Object.hasOwn(nextRoot.accounts, ownerId)) throw failure('ACCOUNT_ALREADY_EXISTS', 409);
        const next = { version: SINGLE_ACCOUNT_VERSION, hostId: nextRoot.hostId, ownerId,
          account: { username: user.display, usernameCanonical: user.canonical,
            password, authEpoch: 1, displayName: nickname, avatar: null, profileRevision: 0 },
          setupGrant: null, authLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 },
          devices: {}, sessions: {}, commands: {} };
        const device = newPasswordDevice(next, name, context.timestamp());
        const { version: _version, hostId: _hostId, ownerId: _ownerId, ...account } = next;
        nextRoot.accounts[ownerId] = account;
        return device;
      }));
    } catch (error) {
      await newSync.close();
      throw error;
    }
    context.syncStores.set(ownerId, newSync);
    context.attachmentStores.set(ownerId, await createAttachmentStore({ root: path.join(context.syncRoot(ownerId), 'attachments') }));
    context.sharedAttachmentStores.set(ownerId, await createSharedAttachmentStore({ root: path.join(context.syncRoot(ownerId), 'shared-attachments') }));
    return { ...publicAuth(ownerId, result.deviceId,
      context.accountState(ownerId).devices[result.deviceId], result.csrfToken), token: result.token };
  }

  async function updateAccountProfile(request, body) {
    exactKeys(body, ['expectedRevision', 'displayName', 'avatar'], ['expectedRevision']);
    if (!Object.hasOwn(body, 'displayName') && !Object.hasOwn(body, 'avatar')) throw failure('INVALID_REQUEST');
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
        body.expectedRevision >= Number.MAX_SAFE_INTEGER - 1) throw failure('INVALID_REQUEST');
    const nickname = Object.hasOwn(body, 'displayName') ? displayName(body.displayName) : undefined;
    const avatar = Object.hasOwn(body, 'avatar') ? avatarImage(body.avatar) : undefined;
    const current = authenticate(request, 'account:manage');
    return context.serial(() => context.mutate(current.ownerId, (next) => {
      const latest = authenticate(request, 'account:manage');
      if (latest.ownerId !== current.ownerId || latest.deviceId !== current.deviceId) throw failure('UNAUTHORIZED', 401);
      if ((next.account.profileRevision ?? 0) !== body.expectedRevision) throw failure('REQUEST_CONFLICT', 409);
      next.account.displayName = nickname ?? next.account.displayName ?? next.account.username;
      next.account.avatar = avatar === undefined ? next.account.avatar ?? null : avatar;
      next.account.profileRevision = body.expectedRevision + 1;
      return publicProfile(next.account);
    }));
  }

  async function loginAccount(body) {
    exactKeys(body, ['username', 'password', 'deviceName'], ['username', 'password', 'deviceName']);
    const user = normalizeUsername(body.username);
    const name = deviceName(body.deviceName);
    if (typeof body.password !== 'string') throw failure('INVALID_REQUEST');
    const ownerId = Object.entries(context.rootState.accounts)
      .find(([, entry]) => entry.account?.usernameCanonical === user?.canonical)?.[0];
    if (!ownerId) {
      if (context.rootState.unknownAuthLimits.lockUntil > context.timestamp()) throw failure('LOGIN_RATE_LIMITED', 429);
      await hashWork(() => verifyPassword(body.password, undefined));
      await context.serial(() => context.mutateRoot((next) => {
        const at = context.timestamp();
        const limits = next.unknownAuthLimits;
        limits.failures = at - limits.lastFailureAt > 15 * 60 * 1000 ? 1 : limits.failures + 1;
        limits.lastFailureAt = at;
        limits.lockUntil = limits.failures >= 5
          ? at + Math.min(15 * 60 * 1000, 30_000 * 2 ** Math.min(limits.failures - 5, 5)) : 0;
      }));
      throw failure('INVALID_CREDENTIALS', 401);
    }
    return loginAccountForOwner(ownerId, body, user, name);
  }

  async function loginAccountForOwner(ownerId, body, user, name) {
    assertLoginWindow(ownerId);
    const snapshot = context.accountState(ownerId).account;
    const checked = await hashWork(() => verifyPassword(body.password, snapshot?.password));
    const result = await context.serial(async () => {
      assertLoginWindow(ownerId);
      const latest = context.accountState(ownerId).account;
      if (latest?.authEpoch !== snapshot?.authEpoch ||
          latest?.password.hash !== snapshot?.password.hash) throw failure('INVALID_CREDENTIALS', 401);
      if (!snapshot || !user || user.canonical !== snapshot.usernameCanonical ||
          !validPassword(body.password) || !checked) {
        await recordFailedPassword(ownerId, context.timestamp());
        throw failure('INVALID_CREDENTIALS', 401);
      }
      return context.mutate(ownerId, (next) => {
        next.authLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
        return newPasswordDevice(next, name, context.timestamp());
      });
    });
    return { ...publicAuth(ownerId, result.deviceId,
      context.accountState(ownerId).devices[result.deviceId], result.csrfToken), token: result.token };
  }

  async function changeAccountPassword(request, body) {
    exactKeys(body, ['currentPassword', 'newPassword'], ['currentPassword', 'newPassword']);
    if (typeof body.currentPassword !== 'string' || !validPassword(body.newPassword)) throw failure('INVALID_REQUEST');
    const initial = authenticate(request, 'account:manage');
    assertLoginWindow(initial.ownerId);
    const snapshot = context.accountState(initial.ownerId).account;
    const verified = await hashWork(() => verifyPassword(body.currentPassword, snapshot.password));
    if (!verified) {
      await context.serial(async () => {
        authenticate(request, 'account:manage');
        await recordFailedPassword(initial.ownerId, context.timestamp());
      });
      throw failure('INVALID_CREDENTIALS', 401);
    }
    const password = await hashWork(() => hashPassword(body.newPassword));
    const result = await context.serial(() => context.mutate(initial.ownerId, (next) => {
      const current = authenticate(request, 'account:manage');
      if (current.ownerId !== initial.ownerId || current.deviceId !== initial.deviceId ||
          next.account.authEpoch !== snapshot.authEpoch ||
          next.account.password.hash !== snapshot.password.hash) throw failure('UNAUTHORIZED', 401);
      const at = context.timestamp();
      for (const [deviceId, device] of Object.entries(next.devices)) {
        if (deviceId === current.deviceId) continue;
        device.revoked = true;
        device.revokedAt = new Date(at).toISOString();
      }
      for (const command of Object.values(next.commands)) {
        if (command.sourceDeviceId !== current.deviceId || command.state !== 'pending') continue;
        command.state = 'rejected';
        command.errorCode = 'SESSION_REPLACED';
        command.updatedAt = new Date(at).toISOString();
      }
      next.account.password = password;
      next.account.authEpoch++;
      next.authLimits = { failures: 0, lastFailureAt: 0, lockUntil: 0 };
      return rotatePasswordDevice(next, current.deviceId, at);
    }));
    return { ...publicAuth(initial.ownerId, result.deviceId,
      context.accountState(initial.ownerId).devices[result.deviceId], result.csrfToken), token: result.token };
  }

  return {
    hashWork,
    requestAuthority,
    matchingOrigin,
    requireBrowserOrigin,
    cookieToken,
    ownerForRequest,
    authenticate,
    json,
    sessionCookie,
    clearCookie,
    newPasswordDevice,
    rotatePasswordDevice,
    publicAuth,
    readJson,
    deviceName,
    assertLoginWindow,
    recordFailedPassword,
    setupAccount,
    registerAccount,
    updateAccountProfile,
    loginAccount,
    loginAccountForOwner,
    changeAccountPassword,
    async issueSetupGrant() {
      if (context.accountState(context.rootState.legacyOwnerId).account !== null) throw failure('ACCOUNT_ALREADY_CONFIGURED', 409);
      const grant = randomBytes(32).toString('base64url');
      const expiresAt = new Date(context.timestamp() + SETUP_GRANT_MS).toISOString();
      await context.serial(() => context.mutate(context.rootState.legacyOwnerId, (next) => {
        if (next.account !== null) throw failure('ACCOUNT_ALREADY_CONFIGURED', 409);
        next.setupGrant = { hash: digest(grant), expiresAt: Date.parse(expiresAt) };
      }));
      return { grant, expiresAt };
    },
    async enrollDevice({ name, scopes = ['sessions:read', 'commands:write'] }) {
      if (context.closing) throw failure('SERVICE_CLOSING', 503);
      if (context.accountState(context.rootState.legacyOwnerId).account !== null) throw failure('ACCOUNT_LOGIN_REQUIRED', 409);
      if (typeof name !== 'string' || !name.trim() || name.length > 128 ||
          !Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length ||
          scopes.some((scope) => !LEGACY_SCOPES.has(scope))) throw failure('INVALID_REQUEST');
      const deviceId = `device-${randomUUID()}`;
      const token = randomBytes(32).toString('base64url');
      const enrolledAt = new Date().toISOString();
      await context.serial(() => context.mutate(context.rootState.legacyOwnerId, (next) => {
        if (next.account !== null) throw failure('ACCOUNT_LOGIN_REQUIRED', 409);
        next.devices[deviceId] = { name: name.trim(), tokenHash: digest(token), scopes,
          revoked: false, enrolledAt, authKind: 'legacy-local' };
      }));
      return { deviceId, token, name: name.trim(), scopes, enrolledAt };
    },
    async revokeDevice(deviceId) {
      id(deviceId);
      return context.serial(() => context.mutate(context.rootState.legacyOwnerId, (next) => {
        if (!next.devices[deviceId]) throw failure('NOT_FOUND', 404);
        next.devices[deviceId].revoked = true;
        next.devices[deviceId].revokedAt = new Date().toISOString();
      }));
    },
    listDevices() {
      return Object.entries(context.accountState(context.rootState.legacyOwnerId).devices).map(([deviceId, device]) => ({
        deviceId, name: device.name, scopes: [...device.scopes],
        revoked: device.revoked, enrolledAt: device.enrolledAt, revokedAt: device.revokedAt,
      }));
    }
  };
}

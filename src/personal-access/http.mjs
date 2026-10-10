import { hostName } from '../host-name.mjs';
import { handlePush } from './push.mjs';
import { handleNotificationSettings } from './notification-settings.mjs';
import { handlePersonalization } from './personalization.mjs';
import { handleOnboarding } from './onboarding.mjs';
import { hasPrivateContent } from './temporary-chats.mjs';
import { canonicalProviderModelId } from '../model-connection-check.mjs';
import { currentChatProfile } from '../background-model-selection.mjs';
import { personalAccessUiAssetPaths } from '../personal-access-ui/index.mjs';
import {
  attachmentDisposition,
  bounded,
  boundedUpstreamBody,
  canonicalAccountBaseUrl,
  digest,
  exactKeys,
  failure,
  id,
  initialBrowserUrls,
  modelProfileId,
  modelProjection,
  modelTextWithAttachments,
  plainObject,
  publicProject,
  publicSource,
  safeCode,
  statusProjection,
  validId,
  validProjectName,
  withDeadline,
  writeStreamPart
} from './common.mjs';
import { canonicalMemoryPathname } from '../personal-memory/http.mjs';
import { conversationResources } from './resources.mjs';
import { APPROVAL_MODES } from '../plugins/personal-approval-policy.mjs';
import { handlePersonalHealthHttp } from '../personal-health/http.mjs';
import {
  IMAGE_CONTENT_TYPES,
  INTERNAL_ARTIFACT_KIND,
  MAX_ACCOUNTS,
  MAX_BODY,
  MAX_COMMANDS,
  MAX_LOCAL_TURNS,
  MAX_PAGE,
  MAX_PROJECTS,
  MAX_UNRECONCILED_TEXT_BYTES,
  MODEL_JSON_MAX,
  MODEL_PROFILE_ID,
  MODEL_SSE_MAX,
  MODEL_TIMEOUT_MS,
  PUBLIC_CODES,
  REQUEST_ID,
  SYNC_EVENT_ID,
  TOOL_RUNTIME_ID
} from './constants.mjs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { MAX_SHARED_IMAGE_BYTES } from './shared-attachments.mjs';
import { MAX_ATTACHMENT_BYTES, MAX_DISPLAY_BYTES } from '../personal-sync/attachments.mjs';
import { createReadStream } from 'node:fs';
import { MODEL_ID as ACCOUNT_MODEL_NAME_ID, privateProfileId } from '../personal-account-models/index.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { modelRouteFingerprint } from '../model-route-fingerprint.mjs';
import { openAICompatibleEndpoint } from '../openai-compatible-client.ts';
import { inspectProjectRoot } from '../personal-projects/index.mjs';
import { createProjectOperations, projectSettings } from '../personal-projects/projects.mjs';
import { canonicalCompletion, projectCompletion } from './model-completion.mjs';
import {
  invalidateToolApproval,
  invalidateUserQuestion,
  publicToolApproval,
  publicUserQuestion,
  toolApprovals,
  userQuestions
} from './interaction-policy.mjs';
import { canonicalCommand, publicCommand } from './command-policy.mjs';
import { artifactContentType } from '../personal-artifacts/index.mjs';
import { buildConversationContext } from '../personal-conversations/context.mjs';
import { defaultUsagePrice } from './usage.mjs';
import { usageResponse } from './usage-response.mjs';
import { chatForSession, protectMainSession } from './chat-identity.mjs';

export function createHttpHandler(context) {
  const bootId = randomUUID(), startedAt = new Date().toISOString();
  let hostRestarting = false;
  const presence = backend => ({ host: 'online', bootId, startedAt, authorization: 'active',
    runtime: hostRestarting ? 'restarting' : backend?.runtime === 'ready' ? 'ready' : 'unavailable',
    model: backend?.capabilities?.chat?.available === true ? 'available' : 'unavailable' });
  function handle(request, response) {
    context.cloudIdentity?.track(request, response);
    const largeUpload = request.method === 'PUT' &&
      /^\/personal\/v1\/sync\/attachments\/[^/?]+(?:\?.*)?$/.test(request.url ?? '');
    if (!largeUpload && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      // Small control bodies retain the previous ten-second total receive deadline.
      const timer = setTimeout(() => { request.destroy(); response.destroy(); }, 10_000);
      request.once('end', () => clearTimeout(timer));
      request.once('close', () => clearTimeout(timer));
    }
    const ownerId = context.ownerForRequest(request);
    return handleScoped(request, response, ownerId);
  }

  async function handleScoped(request, response, ownerId) {
    const state = ownerId === null ? null : context.accountState(ownerId);
    try {
      if (context.closing) throw failure('SERVICE_CLOSING', 503);
      if (context.backupManager?.isPending() && !['GET', 'HEAD'].includes(request.method)) throw failure('SERVICE_CLOSING', 503);
      const url = new URL(request.url, 'http://127.0.0.1');
      const encodedDshImageId = /^\/personal\/v1\/sessions\/[A-Za-z0-9_-]{1,128}\/attachments\/sha256%3A[a-f0-9]{64}$/i.test(url.pathname);
      const encodedMemoryPathname = canonicalMemoryPathname(url.pathname);
      if ((url.pathname.includes('%') && !encodedDshImageId && encodedMemoryPathname === null) ||
          url.pathname.includes('//') || url.searchParams.has('token')) {
        throw failure('INVALID_REQUEST');
      }
      const pathname = encodedMemoryPathname ?? url.pathname;
      if (!pathname.startsWith('/personal/v1/')) throw failure('NOT_FOUND', 404);
      if (!context.requestAuthority(request) ||
          (request.headers.origin !== undefined && !context.matchingOrigin(request))) {
        throw failure('ORIGIN_NOT_ALLOWED', 403);
      }
      if (context.cloudIdentity && await context.cloudIdentity.handle(request, response, url)) return;
      if (request.method === 'GET' && !url.search && personalAccessUiAssetPaths.has(pathname)) {
        if (context.uiHandler && await context.uiHandler(request, response,
          context.cloudIdentity?.browserConfiguration()) === true) return;
        throw failure('NOT_FOUND', 404);
      }
      if (['/personal/v1/onboarding', '/personal/v1/models/discover'].includes(pathname)) return await handleOnboarding(context, request, response, url);
      if (request.method === 'GET' && pathname === '/personal/v1/auth/state') {
        if (url.search) throw failure('INVALID_REQUEST');
        return context.json(response, 200, { configured: context.registeredAccountCount() > 0,
          registrationAvailable: context.registeredAccountCount() < MAX_ACCOUNTS });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/setup') {
        if (url.search) throw failure('INVALID_REQUEST');
        const matched = context.requireBrowserOrigin(request, true);
        const setupBody = await context.readJson(request);
        const result = await context.setupAccount(setupBody);
        const { token, ...publicResult } = result;
        return context.json(response, 201, publicResult, { 'set-cookie': context.sessionCookie(token, matched.startsWith('https://')) });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/register') {
        if (url.search) throw failure('INVALID_REQUEST');
        const matched = context.requireBrowserOrigin(request);
        const result = await context.registerAccount(await context.readJson(request));
        const { token, ...publicResult } = result;
        return context.json(response, 201, publicResult, { 'set-cookie': context.sessionCookie(token, matched.startsWith('https://')) });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/login') {
        if (url.search) throw failure('INVALID_REQUEST');
        const matched = context.requireBrowserOrigin(request);
        const result = await context.loginAccount(await context.readJson(request));
        const { token, ...publicResult } = result;
        return context.json(response, 200, publicResult, { 'set-cookie': context.sessionCookie(token, matched.startsWith('https://')) });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/auth/me') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'account:manage');
        return context.json(response, 200, context.publicAuth(current.ownerId, current.deviceId,
          current.device, current.csrfToken));
      }
      if (ownerId && context.dataControls.isLocked(ownerId) && !pathname.startsWith('/personal/v1/data') &&
          !['/personal/v1/auth/me','/personal/v1/auth/state','/personal/v1/auth/logout'].includes(pathname) &&
          !(request.method==='GET'&&pathname.startsWith('/personal/v1/activity'))) throw failure('SESSION_BUSY',409);
      if (pathname === '/personal/v1/backups' || pathname.startsWith('/personal/v1/backups/')) {
        const current = context.authenticate(request, 'account:manage');
        // Backups contain the whole host, so only its local owner may manage them.
        if (!context.backupOwner(current.ownerId)) throw failure('FORBIDDEN', 403);
        if (!context.backupManager) throw failure('CAPABILITY_UNAVAILABLE', 503);
        if (url.search) throw failure('INVALID_REQUEST');
        try {
          if (request.method === 'GET' && pathname === '/personal/v1/backups') return context.json(response, 200, await context.backupManager.view());
          const body = await context.readJson(request);
          if (request.method === 'PATCH' && pathname === '/personal/v1/backups/settings') return context.json(response, 200, { settings: await context.backupManager.configure(body) });
          if (request.method === 'POST' && pathname === '/personal/v1/backups') {
            exactKeys(body, [], []); return context.json(response, 202, await context.backupManager.request());
          }
          if (request.method === 'POST' && pathname === '/personal/v1/backups/import') {
            exactKeys(body, ['path'], ['path']); return context.json(response, 201, await context.backupManager.importBackup(body.path));
          }
          if (request.method === 'POST' && pathname === '/personal/v1/backups/prepare-account-deletion') {
            exactKeys(body, [], []); const result = await context.backupManager.prepareAccountDeletion();
            return context.json(response, result.ready ? 200 : 202, result);
          }
          if (request.method === 'POST' && pathname === '/personal/v1/backups/restore') {
            exactKeys(body, ['id', 'confirm'], ['id', 'confirm']);
            if (body.confirm !== true) throw failure('INVALID_REQUEST');
            return context.json(response, 202, await context.backupManager.restore(body.id));
          }
        } catch (error) {
          if (['BACKUP_CORRUPT', 'BACKUP_SYMLINK', 'BACKUP_PAUSE_TIMEOUT'].includes(error.code)) return context.json(response, 409, { error: { code: error.code } });
          throw error;
        }
        throw failure('NOT_FOUND', 404);
      }
      if (pathname === '/personal/v1/data' || pathname.startsWith('/personal/v1/data/')) return await context.dataControls.handle(request, response, url, ownerId);
      if (request.method === 'PATCH' && pathname === '/personal/v1/auth/profile') {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, 'account:manage');
        return context.json(response, 200, { account: await context.updateAccountProfile(request, await context.readJson(request, 192 * 1024)) });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/auth/devices') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'account:manage');
        const devices = Object.entries(state.devices).map(([deviceId, device]) => ({
          id: deviceId, name: device.name, createdAt: device.enrolledAt,
          ...(device.lastSeenAt ? { lastSeenAt: device.lastSeenAt } : {}),
          expiresAt: device.expiresAt ?? null, revoked: device.revoked,
          current: deviceId === current.deviceId,
        }));
        return context.json(response, 200, { devices });
      }
      const deviceMatch = /^\/personal\/v1\/auth\/devices\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (request.method === 'PATCH' && deviceMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'account:manage');
        const target = id(deviceMatch[1]);
        const body = await context.readJson(request);
        exactKeys(body, ['name'], ['name']);
        const name = context.deviceName(body.name);
        const renamed = await context.serial(() => context.mutate(current.ownerId, (next) => {
          const latest = context.authenticate(request, 'account:manage');
          if (latest.ownerId !== current.ownerId || latest.deviceId !== current.deviceId) throw failure('UNAUTHORIZED', 401);
          if (!Object.hasOwn(next.devices, target)) throw failure('NOT_FOUND', 404);
          next.devices[target].name = name;
          return { id: target, name, revoked: next.devices[target].revoked };
        }));
        return context.json(response, 200, { device: renamed });
      }
      if (request.method === 'DELETE' && deviceMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'account:manage');
        const target = id(deviceMatch[1]);
        const matched = context.matchingOrigin(request);
        await context.serial(async () => {
          await context.mutate(current.ownerId, (next) => {
            const latest = context.authenticate(request, 'account:manage');
            if (latest.ownerId !== current.ownerId || latest.deviceId !== current.deviceId) throw failure('UNAUTHORIZED', 401);
            if (!Object.hasOwn(next.devices, target)) throw failure('NOT_FOUND', 404);
            next.devices[target].revoked = true;
            next.devices[target].revokedAt = new Date(context.timestamp()).toISOString();
          });
          await context.cloudIdentity?.revokeLocalDevice(current.ownerId, target);
        });
        return context.json(response, 200, { revoked: true },
          target === current.deviceId ? { 'set-cookie': context.clearCookie(matched.startsWith('https://')) } : {});
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/logout') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'account:manage');
        const matched = context.matchingOrigin(request);
        await context.serial(() => context.mutate(current.ownerId, (next) => {
          if (context.authenticate(request, 'account:manage').ownerId !== current.ownerId) throw failure('UNAUTHORIZED', 401);
          next.devices[current.deviceId].revoked = true;
          next.devices[current.deviceId].revokedAt = new Date(context.timestamp()).toISOString();
        }));
        return context.json(response, 200, { ok: true }, { 'set-cookie': context.clearCookie(matched.startsWith('https://')) });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/auth/change-password') {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, 'account:manage');
        const matched = context.matchingOrigin(request);
        const result = await context.changeAccountPassword(request, await context.readJson(request));
        const { token, ...publicResult } = result;
        return context.json(response, 200, publicResult, { 'set-cookie': context.sessionCookie(token, matched.startsWith('https://')) });
      }
      const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
      const { deviceId, ownerId: authenticatedOwnerId } = context.authenticate(request,
        write ? 'commands:write' : 'sessions:read');
      if (authenticatedOwnerId !== ownerId) throw failure('UNAUTHORIZED', 401);
      if (pathname === '/personal/v1/library' && request.method === 'GET') {
        const result = await context.library.list(ownerId, url.searchParams);
        context.authenticate(request, 'sessions:read');
        return context.json(response, 200, result);
      }
      const libraryMatch = /^\/personal\/v1\/library\/([A-Za-z0-9_-]+)(?:\/(preview|open|show))?$/.exec(pathname);
      if (libraryMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const artifactId = libraryMatch[1], action = libraryMatch[2];
        if (request.method === 'GET' && (!action || action === 'preview')) {
          const result = await context.library[action === 'preview' ? 'preview' : 'detail'](ownerId, artifactId);
          const current = context.authenticate(request, 'sessions:read');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          return context.json(response, 200, result);
        }
        if (request.method === 'POST' && ['open','show'].includes(action)) {
          // Only the trusted desktop device can ask its host to launch a file.
          if (request.headers['x-weftmate-desktop'] !== context.libraryDesktopToken) throw failure('FORBIDDEN', 403);
          exactKeys(await context.readJson(request), [], []);
          return context.json(response, 200, await context.library.action(ownerId, artifactId, action, () => { const current = context.authenticate(request, 'commands:write'); if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401); }));
        }
        throw failure('NOT_FOUND', 404);
      }
      if (pathname.startsWith('/personal/v1/offline/')) return await context.offline.handle(request, response, url, ownerId);
      if (pathname.startsWith('/personal/v1/health/')) {
        const result = await handlePersonalHealthHttp({ store: context.healthStore, context, request,
          url, pathname, ownerId, deviceId });
        if (request.method === 'DELETE') await context.offline.invalidate(ownerId);
        return context.json(response, result.status, result.body);
      }
      if (pathname.startsWith('/personal/v1/memory/')) {
        return await context.handleMemoryHttp(request, response, url, pathname, ownerId, deviceId);
      }
      if (request.method === 'GET' && pathname === '/personal/v1/app/manifest') {
        if (url.search || !context.mobileUi) throw failure('NOT_FOUND', 404);
        const manifest = await context.mobileUi.current();
        if (!manifest) throw failure('NOT_FOUND', 404);
        return context.json(response, 200, manifest);
      }
      if (request.method === 'GET' && pathname === '/personal/v1/app/updates') {
        if (url.search || !context.mobileUi) throw failure('NOT_FOUND', 404);
        await context.mobileUi.updates(response, () => context.authenticate(request, 'sessions:read'));
        return;
      }
      const mobileAsset = /^\/personal\/v1\/app\/assets\/([a-f0-9]{64})\/(.+)$/.exec(pathname);
      if (request.method === 'GET' && mobileAsset) {
        if (url.search || !context.mobileUi) throw failure('NOT_FOUND', 404);
        const asset = await context.mobileUi.asset(mobileAsset[1], mobileAsset[2]).catch(() => null);
        if (!asset) throw failure('NOT_FOUND', 404);
        if (request.headers['if-none-match'] === asset.etag) {
          response.writeHead(304, { etag: asset.etag,
            'cache-control': 'private, max-age=31536000, immutable' });
          return response.end();
        }
        response.writeHead(200, { 'content-type': asset.contentType,
          'content-length': String(asset.bytes.length), etag: asset.etag,
          'cache-control': 'private, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff' });
        return response.end(asset.bytes);
      }
      if (pathname === '/personal/v1/downloads/android' && request.method === 'GET') {
        if (url.search || !context.androidPackagePath) throw failure('NOT_FOUND', 404);
        const entry = await context.androidPackageEntry();
        if (!entry) throw failure('NOT_FOUND', 404);
        const handle = await open(context.androidPackagePath, 'r').catch(() => { throw failure('NOT_FOUND', 404); });
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.size !== entry.size) throw failure('NOT_FOUND', 404);
          response.writeHead(200, { 'content-type': 'application/vnd.android.package-archive',
            'content-disposition': 'attachment; filename="WeftMate-Android.apk"',
            'content-length': String(opened.size), 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff' });
          await new Promise((resolve, reject) => {
            const stream = handle.createReadStream({ autoClose: false });
            const stopped = () => { stream.destroy(); reject(failure('SERVICE_UNAVAILABLE', 503)); };
            response.once('close', stopped);
            stream.once('error', (error) => { response.off('close', stopped); reject(error); });
            stream.once('end', () => { response.off('close', stopped); resolve(); });
            stream.pipe(response);
          });
          return;
        } finally { await handle.close(); }
      }
      if (pathname === '/personal/v1/native/manifest' && request.method === 'GET') {
        if (url.search) throw failure('NOT_FOUND', 404);
        const manifest = await context.nativeDownloads.manifest();
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        return context.json(response, 200, manifest);
      }
      const nativeMacosMatch = /^\/personal\/v1\/downloads\/native\/macos\/([a-f0-9]{64})$/.exec(pathname);
      if (nativeMacosMatch && request.method === 'GET') {
        if (url.search) throw failure('NOT_FOUND', 404);
        const opened = await context.nativeDownloads.openMacos(nativeMacosMatch[1]);
        if (!opened) throw failure('NOT_FOUND', 404);
        try {
          const current = context.authenticate(request, 'sessions:read');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          response.writeHead(200, { 'content-type': 'application/x-apple-diskimage',
            'content-disposition': `attachment; filename="WeftMate-Mac-${opened.release.version}-build${opened.release.build}.dmg"`,
            'content-length': String(opened.release.bytes), 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff' });
          await pipeline(opened.handle.createReadStream({ start: 0, autoClose: false }), response);
          return;
        } finally { await opened.handle.close(); }
      }
      const sharedImageMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]{1,128})\/attachments\/((?:attachment-[0-9a-f-]{36})|(?:sha256:[a-f0-9]{64}))$/i.exec(pathname.replace(/%3a/ig, ':'));
      const chatImageMatch = request.method === 'PUT' && /^\/personal\/v1\/chats\/([A-Za-z0-9_-]{1,128})\/attachments\/(attachment-[0-9a-f-]{36})$/i.exec(pathname);
      if (sharedImageMatch || chatImageMatch) {
        let [, sessionId, attachmentId] = sharedImageMatch || chatImageMatch;
        if (chatImageMatch) {
          const selected = context.chats.requireChat(ownerId, sessionId);
          if (selected.kind !== 'main' || !context.hostOwner(ownerId)) throw failure('CHAT_UNAVAILABLE', 404);
          sessionId = await context.serial(async () => {
            if (!context.chats.requireChat(ownerId, selected.chatId).attachmentSessionId) await context.mutate(ownerId, next => {
              next.chatIdentity.chats[selected.chatId].attachmentSessionId = `session-${randomUUID()}`;
            });
            return context.chats.requireChat(ownerId, selected.chatId).attachmentSessionId;
          });
        }
        const ownedSession = () => {
          if (chatImageMatch) { context.chats.requireChat(ownerId, chatImageMatch[1]); return; }
          const session = context.accountState(ownerId).sessions[sessionId];
          if (!session || session.ownerId !== ownerId ||
              !['personal-remote', 'shared-chat'].includes(session.origin)) throw failure('SESSION_UNAVAILABLE', 404);
        };
        ownedSession();
        if (request.method === 'PUT') {
          if ([...url.searchParams.keys()].some((key) => !['requestId', 'name'].includes(key)) ||
              ['requestId', 'name'].some((key) => url.searchParams.getAll(key).length !== 1)) throw failure('INVALID_REQUEST');
          const lengthHeader = request.headers['content-length'];
          if (lengthHeader !== undefined && (!/^\d+$/.test(lengthHeader) ||
              Number(lengthHeader) > MAX_SHARED_IMAGE_BYTES)) throw failure('BODY_TOO_LARGE', 413);
          const chunks = []; let total = 0;
          for await (const chunk of request) {
            total += chunk.length;
            if (total > MAX_SHARED_IMAGE_BYTES) throw failure('BODY_TOO_LARGE', 413);
            chunks.push(chunk);
          }
          const authorize = () => {
            const current = context.authenticate(request, 'commands:write');
            if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
            ownedSession();
          };
          const result = await context.sharedAttachmentStores.get(ownerId).put({ sessionId, attachmentId,
            requestId: url.searchParams.get('requestId'), name: url.searchParams.get('name'),
            contentType: request.headers['content-type'], sha256: request.headers['x-weftmate-sha256'],
            bytes: Buffer.concat(chunks), authorize });
          return context.json(response, result.duplicate ? 200 : 201, result);
        }
        if (request.method === 'GET') {
          if (url.search || typeof context.backend.readAttachment !== 'function') throw failure('INVALID_REQUEST');
          const found = await context.callBackend(() => context.backend.readAttachment({ sessionId, attachmentId, ownerId }));
          const current = context.authenticate(request, 'sessions:read');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          ownedSession();
          if (!Buffer.isBuffer(found?.bytes) || found.bytes.length < 1 ||
              found.bytes.length > MAX_SHARED_IMAGE_BYTES ||
              !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(found?.contentType)) {
            throw failure('BACKEND_UNAVAILABLE', 503);
          }
          response.writeHead(200, { 'content-type': found.contentType,
            'content-length': String(found.bytes.length), 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff' });
          return response.end(found.bytes);
        }
      }
      const attachmentMatch = /^\/personal\/v1\/sync\/attachments\/((?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.exec(pathname);
      if (attachmentMatch && request.method === 'PUT') {
        const display = url.searchParams.get('variant') === 'display';
        const nameCount = url.searchParams.getAll('name').length;
        if ([...url.searchParams.keys()].some((key) => !['conversationId', 'messageId', 'name', 'variant'].includes(key)) ||
            ['conversationId', 'messageId'].some((key) => url.searchParams.getAll(key).length !== 1) ||
            (display ? nameCount > 1 : nameCount !== 1) ||
            url.searchParams.getAll('variant').length > 1 ||
            (url.searchParams.has('variant') && !display)) {
          throw failure('INVALID_REQUEST');
        }
        const lengthHeader = request.headers['content-length'];
        if (lengthHeader !== undefined && (!/^\d+$/.test(lengthHeader) ||
            Number(lengthHeader) > (display ? MAX_DISPLAY_BYTES : MAX_ATTACHMENT_BYTES))) {
          throw failure('BODY_TOO_LARGE', 413);
        }
        const authorize = () => {
          const latest = context.authenticate(request, 'commands:write');
          if (latest.ownerId !== ownerId || latest.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        };
        let conversationId = url.searchParams.get('conversationId');
        const logicalChat = context.accountState(ownerId).chatIdentity?.chats[conversationId];
        if (logicalChat) {
          if (logicalChat.kind !== 'main' || !context.hostOwner(ownerId)) throw failure('CHAT_UNAVAILABLE', 404);
          conversationId = await context.serial(async () => {
            if (!context.chats.requireChat(ownerId, logicalChat.chatId).attachmentSessionId) await context.mutate(ownerId, next => {
              next.chatIdentity.chats[logicalChat.chatId].attachmentSessionId = `session-${randomUUID()}`;
            });
            return context.chats.requireChat(ownerId, logicalChat.chatId).attachmentSessionId;
          });
        }
        const result = await context.attachmentStores.get(ownerId).put({ attachmentId: attachmentMatch[1],
          conversationId,
          messageId: url.searchParams.get('messageId'), name: url.searchParams.get('name'),
          contentType: request.headers['content-type'], sha256: request.headers['x-weftmate-sha256'],
          stream: request, expectedSize: lengthHeader === undefined ? undefined : Number(lengthHeader),
          display, authorize });
        return context.json(response, result.duplicate ? 200 : 201, result);
      }
      if (attachmentMatch && request.method === 'GET') {
        const display = url.search === '?variant=display';
        if (url.search && !display) throw failure('INVALID_REQUEST');
        const stored = await context.attachmentStores.get(ownerId).get(attachmentMatch[1], display);
        if (!context.syncStores.get(ownerId).references(attachmentMatch[1], stored.conversationId, stored.messageId) &&
            !context.commandReferencesOriginal(ownerId, stored.conversationId, stored.messageId, stored.meta)) {
          throw failure('NOT_FOUND', 404);
        }
        context.authenticate(request, 'sessions:read');
        response.writeHead(200, { 'content-type': stored.meta.contentType,
          'content-length': String(stored.meta.size), 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          ...(!IMAGE_CONTENT_TYPES.has(stored.meta.contentType)
            ? { 'content-disposition': attachmentDisposition(stored.meta.name) } : {}) });
        await pipeline(createReadStream(stored.file, { start: stored.offset }), response);
        return;
      }
      if (pathname === '/personal/v1/sync/capabilities' && request.method === 'POST') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'commands:write');
        if (current.via !== 'cookie' || !['password', 'cloud'].includes(current.device.authKind)) {
          throw failure('FORBIDDEN', 403);
        }
        const body = await context.readJson(request);
        if (plainObject(body) && Object.hasOwn(body, 'platform')) {
          exactKeys(body, ['platform', 'sharedConversations', 'accountModelTransfer'],
            ['platform', 'sharedConversations']);
          if (!['macos', 'ios', 'watchos'].includes(body.platform) ||
              body.sharedConversations !== 1 ||
              (body.accountModelTransfer !== undefined && body.accountModelTransfer !== 1)) {
            throw failure('INVALID_REQUEST');
          }
          // Apple has no Android build number. Persist 11/12 as server compatibility
          // levels so existing stores and gates remain readable by older releases.
          const level = body.accountModelTransfer === 1 ? 12 : 11;
          await context.serial(() => {
            const latest = context.authenticate(request, 'commands:write');
            if (latest.ownerId !== ownerId || latest.deviceId !== deviceId ||
                latest.via !== 'cookie' || !['password', 'cloud'].includes(latest.device.authKind)) {
              throw failure('UNAUTHORIZED', 401);
            }
            if (latest.device.syncCapabilities?.nativeVersionCode !== level) {
              return context.mutate(ownerId, (next) => {
                next.devices[deviceId].syncCapabilities = { sharedConversations: 1,
                  nativeVersionCode: level, declaredAt: new Date(context.timestamp()).toISOString() };
              });
            }
          });
          return context.json(response, 200, { deviceId, platform: body.platform, sharedConversations: 1,
            ...(level === 12 ? { accountModelTransfer: 1 } : {}) });
        }
        exactKeys(body, ['sharedConversations', 'nativeVersionCode'],
          ['sharedConversations', 'nativeVersionCode']);
        if (body.sharedConversations !== 1 || !Number.isSafeInteger(body.nativeVersionCode) ||
            body.nativeVersionCode < 11 || body.nativeVersionCode > 10_000) throw failure('INVALID_REQUEST');
        const prior = current.device.syncCapabilities;
        if (prior && prior.nativeVersionCode >= body.nativeVersionCode) {
          return context.json(response, 200, { deviceId, sharedConversations: 1,
            nativeVersionCode: prior.nativeVersionCode });
        }
        const recorded = await context.serial(() => context.mutate(ownerId, (next) => {
          const latest = context.authenticate(request, 'commands:write');
          if (latest.ownerId !== ownerId || latest.deviceId !== deviceId ||
              latest.via !== 'cookie' || !['password', 'cloud'].includes(latest.device.authKind)) {
            throw failure('UNAUTHORIZED', 401);
          }
          const existing = next.devices[deviceId].syncCapabilities;
          if (!existing || existing.nativeVersionCode < body.nativeVersionCode) {
            next.devices[deviceId].syncCapabilities = { sharedConversations: 1,
              nativeVersionCode: body.nativeVersionCode,
              declaredAt: new Date(context.timestamp()).toISOString() };
          }
          return next.devices[deviceId].syncCapabilities.nativeVersionCode;
        }));
        return context.json(response, 200, { deviceId, sharedConversations: 1,
          nativeVersionCode: recorded });
      }
      if (pathname === '/personal/v1/sync/events' && request.method === 'POST') {
        if (url.search) throw failure('INVALID_REQUEST');
        const body = await context.readJson(request, 256 * 1024);
        exactKeys(body, ['events'], ['events']);
        const accepted = await context.serial(async () => {
          const authorize = () => {
            const latest = context.authenticate(request, 'commands:write');
            if (latest.ownerId !== ownerId || latest.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          };
          authorize();
          return context.syncStores.get(ownerId).append({ events: body.events, sourceDeviceId: deviceId, authorize,
            validateAttachment: (reference) => context.attachmentStores.get(ownerId).referenced(reference) });
        });
        return context.json(response, 200, accepted);
      }
      if (pathname === '/personal/v1/sync/events' && request.method === 'GET') {
        if ([...url.searchParams.keys()].some((key) => !['afterSeq', 'limit'].includes(key)) ||
            url.searchParams.getAll('afterSeq').length > 1 || url.searchParams.getAll('limit').length > 1) {
          throw failure('INVALID_REQUEST');
        }
        const afterText = url.searchParams.get('afterSeq') ?? '0';
        const limitText = url.searchParams.get('limit') ?? '100';
        if (!/^\d+$/.test(afterText) || !/^\d+$/.test(limitText)) throw failure('INVALID_REQUEST');
        return context.json(response, 200, { ...context.syncStores.get(ownerId).page({ afterSeq: Number(afterText), limit: Number(limitText) }),
          presence: { host:'online', bootId, startedAt, authorization:'active', runtime:hostRestarting?'restarting':'unknown' }, activity: context.activity.watermark(ownerId) });
      }
      const sharedConversationMatch = /^\/personal\/v1\/sync\/conversations\/([A-Za-z0-9_-]{1,128})\/shared$/.exec(pathname);
      if (sharedConversationMatch && request.method === 'GET') {
        if (url.search) throw failure('INVALID_REQUEST');
        return context.json(response, 200, context.conversationProjection(ownerId, sharedConversationMatch[1]));
      }
      const localTurnMatch = /^\/personal\/v1\/sync\/conversations\/([A-Za-z0-9_-]{1,128})\/local-turns(?:\/([A-Za-z0-9_-]{1,128})(?:\/(renew|finish))?)?$/.exec(pathname);
      if (localTurnMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const conversationId = localTurnMatch[1], turnId = localTurnMatch[2];
        const snapshot = context.conversationSnapshot(ownerId, conversationId);
        if (request.method === 'GET' && turnId && !localTurnMatch[3]) {
          const turn = state.conversationLocalTurns?.[turnId];
          if (!turn || turn.conversationId !== conversationId || turn.deviceId !== deviceId) {
            throw failure('NOT_FOUND', 404);
          }
          return context.json(response, 200, { turnId, state: context.localTurnState(snapshot, turn),
            expiresAt: turn.expiresAt, requestId: turn.requestId });
        }
        if (request.method === 'POST') {
          const body = await context.readJson(request);
          if (!turnId) exactKeys(body, ['requestId', 'turnId', 'sourceSyncEventId'],
            ['requestId', 'turnId', 'sourceSyncEventId']);
          else exactKeys(body, ['requestId'], ['requestId']);
          if (!REQUEST_ID.test(body.requestId ?? '') ||
              (!turnId && (!SYNC_EVENT_ID.test(body.turnId ?? '') ||
                !SYNC_EVENT_ID.test(body.sourceSyncEventId ?? ''))) ||
              (turnId && !SYNC_EVENT_ID.test(turnId))) throw failure('INVALID_REQUEST');
          const record = await context.serial(() => context.mutate(ownerId, (next) => {
            const current = context.authenticate(request, 'commands:write');
            if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
            const fresh = context.conversationSnapshot(ownerId, conversationId);
            next.conversationLocalTurns ??= {};
            const id = turnId ?? body.turnId;
            const existing = next.conversationLocalTurns[id];
            const now = new Date(context.timestamp()).toISOString();
            if (!turnId) {
              if (existing) {
                if (existing.conversationId !== conversationId || existing.deviceId !== deviceId ||
                    existing.requestId !== body.requestId ||
                    existing.sourceSyncEventId !== body.sourceSyncEventId) throw failure('REQUEST_CONFLICT', 409);
                return { turnId: id, state: context.localTurnState(fresh, existing),
                  expiresAt: existing.expiresAt, requestId: existing.requestId };
              }
              if (next.conversationBindings?.[conversationId]) throw failure('CONVERSATION_NOT_READY', 409);
              const source = fresh.events.find((event) => event.eventId === body.sourceSyncEventId);
              if (source?.kind !== 'message.created' || source.payload.role !== 'user' ||
                  source.sourceDeviceId !== deviceId || source.seq !== fresh.latestSeq ||
                  Object.values(next.conversationLocalTurns).some((item) =>
                    item.sourceSyncEventId === body.sourceSyncEventId) ||
                  Object.values(next.conversationLocalTurns).some((item) =>
                    item.requestId === body.requestId)) throw failure('CONVERSATION_NOT_READY', 409);
              if (Object.keys(next.conversationLocalTurns).length >= MAX_LOCAL_TURNS) {
                for (const [oldId, old] of Object.entries(next.conversationLocalTurns)) {
                  if (old.state === 'finished' && Date.parse(old.updatedAt) < context.timestamp() - 30 * 86_400_000) {
                    delete next.conversationLocalTurns[oldId];
                  }
                }
                if (Object.keys(next.conversationLocalTurns).length >= MAX_LOCAL_TURNS) {
                  throw failure('CAPACITY_LIMIT', 429);
                }
              }
              const other = Object.values(next.conversationLocalTurns).some((item) =>
                item.conversationId === conversationId && context.localTurnState(fresh, item) === 'running');
              if (other) throw failure('LOCAL_TURN_RUNNING', 409);
              const expiresAt = new Date(context.timestamp() + 60_000).toISOString();
              next.conversationLocalTurns[id] = { turnId: id, conversationId,
                ownerId, requestId: body.requestId, sourceSyncEventId: body.sourceSyncEventId,
                deviceId, state: 'running', createdAt: now, updatedAt: now, expiresAt };
              return { turnId: id, state: 'running', expiresAt, requestId: body.requestId };
            }
            if (!existing || existing.conversationId !== conversationId || existing.deviceId !== deviceId ||
                existing.requestId !== body.requestId) throw failure('NOT_FOUND', 404);
            const state = context.localTurnState(fresh, existing);
            if (localTurnMatch[3] === 'renew') {
              if (state !== 'running' || next.conversationBindings?.[conversationId]) {
                throw failure('LOCAL_TURN_UNCONFIRMED', 409);
              }
              existing.expiresAt = new Date(context.timestamp() + 60_000).toISOString();
              existing.updatedAt = now;
              return { turnId: id, state: 'running', expiresAt: existing.expiresAt,
                requestId: existing.requestId };
            }
            if (localTurnMatch[3] !== 'finish' || state !== 'finished') {
              throw failure('CONVERSATION_NOT_READY', 409);
            }
            existing.state = 'finished'; existing.updatedAt = now;
            return { turnId: id, state: 'finished', expiresAt: existing.expiresAt,
              requestId: existing.requestId };
          }));
          return context.json(response, 200, record);
        }
      }
      if (await context.scheduleOperations.handleHttp(request, response, url, ownerId)) return;
      if (await context.goalOperations.handleHttp(request, response, url, ownerId)) return;
      if (['/personal/v1/settings/personalization', '/personal/v1/settings/personalization/style'].includes(pathname)) return await handlePersonalization(context, request, response, url, ownerId);
      if (['/personal/v1/settings/notifications', '/personal/v1/settings/notifications/test'].includes(pathname)) return await handleNotificationSettings(context, request, response, url, ownerId);
      if (await handlePush(context, request, response, url, ownerId, deviceId)) return;
      if (await context.activity.handleHttp(request, response, url, ownerId, deviceId)) return;
      const suggestionsMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]{1,128})\/suggestions$/.exec(pathname);
      if (suggestionsMatch && ['POST', 'DELETE'].includes(request.method)) return await context.nextSuggestions.handle(request, response, url, ownerId, suggestionsMatch[1]);
      const thinkingMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/thinking$/.exec(pathname);
      if (thinkingMatch && ['GET', 'PATCH'].includes(request.method)) {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, request.method === 'PATCH' ? 'commands:write' : 'sessions:read');
        const sessionId = thinkingMatch[1], account = context.accountState(ownerId), session = account.sessions[sessionId];
        if (!session || session.deleting || session.archived || !['personal-remote', 'shared-chat'].includes(session.origin)) throw failure('SESSION_UNAVAILABLE', 404);
        const models = await context.callBackend(() => context.backend.listModels({ ownerId }));
        const supported = context.modelVisible(ownerId, session.modelProfileId) && models.find(row => row.id === session.modelProfileId)?.deepThinking?.supported === true;
        if (request.method === 'PATCH') {
          const body = await context.readJson(request); exactKeys(body, ['enabled'], ['enabled']);
          if (typeof body.enabled !== 'boolean' || body.enabled && !supported) throw failure('INVALID_REQUEST');
          await context.serial(() => context.mutate(ownerId, next => {
            context.authenticate(request, 'commands:write');
            const current = next.sessions[sessionId];
            if (!current || current.archived || current.deleting) throw failure('SESSION_UNAVAILABLE', 404);
            current.deepThinking = body.enabled;
            const chat = chatForSession(next, sessionId); if (chat) chat.deepThinking = body.enabled;
          }));
        }
        return context.json(response, 200, { supported, enabled: supported && (chatForSession(context.accountState(ownerId), sessionId)?.deepThinking ?? context.accountState(ownerId).sessions[sessionId].deepThinking) === true });
      }
      const modeMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/approval-mode$/.exec(pathname);
      if ((modeMatch || pathname === '/personal/v1/settings/approvals') && ['GET', 'PATCH'].includes(request.method)) {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, request.method === 'PATCH' ? 'commands:write' : 'sessions:read');
        const sessionId = modeMatch?.[1], account = context.accountState(ownerId);
        if (sessionId && account.sessions[sessionId]?.origin !== 'personal-remote') throw failure('SESSION_UNAVAILABLE', 404);
        if (request.method === 'PATCH') {
          const body = await context.readJson(request);
          exactKeys(body, ['mode'], ['mode']);
          if (!APPROVAL_MODES.includes(body.mode)) throw failure('INVALID_REQUEST');
          await context.serial(() => context.mutate(ownerId, next => {
            context.authenticate(request, 'commands:write');
            if (sessionId) next.sessions[sessionId].approvalMode = body.mode;
            else {
              for (const session of Object.values(next.sessions)) session.approvalMode ??= next.defaultApprovalMode ?? 'auto';
              next.defaultApprovalMode = body.mode;
            }
          }));
        }
        const saved = context.accountState(ownerId);
        return context.json(response, 200, { mode: sessionId ? saved.sessions[sessionId].approvalMode ?? saved.defaultApprovalMode ?? 'auto'
          : saved.defaultApprovalMode ?? 'auto', ...(sessionId ? { allowedCategories: saved.sessions[sessionId].allowedApprovalCategories ?? [] } : {}) });
      }
      if (['/personal/v1/usage', '/personal/v1/settings/usage'].includes(pathname) && ['GET', 'PATCH'].includes(request.method)) {
        const settingsRoute = pathname.endsWith('/settings/usage');
        if (!settingsRoute && request.method !== 'GET') throw failure('NOT_FOUND', 404);
        context.authenticate(request, request.method === 'PATCH' ? 'account:manage' : 'sessions:read');
        if (settingsRoute && url.search || [...url.searchParams.keys()].some(key => !['month', 'sessionId', 'timeZone'].includes(key))) throw failure('INVALID_REQUEST');
        const sessionId = url.searchParams.get('sessionId');
        if (sessionId && !state.sessions[sessionId]) throw failure('SESSION_UNAVAILABLE', 404);
        if (!settingsRoute) return context.json(response, 200, context.usage.summary(ownerId, url.searchParams.get('month') ?? undefined, sessionId, url.searchParams.get('timeZone') ?? undefined));
        const catalog = modelProjection(await context.callBackend(() => context.backend.listModels({ ownerId })));
        if (request.method === 'PATCH') {
          const body = await context.readJson(request);
          if (body.profileId && !catalog.some(model => model.id === body.profileId && context.modelVisible(ownerId, model.id))) throw failure('MODEL_UNAVAILABLE', 409);
          context.authenticate(request, 'account:manage');
          await context.usage.configure(ownerId, body);
        }
        const settings = context.usage.settings(ownerId);
        const auth = context.authenticate(request, 'sessions:read');
        return context.json(response, 200, { ...settings, canManage: auth.via === 'cookie' && auth.device.scopes.includes('account:manage'),
          models: catalog.filter(model => context.modelVisible(ownerId, model.id)).map(model => ({ id: model.id, name: model.name, model: model.model,
            local: model.sourceKind === 'local', price: settings.prices[model.id] ?? defaultUsagePrice(model) })) });
      }
      if (pathname === '/personal/v1/settings/models' && ['GET', 'PATCH'].includes(request.method)) {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, request.method === 'PATCH' ? 'account:manage' : 'sessions:read');
        if (request.method === 'PATCH') {
          const body = await context.readJson(request);
          exactKeys(body, ['backgroundModelProfileId', 'defaultModelProfileId'], []);
          if (!Object.keys(body).length) throw failure('INVALID_REQUEST');
          const catalog = modelProjection(await context.callBackend(() => context.backend.listModels({ ownerId })));
          for (const key of Object.keys(body)) if (body[key] !== null && (!catalog.some(model => model.id === body[key] && model.configured) || !context.modelSelectable(ownerId, body[key]))) throw failure('MODEL_UNAVAILABLE', 409);
          await context.serial(() => context.mutate(ownerId, next => {
            context.authenticate(request, 'account:manage');
            for (const key of Object.keys(body)) {
              if (body[key] !== null && !context.modelSelectable(ownerId, body[key])) throw failure('MODEL_UNAVAILABLE', 409);
              next[key] = body[key];
            }
          }));
          await context.memoryManager?.invalidateOwnerRoute?.(ownerId);
        }
        return context.json(response, 200, { backgroundModelProfileId: context.accountState(ownerId).backgroundModelProfileId ?? null,
          defaultModelProfileId: context.accountState(ownerId).defaultModelProfileId ?? null,
          currentChatModelProfileId: currentChatProfile(context.accountState(ownerId), id => context.modelSelectable(ownerId, id)) });
      }
      const restartMatch = /^\/personal\/v1\/system\/(model|host|memory)\/restart$/.exec(pathname);
      if ((pathname === '/personal/v1/system' && request.method === 'GET') ||
          (restartMatch && request.method === 'POST')) {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, restartMatch ? 'commands:write' : 'sessions:read');
        if (!context.systemManager) throw failure('CAPABILITY_UNAVAILABLE', 503);
        if (restartMatch) {
          if (!context.hostOwner(ownerId)) throw failure('FORBIDDEN', 403);
          exactKeys(await context.readJson(request), []);
          context.nextSuggestions.cancel(ownerId);
          if (restartMatch[1] === 'host') hostRestarting = true;
          try { await context.systemManager.restart(restartMatch[1], ownerId); }
          finally { hostRestarting = false; }
        }
        const value = await context.systemManager.status(ownerId);
        return context.json(response, 200, { ...value, canRestart: context.hostOwner(ownerId) });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/status') {
        if (url.search) throw failure('INVALID_REQUEST');
        // Runtime/model diagnostics failing must not hide a reachable authenticated host.
        const backendStatus = statusProjection(await withDeadline(() => context.callBackend(() => context.backend.getStatus({ ownerId })), 1500)
          .catch(() => ({ runtime:'unavailable', capabilities:{chat:{available:false,reasonCode:'RUNTIME_UNAVAILABLE'}} })));
        const memoryStatus = context.memoryManager ? await withDeadline(() => context.memoryManager.status(ownerId),1500)
          .catch(()=>({state:context.memoryManager.peek(ownerId)})) : { state: 'disabled' };
        backendStatus.modules.memory = context.memoryManager?.peek(ownerId) ?? 'disabled';
        if (!context.hostOwner(ownerId)) {
          const models = modelProjection(await context.callBackend(() => context.backend.listModels({ ownerId })))
            .filter((item) => context.modelSelectable(ownerId, item.id));
          if (!models.some((item) => item.configured)) {
            backendStatus.capabilities.chat = { available: false, reasonCode: 'MODEL_UNAVAILABLE' };
          }
          backendStatus.capabilities.desktopOpenApp = {
            available: false, reasonCode: 'CAPABILITY_UNAVAILABLE', appIds: [],
          };
          backendStatus.capabilities.naturalLanguageDesktop = {
            available: false, reasonCode: 'CAPABILITY_UNAVAILABLE',
          };
        }
        context.authenticate(request, 'sessions:read');
        return context.json(response, 200, {
          ...context.service.status(ownerId), hostName:hostName(),
          presence: presence(backendStatus),
          personalCapabilities: { replyStreaming: 1, sessionStatus: 1, nextSuggestions: typeof context.backend.modelCompletion === 'function' ? 1 : 0, library: 1, libraryPreview: 1, libraryDesktopActions: context.library.desktopAvailable ? 1 : 0, taskOverview: 1, scheduleEditing: typeof context.backend.schedules === 'function' ? 1 : 0, goals: typeof context.backend.goals === 'function' ? 1 : 0, activity: 1, activityChanges: 1, activityRead: 1, activityNotification: 1, notificationSettings: 1, pushRegistration: 1, temporaryChats: 1, chats: 1, chatTimeline: 1, chatSearch: 1, sideChats: 1, creationReceipt: 1, chatSend: 1, chatLifecycle: 1, chatResources: 1 },
          executionAccount: context.hostOwner(ownerId),
          executionAccountName: context.hostOwner(ownerId) ? null : context.executionAccountName(),
          sync: { available: true }, downloads: { android: (await context.androidPackageEntry()) !== null },
          backend: backendStatus, memory: { state: memoryStatus.state, inject: memoryStatus.capabilities?.inject === true,
            failedCorrectionCount: memoryStatus.failedCorrectionCount ?? 0, formationIssues: memoryStatus.formationIssues ?? [] },
          updates: await context.updateStatus(), nativeMinimumVersions: context.nativeMinimumVersions,
        });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/models') {
        if (url.search) throw failure('INVALID_REQUEST');
        return context.json(response, 200, { models: modelProjection(await context.callBackend(() => context.backend.listModels({ ownerId })))
          .filter((item) => context.modelSelectable(ownerId, item.id))
          .map((item) => {
            const owned = item.id.startsWith('private-model-') ? context.accountModelForProfile(ownerId, item.id) : null;
            return owned ? { ...item, name: owned.name, accountModelId: owned.accountModelId,
              revision: owned.revision } : item;
          }) });
      }
      if (pathname === '/personal/v1/account/models' && request.method === 'GET') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'sessions:read');
        return context.json(response, 200, { models: Object.values(state.accountModels ?? {})
          .filter((item) => item.status !== 'removed').map((item) => context.accountModelView(ownerId, item))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          canManage: current.via === 'cookie' && current.device.scopes.includes('account:manage') });
      }
      const modelOperationMatch = /^\/personal\/v1\/account\/models\/by-request\/([A-Za-z0-9_.:-]{1,128})$/.exec(pathname);
      if (modelOperationMatch && request.method === 'GET') {
        if (url.search || !REQUEST_ID.test(modelOperationMatch[1])) throw failure('INVALID_REQUEST');
        const operation = state.modelOperations?.[modelOperationMatch[1]];
        if (!operation) throw failure('NOT_FOUND', 404);
        if (operation.status === 'uncertain') await context.reconcileModelOperation(ownerId, operation.requestId);
        return context.json(response, 200, context.modelOperationResponse(ownerId,
          context.accountState(ownerId).modelOperations[operation.requestId]));
      }
      if (pathname === '/personal/v1/account/models/check' && request.method === 'POST') {
        if (url.search || !context.accountModelManager?.check) throw failure('CAPABILITY_UNAVAILABLE', 503);
        context.authenticate(request, 'account:manage');
        const body = await context.readJson(request, 12 * 1024);
        exactKeys(body, ['profileId', 'baseUrl', 'modelId', 'apiKey', 'sendTestMessage'], []);
        if (body.sendTestMessage !== undefined && typeof body.sendTestMessage !== 'boolean') throw failure('INVALID_REQUEST');
        if (body.modelId !== undefined && !ACCOUNT_MODEL_NAME_ID.test(body.modelId)) throw failure('INVALID_REQUEST');
        if (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || !body.apiKey || body.apiKey.length > 4096)) throw failure('INVALID_REQUEST');
        if (body.profileId && !context.modelSelectable(ownerId, body.profileId)) throw failure('MODEL_UNAVAILABLE', 422);
        if (body.baseUrl !== undefined) {
          body.baseUrl = canonicalAccountBaseUrl(body.baseUrl);
          if (!body.baseUrl) throw failure('INVALID_REQUEST');
        }
        if (!body.profileId && (!body.baseUrl || !ACCOUNT_MODEL_NAME_ID.test(body.modelId ?? '') || typeof body.apiKey !== 'string' || !body.apiKey || body.apiKey.length > 4096)) throw failure('INVALID_REQUEST');
        const value = await context.accountModelManager.check({ ownerId, input: body });
        context.authenticate(request, 'account:manage');
        return context.json(response, 200, value);
      }
      const accountModelMatch = /^\/personal\/v1\/account\/models\/(account-model-[0-9a-f-]{36})(?:\/(test|stop-using|transfer))?$/.exec(pathname);
      if (accountModelMatch && request.method === 'GET' && !accountModelMatch[2]) {
        if (url.search) throw failure('INVALID_REQUEST');
        const record = state.accountModels?.[accountModelMatch[1]];
        if (!record) throw failure('NOT_FOUND', 404);
        return context.json(response, 200, { model: context.accountModelView(ownerId, record) });
      }
      if ((pathname === '/personal/v1/account/models' && request.method === 'POST') ||
          (accountModelMatch && ['PATCH', 'POST', 'DELETE'].includes(request.method))) {
        if (url.search || !context.accountModelManager) throw failure('ACCOUNT_MODEL_UNAVAILABLE', 503);
        const current = context.authenticate(request, 'account:manage');
        if (current.via !== 'cookie' || !['password', 'cloud'].includes(current.device.authKind)) {
          throw failure('FORBIDDEN', 403);
        }
        const action = !accountModelMatch ? 'create' : request.method === 'PATCH' ? 'update'
          : request.method === 'DELETE' ? 'remove' : accountModelMatch[2] === 'test' ? 'test'
            : accountModelMatch[2] === 'stop-using' ? 'stop_using'
              : accountModelMatch[2] === 'transfer' ? 'transfer' : null;
        if (!action) throw failure('NOT_FOUND', 404);
        const body = await context.readJson(request, action === 'create' || action === 'update' ? 12 * 1024 : MAX_BODY);
        if (action === 'create') exactKeys(body, ['requestId', 'name', 'baseUrl', 'modelId', 'apiKey', 'modelTier'],
          ['requestId', 'name', 'baseUrl', 'modelId', 'apiKey']);
        else if (action === 'update') exactKeys(body,
          ['requestId', 'expectedRevision', 'name', 'baseUrl', 'modelId', 'apiKey', 'modelTier'],
          ['requestId', 'expectedRevision']);
        else exactKeys(body, ['requestId', 'expectedRevision'], ['requestId', 'expectedRevision']);
        if (!REQUEST_ID.test(body.requestId ?? '') ||
            (action !== 'create' && (!Number.isSafeInteger(body.expectedRevision) ||
              body.expectedRevision < 1))) throw failure('INVALID_REQUEST');
        const accountModelId = action === 'create' ? null : accountModelMatch[1];
        if (context.interactionRequestIdUsed(state, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
        const prior = state.modelOperations?.[body.requestId];
        if (action === 'transfer') {
          if (prior) throw failure('REQUEST_CONFLICT', 409);
          const record = state.accountModels?.[accountModelId];
          if (!record) throw failure('NOT_FOUND', 404);
          if (record.status !== 'active' || record.revision !== body.expectedRevision) {
            throw failure('ACCOUNT_MODEL_REVISION_CHANGED', 409);
          }
          if (current.device.syncCapabilities?.nativeVersionCode < 12 ||
              current.device.syncCapabilities?.sharedConversations !== 1) throw failure('FORBIDDEN', 403);
          const profileId = record.revisions[String(record.runtimeRevision)].profileId;
          if (record.ownerId !== ownerId || !context.modelVisible(ownerId, profileId)) {
            throw failure('ACCOUNT_MODEL_UNAVAILABLE', 409);
          }
          const secret = await context.accountModelManager.readSecret({ ownerId, profileId });
          const latest = context.authenticate(request, 'account:manage');
          const newest = context.accountState(ownerId).accountModels?.[accountModelId];
          if (latest.ownerId !== ownerId || latest.deviceId !== deviceId ||
              latest.via !== 'cookie' || !['password', 'cloud'].includes(latest.device.authKind) ||
              latest.device.authEpoch !== current.device.authEpoch ||
              latest.device.syncCapabilities?.nativeVersionCode < 12 ||
              newest?.ownerId !== ownerId || newest.status !== 'active' ||
              newest.revision !== body.expectedRevision ||
              newest.revisions[String(newest.runtimeRevision)]?.profileId !== profileId ||
              !context.modelVisible(ownerId, profileId) ||
              typeof secret !== 'string' || !secret) throw failure('ACCOUNT_MODEL_UNAVAILABLE', 409);
          return context.json(response, 200, { model: context.accountModelView(ownerId,
            context.accountState(ownerId).accountModels[accountModelId]), apiKey: secret });
        }
        const priorModel = accountModelId ? state.accountModels?.[accountModelId] : null;
        if (accountModelId && !priorModel) throw failure('NOT_FOUND', 404);
        let name = body.name, baseUrl = body.baseUrl, modelId = body.modelId, modelTier = body.modelTier;
        if (action === 'create' || action === 'update') {
          if (action === 'update' && !['name', 'baseUrl', 'modelId', 'apiKey', 'modelTier'].some((key) =>
            Object.hasOwn(body, key))) throw failure('INVALID_REQUEST');
          name = action === 'create' || body.name !== undefined ? body.name : priorModel.name;
          baseUrl = canonicalAccountBaseUrl(action === 'create' || body.baseUrl !== undefined
            ? body.baseUrl : priorModel.revisions[String(priorModel.runtimeRevision)].baseUrl);
          modelId = action === 'create' || body.modelId !== undefined
            ? body.modelId : priorModel.revisions[String(priorModel.runtimeRevision)].modelId;
          if (typeof modelId !== 'string' || !ACCOUNT_MODEL_NAME_ID.test(modelId)) throw failure('INVALID_REQUEST');
          modelId = canonicalProviderModelId(baseUrl, modelId);
          modelTier = body.modelTier ?? (action === 'update'
            ? priorModel.revisions[String(priorModel.runtimeRevision)].modelTier : undefined);
          if (body.modelTier !== undefined && !['auto', 'local', 'cloud'].includes(body.modelTier)) {
            throw failure('INVALID_REQUEST');
          }
          if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
              !baseUrl || typeof modelId !== 'string' || !ACCOUNT_MODEL_NAME_ID.test(modelId) ||
              (body.apiKey !== undefined && (typeof body.apiKey !== 'string' ||
                !body.apiKey || body.apiKey.length > 4096))) throw failure('INVALID_REQUEST');
          if (action === 'create' && !body.apiKey) throw failure('ACCOUNT_MODEL_SECRET_REQUIRED', 400);
          if (action === 'update' && body.baseUrl !== undefined &&
              baseUrl !== priorModel.revisions[String(priorModel.runtimeRevision)].baseUrl &&
              body.apiKey === undefined) throw failure('ACCOUNT_MODEL_SECRET_REQUIRED', 400);
        }
        const hash = digest(JSON.stringify({ action, accountModelId,
          request: action === 'create' || action === 'update'
            ? Object.fromEntries(['requestId', 'expectedRevision', 'name', 'baseUrl', 'modelId', 'apiKey', 'modelTier']
              .filter((key) => Object.hasOwn(body, key))
              .map((key) => [key, key === 'baseUrl' ? canonicalAccountBaseUrl(body[key]) : body[key]]))
            : { requestId: body.requestId, expectedRevision: body.expectedRevision } }));
        if (prior) {
          if (prior.kind !== action || prior.accountModelId !== accountModelId && accountModelId !== null ||
              prior.payloadHash !== hash) throw failure('REQUEST_CONFLICT', 409);
          return context.json(response, ['pending', 'applying'].includes(prior.status) ? 202 : 200,
            context.modelOperationResponse(ownerId, prior));
        }
        if (Object.values(state.commands).some((item) => item.requestId === body.requestId) ||
            state.projectOperations?.[body.requestId]) throw failure('REQUEST_CONFLICT', 409);
        if (priorModel && (priorModel.revision !== body.expectedRevision ||
            !(action === 'remove' ? ['active', 'stopped', 'failed'].includes(priorModel.status)
              : priorModel.status === 'active'))) {
          throw failure('ACCOUNT_MODEL_REVISION_CHANGED', 409);
        }
        if (accountModelId && Object.values(state.modelOperations ?? {}).some((item) =>
          item.accountModelId === accountModelId &&
          ['pending', 'applying', 'uncertain'].includes(item.status))) {
          throw failure('ACCOUNT_MODEL_BUSY', 409);
        }
        const newId = accountModelId ?? `account-model-${randomUUID()}`;
        const currentRuntime = priorModel?.revisions[String(priorModel.runtimeRevision)];
        const routeChange = action === 'create' || action === 'update' &&
          (baseUrl !== currentRuntime.baseUrl || modelId !== currentRuntime.modelId || modelTier !== currentRuntime.modelTier || body.apiKey !== undefined);
        const target = routeChange ? {
          runtimeRevision: action === 'create' ? 1 : priorModel.runtimeRevision + 1,
          profileId: privateProfileId(ownerId, newId,
            action === 'create' ? 1 : priorModel.runtimeRevision + 1),
          baseUrl, modelId, name, ...(modelTier !== undefined ? { modelTier } : {}), routeFingerprint: modelRouteFingerprint(
            openAICompatibleEndpoint(baseUrl, 'chat/completions').href, modelId),
        } : null;
        const stageRef = body.apiKey !== undefined
          ? `pending-model-${digest(`${ownerId}|${body.requestId}|${hash}`).slice(0, 48)}` : null;
        if (stageRef) await context.accountModelManager.stageSecret({ ownerId, stageRef, apiKey: body.apiKey });
        const operation = await context.serial(() => context.mutate(ownerId, (next) => {
          const latest = context.authenticate(request, 'account:manage');
          if (latest.ownerId !== ownerId || latest.deviceId !== deviceId || latest.via !== 'cookie') {
            throw failure('UNAUTHORIZED', 401);
          }
          next.accountModels ??= {}; next.modelOperations ??= {};
          if (context.interactionRequestIdUsed(next, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
          const existing = next.modelOperations[body.requestId];
          if (existing) {
            if (existing.payloadHash !== hash || existing.kind !== action) throw failure('REQUEST_CONFLICT', 409);
            return existing;
          }
          if (Object.keys(next.modelOperations).length >= 1000 ||
              (action === 'create' && (Object.keys(next.accountModels).length >= 1000 ||
                Object.values(next.accountModels).filter((item) => item.status !== 'removed').length >= 100))) {
            throw failure('CAPACITY_LIMIT', 429);
          }
          const found = accountModelId ? next.accountModels[accountModelId] : null;
          if (accountModelId && (!found ||
              !(action === 'remove' ? ['active', 'stopped', 'failed'].includes(found.status)
                : found.status === 'active') ||
              found.revision !== body.expectedRevision)) throw failure('ACCOUNT_MODEL_REVISION_CHANGED', 409);
          if (accountModelId && Object.values(next.modelOperations).some((item) =>
            item.accountModelId === accountModelId &&
            ['pending', 'applying', 'uncertain'].includes(item.status))) {
            throw failure('ACCOUNT_MODEL_BUSY', 409);
          }
          const now = new Date(context.timestamp()).toISOString();
          if (action === 'create') next.accountModels[newId] = { accountModelId: newId,
            ownerId, revision: 1, runtimeRevision: 1, name, status: 'pending',
            revisions: { '1': { revision: 1, profileId: target.profileId,
              baseUrl, modelId, ...(modelTier !== undefined ? { modelTier } : {}), routeFingerprint: target.routeFingerprint, createdAt: now } },
            createdAt: now, updatedAt: now };
          const saved = { ownerId, requestId: body.requestId, kind: action,
            accountModelId: newId, payloadHash: hash, status: 'pending',
            ...(body.expectedRevision ? { expectedRevision: body.expectedRevision } : {}),
            ...(target ? { target } : {}), ...(stageRef ? { stageRef } : {}),
            ...(action === 'update' ? { name } : {}),
            ...(currentRuntime && target ? { previousProfileId: currentRuntime.profileId } : {}),
            createdAt: now, updatedAt: now };
          next.modelOperations[body.requestId] = saved;
          return saved;
        }));
        context.scheduleModelOperation(ownerId, operation.requestId);
        return context.json(response, 202, context.modelOperationResponse(ownerId, operation));
      }
      if (request.method === 'GET' && pathname === '/personal/v1/projects') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'sessions:read');
        return context.json(response, 200, { projects: Object.values(state.projects ?? {}).filter(project => !project.removed).map(project => ({ ...publicProject(project),
            ...(request.headers['x-weftmate-desktop'] === context.libraryDesktopToken ? {rootPath:project.rootPath} : {}) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          canManage: context.hostOwner(ownerId) && current.via === 'cookie' && current.device.scopes.includes('account:manage') });
      }
      if (request.method === 'GET' && pathname === '/personal/v1/workspaces/browser') {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, 'sessions:read');
        const readerStatus = context.hostOwner(ownerId) ? context.browserReader?.status() : null;
        return context.json(response, 200, { available: readerStatus?.available === true,
          hostId: state.hostId, workspaceKind: 'browser',
          ...(readerStatus?.lastFailure ? { reasonCode: readerStatus.lastFailure } : {}) });
      }
      if (request.method === 'POST' && pathname === '/personal/v1/projects') {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'account:manage');
        if (!context.hostOwner(ownerId)) throw failure('FORBIDDEN', 403);
        const body = await context.readJson(request);
        exactKeys(body, ['requestId', 'name', 'rootPath', 'instructions', 'permission'], ['requestId', 'name', 'rootPath']);
        if (current.via === 'cookie' && request.headers['sec-fetch-site'] &&
            request.headers['x-weftmate-desktop'] !== context.libraryDesktopToken) throw failure('PROJECT_NATIVE_SELECTION_REQUIRED', 403);
        const settings = projectSettings(body);
        if (!REQUEST_ID.test(body.requestId ?? '') || !validProjectName(body.name)) throw failure('INVALID_REQUEST');
        const hash = digest(JSON.stringify({ name: body.name, rootPath: body.rootPath,
          ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
          ...(body.permission !== undefined ? { permission: body.permission } : {}) }));
        if (context.interactionRequestIdUsed(state, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
        const prior = state.projectOperations?.[body.requestId];
        if (prior) {
          if (prior.kind !== 'register' || prior.payloadHash !== hash) throw failure('REQUEST_CONFLICT', 409);
          return context.json(response, 200, { project: publicProject(state.projects[prior.projectId]) });
        }
        const inspected = await inspectProjectRoot(body.rootPath);
        const project = await context.serial(() => context.mutate(ownerId, (next) => {
          const latest = context.authenticate(request, 'account:manage');
          if (latest.ownerId !== ownerId || latest.deviceId !== current.deviceId || !context.hostOwner(ownerId)) {
            throw failure('UNAUTHORIZED', 401);
          }
          next.projects ??= {}; next.projectOperations ??= {};
          if (context.interactionRequestIdUsed(next, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
          const existing = next.projectOperations[body.requestId];
          if (existing) {
            if (existing.kind !== 'register' || existing.payloadHash !== hash) throw failure('REQUEST_CONFLICT', 409);
            return publicProject(next.projects[existing.projectId]);
          }
          if (Object.keys(next.projects).length >= MAX_PROJECTS || Object.keys(next.projectOperations).length >= 500 ||
              Object.values(next.commands).some((command) => command.requestId === body.requestId)) {
            throw failure('CAPACITY_LIMIT', 429);
          }
          const projectId = `project-${randomUUID()}`;
          const now = new Date(context.timestamp()).toISOString();
          next.projects[projectId] = { projectId, ownerId, name: body.name, ...inspected,
            instructions: '', permission: 'read-only', ...settings,
            fileSecret: randomBytes(32).toString('hex'), revision: 1, revoked: false,
            createdAt: now, updatedAt: now, files: {} };
          next.projectOperations[body.requestId] = { kind: 'register', projectId, payloadHash: hash, at: now };
          return publicProject(next.projects[projectId]);
        }));
        return context.json(response, 201, { project });
      }
      const projectSettingsMatch = /^\/personal\/v1\/projects\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (projectSettingsMatch && ['PATCH', 'DELETE'].includes(request.method)) {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'account:manage');
        if (!context.hostOwner(ownerId)) throw failure('FORBIDDEN', 403);
        const body = await context.readJson(request);
        return context.json(response, 200, await createProjectOperations(context)(ownerId, projectSettingsMatch[1], request.method, body, () => {
          const latest = context.authenticate(request, 'account:manage');
          if (latest.ownerId !== ownerId || latest.deviceId !== current.deviceId) throw failure('UNAUTHORIZED', 401);
        }));
      }
      const projectRevokeMatch = /^\/personal\/v1\/projects\/([A-Za-z0-9_-]+)\/revoke$/.exec(pathname);
      if (request.method === 'POST' && projectRevokeMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const current = context.authenticate(request, 'account:manage');
        if (!context.hostOwner(ownerId)) throw failure('FORBIDDEN', 403);
        const projectId = id(projectRevokeMatch[1]);
        const body = await context.readJson(request);
        exactKeys(body, ['requestId'], ['requestId']);
        if (!REQUEST_ID.test(body.requestId ?? '')) throw failure('INVALID_REQUEST');
        const project = await context.serial(() => context.mutate(ownerId, (next) => {
          const latest = context.authenticate(request, 'account:manage');
          if (latest.ownerId !== ownerId || latest.deviceId !== current.deviceId || !context.hostOwner(ownerId)) {
            throw failure('UNAUTHORIZED', 401);
          }
          const found = next.projects?.[projectId];
          if (!found) throw failure('NOT_FOUND', 404);
          next.projectOperations ??= {};
          const hash = digest(projectId);
          if (context.interactionRequestIdUsed(next, body.requestId)) throw failure('REQUEST_CONFLICT', 409);
          const prior = next.projectOperations[body.requestId];
          if (prior) {
            if (prior.kind !== 'revoke' || prior.projectId !== projectId || prior.payloadHash !== hash) {
              throw failure('REQUEST_CONFLICT', 409);
            }
            return publicProject(found);
          }
          if (found.revoked) throw failure('PROJECT_REVOKED', 409);
          if (Object.keys(next.projectOperations).length >= 500 ||
              Object.values(next.commands).some((command) => command.requestId === body.requestId)) {
            throw failure('CAPACITY_LIMIT', 429);
          }
          const now = new Date(context.timestamp()).toISOString();
          found.revoked = true; found.revision++; found.revokedAt = now; found.updatedAt = now;
          next.projectOperations[body.requestId] = { kind: 'revoke', projectId, payloadHash: hash, at: now };
          return publicProject(found);
        }));
        return context.json(response, 200, { project });
      }
      const modelMatch = /^\/personal\/v1\/models\/([A-Za-z0-9._-]+)\/(verify|chat\/completions)$/.exec(pathname);
      if (request.method === 'POST' && modelMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const profileId = modelProfileId(modelMatch[1]);
        if (!context.modelSelectable(ownerId, profileId)) throw failure('MODEL_UNAVAILABLE', 422);
        if (modelMatch[2] === 'verify') {
          if (typeof context.backend.verifyModelProfile !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
          exactKeys(await context.readJson(request), [], []);
          context.authenticate(request, 'commands:write');
          let value;
          try { value = await context.callBackend(() => context.backend.verifyModelProfile(profileId, ownerId)); }
          catch (error) { throw error?.code === 'MODEL_UNAVAILABLE'
            ? failure('MODEL_UNAVAILABLE', 422) : error; }
          if (!plainObject(value)) throw failure('BACKEND_UNAVAILABLE', 503);
          return context.json(response, 200, value);
        }
        if (typeof context.backend.modelCompletion !== 'function') throw failure('CAPABILITY_UNAVAILABLE', 503);
        const body = canonicalCompletion(await context.readJson(request, 256 * 1024));
        const current = context.authenticate(request, 'commands:write');
        if (current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        const controller = new AbortController();
        const disconnected = () => controller.abort();
        const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
        const authWatch = setInterval(() => {
          try { context.authenticate(request, 'commands:write'); }
          catch { controller.abort(); }
        }, 1000);
        response.once('close', disconnected);
        try {
          let upstream;
          const model = (await context.backend.listModels({ ownerId })).find(row => row.id === profileId);
          const requestId = await context.usage.begin(ownerId, { profileId, model });
          try {
            upstream = await context.backend.modelCompletion({ profileId, body, signal: controller.signal, ownerId });
            upstream = await usageResponse(upstream, value => context.usage.finish(ownerId, requestId, value));
          }
          catch (error) { await context.usage.finish(ownerId, requestId, null); throw error?.code === 'MODEL_UNAVAILABLE'
            ? failure('MODEL_UNAVAILABLE', 422) : error; }
          if (controller.signal.aborted || !upstream?.ok || !upstream.body) throw failure('BACKEND_UNAVAILABLE', 503);
          if (!body.stream) {
            const raw = await boundedUpstreamBody(upstream, MODEL_JSON_MAX);
            let value;
            try { value = JSON.parse(raw); } catch { throw failure('BACKEND_UNAVAILABLE', 503); }
            let projected;
            try { projected = projectCompletion(value); }
            catch { throw failure('BACKEND_UNAVAILABLE', 503); }
            return context.json(response, 200, projected);
          }
          if (!/^text\/event-stream(?:\s*;|$)/i.test(upstream.headers?.get?.('content-type') ?? '')) {
            throw failure('BACKEND_UNAVAILABLE', 503);
          }
          response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
          let bytes = 0;
          let tail = '';
          for await (const part of upstream.body) {
            if (controller.signal.aborted) throw failure('SERVICE_UNAVAILABLE', 503);
            bytes += part.byteLength;
            if (bytes > MODEL_SSE_MAX) throw failure('BACKEND_UNAVAILABLE', 503);
            tail = (tail + Buffer.from(part).toString('utf8')).slice(-256);
            await writeStreamPart(response, part);
          }
          if (!tail.includes('data: [DONE]')) throw failure('BACKEND_UNAVAILABLE', 503);
          response.end();
          return;
        } finally {
          clearTimeout(timer);
          clearInterval(authWatch);
          response.off('close', disconnected);
          controller.abort();
        }
      }
      if (request.method === 'GET' && pathname === '/personal/v1/chats/main') {
        if (url.search) throw failure('INVALID_REQUEST');
        await context.sideChats.reconcile(ownerId);
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        return context.json(response, 200, await context.chats.main(ownerId));
      }
      if (request.method === 'GET' && pathname === '/personal/v1/chats') {
        return context.json(response, 200, await context.chats.list(ownerId, url.searchParams));
      }
      const chatTimelineMatch = /^\/personal\/v1\/chats\/([A-Za-z0-9_-]+)\/(events|changes|dates|locate|search)$/.exec(pathname);
      if (request.method === 'GET' && chatTimelineMatch) {
        if (chatTimelineMatch[1] === state.chatIdentity.mainChatId) await context.sideChats.reconcile(ownerId);
        const result = await context.chatTimeline.query(ownerId, chatTimelineMatch[1], chatTimelineMatch[2], url.searchParams);
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        return context.json(response, 200, result);
      }
      const sideResultMatch = /^\/personal\/v1\/chats\/([A-Za-z0-9_-]+)\/results$/.exec(pathname);
      if (request.method === 'POST' && sideResultMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const authorize = () => {
          const current = context.authenticate(request, 'commands:write');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        };
        return context.json(response, 201, await context.sideChats.share(ownerId, sideResultMatch[1], await context.readJson(request, 2048), authorize));
      }
      const chatMatch = /^\/personal\/v1\/chats\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (request.method === 'GET' && chatMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        return context.json(response, 200, { chat: await context.chats.view(ownerId, chatMatch[1]) });
      }
      const sessionChatMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/chat$/.exec(pathname);
      if (request.method === 'GET' && sessionChatMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        return context.json(response, 200, context.chats.resolveSession(ownerId, sessionChatMatch[1]));
      }
      const chatMetadataMatch = /^\/personal\/v1\/chats\/([A-Za-z0-9_-]+)\/metadata$/.exec(pathname);
      if (chatMetadataMatch && request.method === 'PATCH') {
        if (url.search) throw failure('INVALID_REQUEST');
        if (context.chats.requireChat(ownerId, chatMetadataMatch[1]).kind === 'side') return context.json(response, 200,
          await context.chatLifecycle.write(ownerId, chatMetadataMatch[1], 'metadata', await context.readJson(request, 2048), () => context.authenticate(request, 'commands:write')));
        return context.json(response, 200, await context.chats.metadata(ownerId, chatMetadataMatch[1], await context.readJson(request, 2048)));
      }
      const logicalRead = /^\/personal\/v1\/chats\/([A-Za-z0-9_-]+)\/(resources|forget-preview)$/.exec(pathname);
      if (request.method === 'GET' && logicalRead) {
        if (logicalRead[2] === 'forget-preview') {
          if (url.search) throw failure('INVALID_REQUEST');
          const auth = context.authenticate(request, 'account:manage');
          if (auth.via !== 'cookie') throw failure('FORBIDDEN', 403);
          return context.json(response, 200, await context.chatLifecycle.preview(ownerId, logicalRead[1]));
        }
        return context.json(response, 200, await context.chatLifecycle.resources(ownerId, logicalRead[1], url.searchParams));
      }
      const logicalArchive = /^\/personal\/v1\/chats\/([A-Za-z0-9_-]+)\/(archive|unarchive)$/.exec(pathname);
      if (request.method === 'DELETE' && chatMatch || request.method === 'POST' && logicalArchive) {
        if (url.search) throw failure('INVALID_REQUEST');
        const target = chatMatch?.[1] ?? logicalArchive[1], action = chatMatch ? 'delete' : logicalArchive[2];
        if (context.accountState(ownerId).chatIdentity.chats[target]?.kind === 'main') throw failure('MAIN_CHAT_PROTECTED', 409);
        const body = await context.readJson(request, 2048);
        const authorize = () => {
          const auth = context.authenticate(request, body.forgetMemories ? 'account:manage' : 'commands:write');
          if (body.forgetMemories && auth.via !== 'cookie') throw failure('FORBIDDEN', 403);
          return auth;
        };
        return context.json(response, 200, await context.chatLifecycle.write(ownerId, target, action, body, authorize));
      }
      if (chatMatch && request.method === 'DELETE' || /^\/personal\/v1\/chats\/([A-Za-z0-9_-]+)\/(metadata|archive|unarchive|fork)$/.test(pathname) && ['PATCH', 'POST'].includes(request.method)) {
        const chatId = pathname.split('/')[4];
        if (context.chats.requireChat(ownerId, chatId).kind === 'main') throw failure('MAIN_CHAT_PROTECTED', 409);
      }
      if (request.method === 'GET' && pathname === '/personal/v1/sessions') {
        if ([...url.searchParams.keys()].some(key => !['archived','limit','cursor','q'].includes(key) || url.searchParams.getAll(key).length !== 1) ||
            url.searchParams.getAll('archived').length > 1 ||
            url.searchParams.has('archived') && !['true', 'false', 'all'].includes(url.searchParams.get('archived')))
          throw failure('INVALID_REQUEST');
        const archived = url.searchParams.get('archived') ?? 'false';
        // Existing native clients enumerate the full in-memory snapshot. New
        // clients explicitly request bounded pages without hiding older chats.
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Math.max(1,Object.keys(state.sessions).length), cursor = url.searchParams.get('cursor');
        const q = url.searchParams.get('q') ?? '';
        if (!Number.isInteger(limit) || limit < 1 || url.searchParams.has('limit') && limit > 200 || q.length > 256 || cursor && !validId(cursor)) throw failure('INVALID_REQUEST');
        const searchDescriptions = q ? await context.sessionOperations.describe(ownerId,Object.keys(state.sessions)) : null;
        const normalizedQuery = q.normalize('NFKC').toLocaleLowerCase();
        const snapshotAt = new Date(context.timestamp()).toISOString();
        const sessions = [];
        const ids = Object.keys(state.sessions).filter(id => chatForSession(state,id)?.kind !== 'main' &&
          (archived === 'all' || (state.sessions[id].archived === true) === (archived === 'true')) &&
          (!q || (state.sessions[id].title ?? searchDescriptions.get(id)?.title ?? '').normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery)))
          .sort((a,b) => Number(state.sessions[b].pinned === true) - Number(state.sessions[a].pinned === true) ||
            context.sessionOperations.activityTime(ownerId,b).localeCompare(context.sessionOperations.activityTime(ownerId,a)) || a.localeCompare(b));
        const offset = cursor ? ids.indexOf(cursor) + 1 : 0;
        if (cursor && offset === 0) throw failure('CURSOR_RESET_REQUIRED',409);
        const selectedIds = ids.slice(offset, offset + limit);
        let descriptions;
        try { descriptions = await context.sessionOperations.describe(ownerId,selectedIds); } catch { descriptions = new Map(); }
        for (const sessionId of selectedIds) {
          try {
            const described = descriptions.get(sessionId);
            if (!described || described.unavailable) throw failure('SESSION_UNAVAILABLE');
            if (described?.sessionId === sessionId) sessions.push({
              sessionId,
              hostId: state.hostId,
              archived: state.sessions[sessionId].archived === true,
              modelProfileId: state.sessions[sessionId].modelProfileId ?? described.modelProfileId ?? null,
              title: bounded(described.title, 256) ?? '',
              ...await context.sessionOperations.summary(ownerId, sessionId),
              running: described.running === true,
              taskAvailable: state.sessions[sessionId].origin === 'personal-remote',
              ...(state.sessions[sessionId].projectNotice ? { projectNotice: state.sessions[sessionId].projectNotice } : {}),
              ...(described.contextUsage ? {contextUsage: described.contextUsage} : {}),
              ...(described.running === true && described.processing ? { processing: described.processing } : {}),
              ...(state.sessions[sessionId].workspaceKind ? {
                workspaceKind: state.sessions[sessionId].workspaceKind,
                modelProfileId: state.sessions[sessionId].modelProfileId } : {}),
              ...(state.sessions[sessionId].conversationId ? {
                conversationId: state.sessions[sessionId].conversationId,
                modelProfileId: state.sessions[sessionId].modelProfileId } : {}),
              ...(state.sessions[sessionId].projectId ? {
                projectId: state.sessions[sessionId].projectId,
                projectRevision: state.sessions[sessionId].projectRevision,
                projectName: state.projects?.[state.sessions[sessionId].projectId]?.name ?? '已登记项目',
                projectRevoked: state.projects?.[state.sessions[sessionId].projectId]?.revoked === true,
                modelProfileId: state.sessions[sessionId].modelProfileId } : {}),
              deepThinking: (chatForSession(state,sessionId)?.deepThinking ?? state.sessions[sessionId].deepThinking) === true,
              sendAvailable: state.sessions[sessionId].deleting !== true && state.sessions[sessionId].archived !== true && ((state.sessions[sessionId].origin === 'personal-remote' &&
                described.agentPreset === 'personal-remote' &&
                (!state.sessions[sessionId].projectId ||
                  (state.projects?.[state.sessions[sessionId].projectId]?.revoked === false &&
                    state.projects[state.sessions[sessionId].projectId].revision === state.sessions[sessionId].projectRevision &&
                    described.modelProfileId === state.sessions[sessionId].modelProfileId)) &&
                (!state.sessions[sessionId].workspaceKind ||
                  (context.browserReader?.status()?.available === true &&
                    described.modelProfileId === state.sessions[sessionId].modelProfileId))) ||
                (state.sessions[sessionId].origin === 'shared-chat' &&
                described.agentPreset === 'personal-shared-chat' &&
                context.modelVisible(ownerId, state.sessions[sessionId].modelProfileId))),
            });
          } catch { const live = context.accountState(ownerId).sessions[sessionId]; sessions.push({ sessionId, title: '', attention: null, lastOutcome: null,
            ...(live && !live.deleting ? await context.sessionOperations.summary(ownerId,sessionId) : {}),
            running: false, sendAvailable: false, unavailable: true }); }
        }
        sessions.sort((a, b) => Number(b.pinned) - Number(a.pinned));
        const hasMore = offset + limit < ids.length;
        return context.json(response, 200, { sessions, groups: Object.values(state.sessionGroups ?? {}), snapshotAt,
          statusSummary: await context.sessionOperations.statusSummary(ownerId,descriptions),
          hasMore, nextCursor: hasMore ? selectedIds.at(-1) : null });
      }
      const groupMatch = /^\/personal\/v1\/session-groups(?:\/([A-Za-z0-9_-]+))?$/.exec(pathname);
      if (groupMatch && (request.method === 'GET' && !groupMatch[1] || request.method === 'POST' && !groupMatch[1] || ['PATCH', 'DELETE'].includes(request.method) && groupMatch[1])) {
        if (url.search) throw failure('INVALID_REQUEST');
        const body = request.method === 'GET' ? {} : await context.readJson(request, 2048);
        return context.json(response, request.method === 'POST' ? 201 : 200,
          await context.sessionOperations.groups(ownerId, request.method, groupMatch[1], body));
      }
      const branchMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/message-branches$/.exec(pathname);
      if (branchMatch && ['GET', 'POST'].includes(request.method)) {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, request.method === 'POST' ? 'commands:write' : 'sessions:read');
        return context.json(response, request.method === 'POST' ? 201 : 200, request.method === 'POST'
          ? await context.sessionOperations.messageBranches.create(ownerId, branchMatch[1], await context.readJson(request, 2048))
          : context.sessionOperations.messageBranches.versions(ownerId, branchMatch[1]));
      }
      const metadataMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/(metadata|fork)$/.exec(pathname);
      if (metadataMatch && (request.method === 'PATCH' && metadataMatch[2] === 'metadata' || request.method === 'POST' && metadataMatch[2] === 'fork')) {
        if (url.search) throw failure('INVALID_REQUEST');
        const body = await context.readJson(request, 2048);
        if (metadataMatch[2] === 'fork' && (!plainObject(body) || Object.keys(body).length)) throw failure('INVALID_REQUEST');
        return context.json(response, metadataMatch[2] === 'fork' ? 201 : 200, metadataMatch[2] === 'fork'
          ? await context.sessionOperations.fork(ownerId, metadataMatch[1])
          : await context.sessionOperations.metadata(ownerId, metadataMatch[1], body));
      }
      const forgetPreviewMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/forget-preview$/.exec(pathname);
      if (request.method === 'GET' && forgetPreviewMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        context.authenticate(request, 'account:manage');
        return context.json(response, 200, await context.sessionOperations.previewSessionForget(ownerId, forgetPreviewMatch[1]));
      }
      const lifecycleMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)(?:\/(archive|unarchive))?$/.exec(pathname);
      if (lifecycleMatch && (request.method === 'POST' && lifecycleMatch[2] || request.method === 'DELETE' && !lifecycleMatch[2])) {
        if (url.search) throw failure('INVALID_REQUEST');
        const body = await context.readJson(request, 1024);
        if (!plainObject(body) || Object.keys(body).some(key => !['forgetMemories', 'deleteConversationSnippets', 'memoryWorldRevision'].includes(key)) ||
            Object.keys(body).length > 0 && request.method !== 'DELETE' ||
            body.forgetMemories !== undefined && typeof body.forgetMemories !== 'boolean' ||
            body.deleteConversationSnippets !== undefined && typeof body.deleteConversationSnippets !== 'boolean' ||
            body.deleteConversationSnippets === true && body.forgetMemories !== true ||
            body.memoryWorldRevision !== undefined && (!Number.isSafeInteger(body.memoryWorldRevision) || body.memoryWorldRevision < 0 || body.forgetMemories !== true))
          throw failure('INVALID_REQUEST');
        if (body.forgetMemories) context.authenticate(request, 'account:manage');
        const result = request.method === 'DELETE'
          ? await context.sessionOperations.deleteSession(ownerId, lifecycleMatch[1], body)
          : await context.sessionOperations.archiveSession(ownerId, lifecycleMatch[1], lifecycleMatch[2] === 'archive');
        return context.json(response, 200, result);
      }
      const questionMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/questions(?:\/([A-Za-z0-9_-]+))?$/.exec(pathname);
      if (request.method === 'GET' && questionMatch && !questionMatch[2]) {
        const sessionId = id(questionMatch[1]);
        if ([...url.searchParams.keys()].some(key => !['before', 'limit'].includes(key)) ||
            url.searchParams.getAll('before').length > 1 || url.searchParams.getAll('limit').length > 1) throw failure('INVALID_REQUEST');
        const before = url.searchParams.get('before'), limitText = url.searchParams.get('limit') ?? '50';
        if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(Number(limitText)) || Number(limitText) < 1 || Number(limitText) > 100 ||
            before !== null && !TOOL_RUNTIME_ID.test(before)) throw failure('INVALID_REQUEST');
        await context.syncUserQuestions(ownerId, sessionId);
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        const ordered = userQuestions(context.accountState(ownerId)).filter(row => row.sessionId === sessionId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.questionRpcId.localeCompare(a.questionRpcId));
        const cursor = before === null ? -1 : ordered.findIndex(row => row.questionRpcId === before);
        if (before !== null && cursor < 0) throw failure('NOT_FOUND', 404);
        const start = cursor + 1, page = ordered.slice(start, start + Number(limitText)), hasMore = start + Number(limitText) < ordered.length;
        return context.json(response, 200, { questions: page.map(publicUserQuestion), nextBefore: hasMore ? page.at(-1).questionRpcId : null, hasMore });
      }
      if (request.method === 'POST' && questionMatch?.[2]) {
        if (url.search || !TOOL_RUNTIME_ID.test(questionMatch[2])) throw failure('INVALID_REQUEST');
        return context.json(response, 200, await context.answerUserQuestion(request, ownerId, deviceId, id(questionMatch[1]),
          questionMatch[2], await context.readJson(request)));
      }
      const approvalMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/approvals(?:\/([A-Za-z0-9_-]+))?$/.exec(pathname);
      if (request.method === 'GET' && approvalMatch && !approvalMatch[2]) {
        const sessionId = id(approvalMatch[1]);
        if (!Object.hasOwn(state.sessions, sessionId)) throw failure('SESSION_UNAVAILABLE', 404);
        if ([...url.searchParams.keys()].some(key => !['before', 'limit'].includes(key)) ||
            url.searchParams.getAll('before').length > 1 || url.searchParams.getAll('limit').length > 1) throw failure('INVALID_REQUEST');
        const before = url.searchParams.get('before'), limitText = url.searchParams.get('limit') ?? '50';
        if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(Number(limitText)) || Number(limitText) < 1 || Number(limitText) > 100 ||
            before !== null && !TOOL_RUNTIME_ID.test(before)) throw failure('INVALID_REQUEST');
        await context.refreshToolApprovals(ownerId, sessionId);
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        const ordered = toolApprovals(context.accountState(ownerId)).filter(row => row.sessionId === sessionId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.approvalId.localeCompare(a.approvalId));
        const cursor = before === null ? -1 : ordered.findIndex(row => row.approvalId === before);
        if (before !== null && cursor < 0) throw failure('NOT_FOUND', 404);
        const start = cursor + 1, page = ordered.slice(start, start + Number(limitText));
        const hasMore = start + Number(limitText) < ordered.length;
        return context.json(response, 200, { approvals: page.map(publicToolApproval),
          nextBefore: hasMore ? page.at(-1).approvalId : null, hasMore });
      }
      if (request.method === 'POST' && approvalMatch?.[2]) {
        if (url.search || !TOOL_RUNTIME_ID.test(approvalMatch[2])) throw failure('INVALID_REQUEST');
        const sessionId = id(approvalMatch[1]);
        return context.json(response, 200, await context.answerToolApproval(request, ownerId, deviceId, sessionId,
          approvalMatch[2], await context.readJson(request)));
      }
      const resourcesMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/resources$/.exec(pathname);
      if (request.method === 'GET' && resourcesMatch) {
        const sessionId = id(resourcesMatch[1]);
        if (!Object.hasOwn(state.sessions, sessionId)) throw failure('SESSION_UNAVAILABLE', 404);
        const cursor = url.searchParams.get('afterSeq') ?? '-1';
        if ([...url.searchParams.keys()].some(key => key !== 'afterSeq') || url.searchParams.getAll('afterSeq').length > 1 ||
            !/^-?\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) < -1) throw failure('INVALID_REQUEST');
        const result = await conversationResources(context, state, sessionId, ownerId, Number(cursor));
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        return context.json(response, 200, result);
      }
      const detailMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/events\/(\d+)\/detail$/.exec(pathname);
      if (request.method === 'GET' && detailMatch) {
        const sessionId = id(detailMatch[1]), seq = Number(detailMatch[2]);
        if (url.search || !Number.isSafeInteger(seq)) throw failure('INVALID_REQUEST');
        if (!Object.hasOwn(state.sessions, sessionId)) throw failure('SESSION_UNAVAILABLE', 404);
        if (typeof context.backend.readEventDetail !== 'function') throw failure('BACKEND_UNAVAILABLE', 503);
        if (state.sessions[sessionId].forgottenSeqs?.includes(seq)) throw failure('SOURCE_UNAVAILABLE', 404);
        const detail = await context.callBackend(() => context.backend.readEventDetail({ sessionId, seq, ownerId }));
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        const latest = context.accountState(ownerId).sessions[sessionId];
        if (!latest || latest.forgottenSeqs?.includes(seq)) throw failure('SOURCE_UNAVAILABLE', 404);
        if (['user.message', 'assistant.message'].includes(detail.type)) {
          const event = context.publicHistoryEvent(ownerId, sessionId, { seq, type: detail.type, data: {
            text: detail.text, messageHash: detail.messageHash, receiptId: detail.receiptId } });
          return context.json(response, 200, { seq, type: detail.type, text: event.data.text });
        }
        return context.json(response, 200, detail);
      }
      const eventMatch = /^\/personal\/v1\/sessions\/([A-Za-z0-9_-]+)\/events$/.exec(pathname);
      if (request.method === 'GET' && eventMatch) {
        const sessionId = id(eventMatch[1]);
        if (!Object.hasOwn(state.sessions, sessionId)) throw failure('SESSION_UNAVAILABLE', 404);
        if ([...url.searchParams.keys()].some(key => !['afterSeq', 'beforeSeq', 'limit'].includes(key)) ||
            ['afterSeq', 'beforeSeq', 'limit'].some(key => url.searchParams.getAll(key).length > 1) ||
            url.searchParams.has('afterSeq') && url.searchParams.has('beforeSeq')) throw failure('INVALID_REQUEST');
        const afterText = url.searchParams.get('afterSeq'), beforeText = url.searchParams.get('beforeSeq');
        const limitText = url.searchParams.get('limit') ?? '100';
        if (afterText !== null && !/^-?\d+$/.test(afterText) || beforeText !== null && !/^\d+$/.test(beforeText) ||
            !/^\d+$/.test(limitText)) throw failure('INVALID_REQUEST');
        const afterSeq = afterText === null ? undefined : Number(afterText),
          beforeSeq = beforeText === null ? undefined : Number(beforeText), limit = Number(limitText);
        if (afterSeq !== undefined && (!Number.isSafeInteger(afterSeq) || afterSeq < -1) ||
            beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0) ||
            !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) throw failure('INVALID_REQUEST');
        const page = await context.callBackend(() => context.backend.readEvents({ sessionId,
          ...(afterSeq === undefined ? {} : { afterSeq }), ...(beforeSeq === undefined ? {} : { beforeSeq }), limit, ownerId }));
        if (!plainObject(page) || !Array.isArray(page.events) || page.events.length > limit ||
            typeof page.hasMore !== 'boolean' || !Number.isSafeInteger(page.nextSeq)) {
          throw failure('BACKEND_UNAVAILABLE', 503);
        }
        let last = afterSeq ?? -1;
        for (const event of page.events) {
          if (!plainObject(event) || !Number.isSafeInteger(event.seq) || event.seq <= last ||
              typeof event.type !== 'string' || event.type.length > 128) throw failure('BACKEND_UNAVAILABLE', 503);
          last = event.seq;
        }
        if (page.nextSeq < last || page.nextSeq < (afterSeq ?? -1) ||
            (page.hasMore && page.nextSeq === afterSeq)) throw failure('BACKEND_UNAVAILABLE', 503);
        for (const event of page.events) {
          if (!Object.hasOwn(event, 'data') || event.seq > page.nextSeq ||
              (event.at !== undefined && (typeof event.at !== 'string' || event.at.length > 64)) ||
              !(event.data === null || plainObject(event.data) || Array.isArray(event.data))) {
            throw failure('BACKEND_UNAVAILABLE', 503);
          }
        }
        const projection = {
          cacheAllowed: !hasPrivateContent(context.accountState(ownerId).sessions[sessionId]),
          ...(beforeSeq === undefined && page.liveEvents ? { liveSeq: page.liveSeq, liveEvents: context.publicLiveEvents(ownerId, sessionId, page.liveEvents) } : {}),
          events: page.events.map((rawEvent) => {
            const event = context.publicHistoryEvent(ownerId, sessionId, rawEvent);
            const data = plainObject(event.data) && event.data.truncated === false
              ? Object.fromEntries(Object.entries(event.data).filter(([key]) => key !== 'truncated'))
              : event.data;
            return ({
            seq: event.seq, type: event.type,
            ...(typeof event.at === 'string' ? { at: event.at.slice(0, 64) } : {}),
            data,
          }); }),
          nextSeq: page.nextSeq, hasMore: page.hasMore,
          ...(Object.hasOwn(page, 'nextBeforeSeq') ? { nextBeforeSeq: page.nextBeforeSeq, hasOlder: page.hasOlder, latestSeq: page.latestSeq } : {}),
        };
        // Attachment-backed message restoration can grow the adapter's text.
        // Keep the same directional page semantics after the public projection.
        while (projection.events.length > 1 && Buffer.byteLength(JSON.stringify(projection), 'utf8') > 960_000) {
          if (afterSeq !== undefined) {
            projection.events.pop(); projection.hasMore = true;
            projection.nextSeq = projection.events.at(-1).seq;
          } else {
            projection.events.shift(); projection.hasOlder = true;
            projection.nextBeforeSeq = projection.events[0].seq;
          }
        }
        if (Buffer.byteLength(JSON.stringify(projection), 'utf8') > 960_000) {
          const event = projection.events[0];
          if (event) event.data = { text: typeof event.data?.text === 'string' ? event.data.text.slice(0, 4000) : '', truncated: true };
        }
        return context.json(response, 200, projection);
      }
      const taskMatch = /^\/personal\/v1\/tasks\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (request.method === 'GET' && taskMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const taskId = id(taskMatch[1]);
        context.taskSource(state, taskId);
        await context.driveTaskStop(ownerId, taskId);
        return context.json(response, 200, await context.taskDetail(context.accountState(ownerId), taskId));
      }
      const taskSourceMatch = /^\/personal\/v1\/tasks\/([A-Za-z0-9_-]+)\/sources\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (request.method === 'GET' && taskSourceMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const taskId = id(taskSourceMatch[1]), snapshotId = id(taskSourceMatch[2]);
        context.taskSource(state, taskId);
        const source = state.projectSources?.[snapshotId] ?? state.browserSources?.[snapshotId];
        if (!source || source.taskId !== taskId || source.ownerId !== ownerId) throw failure('NOT_FOUND', 404);
        const bytes = await context.artifactStore.inspect(ownerId, taskId, snapshotId,
          { size: source.textSize, sha256: source.textSha256 });
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        return context.json(response, 200, { source: { ...publicSource(source), text: bytes.toString('utf8'),
          // Native v10 source preview verifies fileSha256 over delivered text.
          // For a webpage this is the same captured-body hash, not a project-file claim.
          ...(source.kind === 'webpage' ? { fileSha256: source.textSha256 } : {}) } });
      }
      const taskActionMatch = /^\/personal\/v1\/tasks\/([A-Za-z0-9_-]+)\/(supplements|stop|resume|cancel)$/.exec(pathname);
      const projectSessionMatch = /^\/personal\/v1\/projects\/([A-Za-z0-9_-]+)\/sessions$/.exec(pathname);
      const browserSessionPath = pathname === '/personal/v1/workspaces/browser/sessions';
      if (request.method === 'POST' && ['stop', 'cancel'].includes(taskActionMatch?.[2])) {
        const queuedOnly = taskActionMatch[2] === 'cancel';
        if (url.search) throw failure('INVALID_REQUEST');
        const taskId = id(taskActionMatch[1]);
        const body = await context.readJson(request);
        exactKeys(body, ['requestId'], ['requestId']);
        if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) throw failure('INVALID_REQUEST');
        await context.serial(async () => {
          const current = context.authenticate(request, 'commands:write');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          const account = context.accountState(ownerId);
          const source = context.taskSource(account, taskId);
          const prior = Object.values(account.commands).flatMap(command => command.taskControl?.stopRequests ?? [])
            .find(entry => entry.requestId === body.requestId);
          if (prior && Boolean(prior.queuedOnly) !== queuedOnly) throw failure('REQUEST_CONFLICT', 409);
          let outcomes;
          if (queuedOnly && !prior) {
            if (context.requestIdUsed(account, body.requestId) || context.interactionRequestIdUsed(account, body.requestId)) {
              throw failure('REQUEST_CONFLICT', 409);
            }
            if (source.taskControl?.state === 'stop_requested' || !['pending', 'accepted_by_dsh'].includes(source.state)) {
              throw failure('TASK_NOT_READY', 409);
            }
            if (source.state === 'accepted_by_dsh') {
              if (!source.receiptId || typeof context.backend.stopTask !== 'function') throw failure('TASK_NOT_READY', 409);
              const result = await context.callBackend(() => context.backend.stopTask({
                sessionId: source.sessionId, ownerId, requestId: body.requestId,
                receiptIds: [source.receiptId], queuedOnly: true }));
              if (result?.outcomes?.length !== 1 || result.outcomes[0].receiptId !== source.receiptId ||
                  result.outcomes[0].status !== 'queue_removed') throw failure('TASK_NOT_READY', 409);
              outcomes = result.outcomes;
            }
          }
          await context.mutate(ownerId, (next) => {
            const current = context.authenticate(request, 'commands:write');
            if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
            const source = context.taskSource(next, taskId);
            const usedByCommand = Object.values(next.commands).some((item) => item.requestId === body.requestId);
            const priorTask = Object.values(next.commands).find((item) =>
              item.taskControl?.stopRequests.some((entry) => entry.requestId === body.requestId));
            if (usedByCommand || next.modelOperations?.[body.requestId] || next.projectOperations?.[body.requestId] ||
                context.interactionRequestIdUsed(next, body.requestId) ||
                (priorTask && priorTask.commandId !== taskId)) throw failure('REQUEST_CONFLICT', 409);
            if (priorTask) return;
            const now = new Date(context.timestamp()).toISOString();
            const control = source.taskControl ?? { state: 'active', stopRequests: [], updatedAt: now };
            if (control.state === 'stop_requested' || control.stopRequests.length >= 100) {
              throw failure('TASK_NOT_READY', 409);
            }
            control.state = 'stop_requested';
            control.stopRequests.push({ requestId: body.requestId, at: now,
              ...(queuedOnly ? { queuedOnly: true } : {}),
              targets: context.stopTargets(next, taskId).map(target => outcomes?.some(outcome =>
                outcome.receiptId === target.receiptId) ? { ...target, ack: 'queue_removed', ackAt: now } : target) });
            control.updatedAt = now;
            source.taskControl = control;
            for (const item of [source, ...context.taskChildren(next, taskId)]) {
              for (const row of item.toolApprovals ?? []) invalidateToolApproval(row, 'task_stopped', now);
              for (const row of item.userQuestions ?? []) invalidateUserQuestion(row, 'TASK_NOT_READY', now);
              if (item.state === 'pending') {
                item.state = 'rejected'; item.errorCode = 'TASK_NOT_READY'; item.updatedAt = now;
              }
            }
          });
        });
        if (context.accountState(ownerId).commands[taskId]?.taskControl?.state === 'stop_requested' &&
            context.accountState(ownerId).sessions[context.accountState(ownerId).commands[taskId].sessionId]?.workspaceKind === 'browser') {
          context.browserReader?.cancelTask(ownerId, taskId);
        }
        await context.driveTaskStop(ownerId, taskId, true);
        return context.json(response, 202, { task: await context.taskDetail(context.accountState(ownerId), taskId) });
      }
      const artifactMatch = /^\/personal\/v1\/artifacts\/([A-Za-z0-9_-]+)(?:\/(preview|download))?$/.exec(pathname);
      if (request.method === 'GET' && artifactMatch) {
        if (url.search) throw failure('INVALID_REQUEST');
        const artifactId = id(artifactMatch[1]);
        const command = Object.values(state.commands).find((item) =>
          item.kind === INTERNAL_ARTIFACT_KIND && item.artifactId === artifactId);
        if (!command || command.state !== 'observed' ||
            command.verification?.status !== 'observed' ||
            state.sessions[command.sessionId]?.origin !== 'personal-remote' ||
            state.commands[command.taskId]?.kind !== 'session.message') throw failure('NOT_FOUND', 404);
        let bytes;
        try { bytes = await context.artifactStore.inspect(ownerId, command.taskId, artifactId, command); }
        catch { throw failure('ARTIFACT_UNVERIFIED', 409); }
        // Credentials may be revoked while the private file is being read.
        const current = context.authenticate(request, 'sessions:read');
        if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
        if (!artifactMatch[2]) return context.json(response, 200, { artifact: publicCommand(command) });
        if (artifactMatch[2] === 'preview') return context.json(response, 200,
          { artifact: publicCommand(command), text: bytes.toString('utf8') });
        response.writeHead(200, {
          'content-type': artifactContentType(command.fileName),
          'content-disposition': attachmentDisposition(command.fileName),
          'content-length': String(bytes.length), 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        return response.end(bytes);
      }
      if (request.method === 'GET' && pathname === '/personal/v1/commands') {
        if ([...url.searchParams.keys()].some((key) => !['before', 'limit'].includes(key)) ||
            url.searchParams.getAll('before').length > 1 || url.searchParams.getAll('limit').length > 1) {
          throw failure('INVALID_REQUEST');
        }
        const before = url.searchParams.get('before');
        const limitText = url.searchParams.get('limit') ?? '50';
        if (!/^\d+$/.test(limitText)) throw failure('INVALID_REQUEST');
        const limit = Number(limitText);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw failure('INVALID_REQUEST');
        if (before !== null && (!validId(before) || !Object.hasOwn(state.commands, before))) {
          throw failure('NOT_FOUND', 404);
        }
        const ordered = Object.values(state.commands).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.commandId.localeCompare(a.commandId));
        const start = before === null ? 0 : ordered.findIndex((item) => item.commandId === before) + 1;
        const page = ordered.slice(start, start + limit);
        const hasMore = start + limit < ordered.length;
        return context.json(response, 200, { commands: page.map(publicCommand),
          nextBefore: hasMore ? page.at(-1).commandId : null, hasMore });
      }
      const requestMatch = /^\/personal\/v1\/commands\/by-request\/([A-Za-z0-9_.:-]+)$/.exec(pathname);
      if (request.method === 'GET' && requestMatch) {
        if (url.search || requestMatch[1].length > 128 || !REQUEST_ID.test(requestMatch[1])) {
          throw failure('INVALID_REQUEST');
        }
        const command = Object.values(state.commands).find((item) => item.requestId === requestMatch[1]);
        if (!command) throw failure('NOT_FOUND', 404);
        return context.json(response, 200, { command: publicCommand(command) });
      }
      if (request.method === 'GET' && /^\/personal\/v1\/commands\/[A-Za-z0-9_-]+$/.test(pathname)) {
        if (url.search) throw failure('INVALID_REQUEST');
        const commandId = pathname.split('/').at(-1);
        if (!Object.hasOwn(state.commands, commandId)) throw failure('NOT_FOUND', 404);
        const command = state.commands[commandId];
        return context.json(response, 200, { command: publicCommand(command) });
      }
      const temporarySessionPath = pathname === '/personal/v1/sessions/temporary';
      if (request.method === 'POST' && (pathname === '/personal/v1/commands' || temporarySessionPath ||
          (taskActionMatch && ['supplements', 'resume'].includes(taskActionMatch[2])) || projectSessionMatch || browserSessionPath ||
          sharedConversationMatch)) {
        if (url.search) throw failure('INVALID_REQUEST');
        const taskAction = taskActionMatch?.[2] === 'supplements' ? 'supplement'
          : taskActionMatch?.[2] === 'resume' ? 'resume' : null;
        const rootTaskId = taskAction ? id(taskActionMatch[1]) : null;
        let body = await context.readJson(request);
        const waitForReceipt = body?.waitForReceipt === true;
        if (Object.hasOwn(body ?? {}, 'waitForReceipt')) {
          if (typeof body.waitForReceipt !== 'boolean' || !['session.create', 'session.side.create'].includes(body.kind)) throw failure('INVALID_REQUEST');
          body = { ...body }; delete body.waitForReceipt;
        }
        const creationReceipt = async command => {
          if (!waitForReceipt) return command;
          // The command is already durable and dispatch owns its deadline.
          // Waiting outside serial() lets the terminal durable commit finish.
          await context.activeByCommand.get(`${ownerId}|${command.commandId}`);
          context.authenticate(request, 'commands:write');
          return publicCommand(context.accountState(ownerId).commands[command.commandId]);
        };
        if (['session.message', 'chat.message'].includes(body.kind)) context.nextSuggestions.cancel(ownerId);
        if (temporarySessionPath) {
          exactKeys(body, ['requestId','modelProfileId','recallEnabled','autoDeleteDays'], ['requestId','modelProfileId']);
          body = { ...body, kind:'session.create', targetDeviceId:state.hostId, temporary:true };
        }
        if (taskAction) exactKeys(body, ['requestId', 'text'], ['requestId', 'text']);
        if (pathname === '/personal/v1/commands' && body.kind === 'chat.message') {
          return context.json(response, 202, { command: await context.mainChat.submit(ownerId, deviceId, body,
            () => context.authenticate(request, 'commands:write')) });
        }
        if (projectSessionMatch) exactKeys(body, ['requestId', 'modelProfileId'], ['requestId', 'modelProfileId']);
        if (browserSessionPath) exactKeys(body, ['requestId', 'modelProfileId'], ['requestId', 'modelProfileId']);
        if (sharedConversationMatch) exactKeys(body, ['requestId', 'modelProfileId', 'expectedSyncSeq',
          'acknowledgeUncertainLocalTurn'],
          ['requestId', 'modelProfileId', 'expectedSyncSeq']);
        const rootSource = taskAction ? context.taskSource(state, rootTaskId) : null;
        if (rootSource) {
          const segment = state.chatIdentity.segments[state.chatIdentity.sessionSegments[rootSource.sessionId]];
          const logical = state.chatIdentity.chats[segment?.chatId];
          if (logical?.kind === 'main' && segment.state === 'sealed') throw failure('MAIN_CHAT_ROUTE_REQUIRED', 409);
          if (logical?.kind === 'main' && logical.relay) throw failure('SESSION_BUSY', 409);
        }
        const requestedProjectId = projectSessionMatch ? id(projectSessionMatch[1]) : null;
        const requestedProject = requestedProjectId ? state.projects?.[requestedProjectId] : null;
        const adoptionId = sharedConversationMatch?.[1] ?? null;
        const adoptionSnapshot = adoptionId ? context.conversationSnapshot(ownerId, adoptionId) : null;
        const priorAdoptionCommand = adoptionId ? Object.values(state.commands).find((item) =>
          item.requestId === body.requestId) : null;
        if (adoptionId && (!REQUEST_ID.test(body.requestId ?? '') ||
            !Number.isSafeInteger(body.expectedSyncSeq) || body.expectedSyncSeq < 1 ||
            !MODEL_PROFILE_ID.test(body.modelProfileId ?? '') ||
            (body.acknowledgeUncertainLocalTurn !== undefined &&
              body.acknowledgeUncertainLocalTurn !== true))) throw failure('INVALID_REQUEST');
        if (adoptionId && priorAdoptionCommand &&
            (priorAdoptionCommand.kind !== 'session.create' ||
              priorAdoptionCommand.payload.conversationId !== adoptionId ||
              priorAdoptionCommand.payload.modelProfileId !== body.modelProfileId ||
              priorAdoptionCommand.payload.cutoverSyncSeq !== body.expectedSyncSeq ||
              Boolean(priorAdoptionCommand.payload.acknowledgeUncertainLocalTurn) !==
                Boolean(body.acknowledgeUncertainLocalTurn))) {
          throw failure('REQUEST_CONFLICT', 409);
        }
        if (adoptionId && !priorAdoptionCommand && state.conversationBindings?.[adoptionId]) {
          throw failure('CONVERSATION_NOT_READY', 409);
        }
        if (adoptionId && !priorAdoptionCommand) {
          if (!context.sourceDevicesUpgraded(ownerId, adoptionSnapshot)) {
            throw failure('SOURCE_DEVICE_UPGRADE_REQUIRED', 409);
          }
          const turns = Object.values(state.conversationLocalTurns ?? {})
            .filter((item) => item.conversationId === adoptionId);
          if (turns.some((item) => context.localTurnState(adoptionSnapshot, item) === 'running')) {
            throw failure('LOCAL_TURN_RUNNING', 409);
          }
          const uncertain = turns.some((item) => context.localTurnState(adoptionSnapshot, item) === 'uncertain');
          if (uncertain && body.acknowledgeUncertainLocalTurn !== true) {
            throw failure('LOCAL_TURN_UNCONFIRMED', 409);
          }
          if (adoptionSnapshot.unfinished && !(uncertain && body.acknowledgeUncertainLocalTurn === true)) {
            throw failure('CONVERSATION_NOT_READY', 409);
          }
        }
        if (adoptionId && !priorAdoptionCommand && adoptionSnapshot.latestSeq !== body.expectedSyncSeq) {
          throw failure('CONVERSATION_SYNC_CHANGED', 409);
        }
        if (requestedProjectId && (!context.hostOwner(ownerId) || !requestedProject)) throw failure('NOT_FOUND', 404);
        if (browserSessionPath && (!context.hostOwner(ownerId) || context.browserReader?.status()?.available !== true)) {
          throw failure(context.browserReader?.status()?.lastFailure === 'BROWSER_CLEANUP_FAILED'
            ? 'BROWSER_CLEANUP_FAILED' : 'BROWSER_UNAVAILABLE', 503);
        }
        const priorProjectCommand = requestedProjectId ? Object.values(state.commands).find((item) =>
          item.requestId === body.requestId && item.kind === 'session.create' &&
          item.payload.projectId === requestedProjectId && item.payload.modelProfileId === body.modelProfileId) : null;
        const adoptionContext = adoptionId && !priorAdoptionCommand
          ? buildConversationContext(adoptionSnapshot) : null;
        const rawPayload = adoptionId ? {
          requestId: body.requestId, kind: 'session.create', targetDeviceId: state.hostId,
          modelProfileId: body.modelProfileId, conversationId: adoptionId,
          cutoverSyncSeq: priorAdoptionCommand?.payload.cutoverSyncSeq ?? body.expectedSyncSeq,
          contextHash: priorAdoptionCommand?.payload.contextHash ?? adoptionContext.contextHash,
          ...(body.acknowledgeUncertainLocalTurn ? { acknowledgeUncertainLocalTurn: true } : {}),
        } : browserSessionPath ? {
          requestId: body.requestId, kind: 'session.create', targetDeviceId: state.hostId,
          modelProfileId: body.modelProfileId, workspaceKind: 'browser',
        } : projectSessionMatch ? {
          requestId: body.requestId, kind: 'session.create', targetDeviceId: state.hostId,
          modelProfileId: body.modelProfileId, projectId: requestedProjectId,
          projectRevision: priorProjectCommand?.payload.projectRevision ?? requestedProject.revision,
        } : taskAction ? {
          requestId: body.requestId, kind: 'session.message', targetDeviceId: state.hostId,
          sessionId: rootSource.sessionId, text: body.text,
          mode: taskAction === 'supplement' ? 'steer' : 'queue', rootTaskId, taskAction,
        } : body.kind === 'session.side.create' ? await context.sideChats.prepare(ownerId, body) : canonicalCommand(body, state.hostId);
        const projectBinding = rawPayload.kind === 'session.message' ? taskAction
          ? rootSource.payload : state.sessions[rawPayload.sessionId] : null;
        const conversationBinding = rawPayload.kind === 'session.message' ? taskAction
          ? rootSource.payload.conversationId : state.sessions[rawPayload.sessionId]?.conversationId : null;
        const browserBinding = rawPayload.kind === 'session.message' &&
          (taskAction ? rootSource.payload.workspaceKind : state.sessions[rawPayload.sessionId]?.workspaceKind) === 'browser';
        let payload = canonicalCommand({ ...rawPayload,
          ...(projectBinding?.projectId ? { projectId: projectBinding.projectId,
            projectRevision: projectBinding.projectRevision } : {}),
          ...(conversationBinding ? { conversationId: conversationBinding } : {}),
          ...(browserBinding ? { workspaceKind: 'browser', initialUrls: taskAction
            ? rootSource.payload.initialUrls : initialBrowserUrls(rawPayload.text, context.browserReader) } : {}) }, state.hostId, true);
        const prior = Object.values(state.commands).find((command) => command.requestId === payload.requestId);
        if (prior && payload.kind === 'session.message' && (payload.attachments || payload.originalAttachments)) {
          // Compare the canonical request against its durable command before
          // touching staging, which acceptance may already have released.
          payload = canonicalCommand({ ...payload, modelInputHash: prior.payload.modelInputHash }, state.hostId, true);
        } else if (payload.kind === 'session.message' && (payload.attachments || payload.originalAttachments)) {
          const staged = payload.attachments ? await context.sharedAttachmentStores.get(ownerId).resolve({
            sessionId: payload.sessionId, requestId: payload.requestId, attachments: payload.attachments }) : [];
          payload = canonicalCommand({ ...payload, modelInputHash: digest(modelTextWithAttachments(
            payload.text, staged, payload.originalAttachments)) }, state.hostId, true);
        }
        context.requireOpen();
        if (context.storageFault) throw failure('STORAGE_UNAVAILABLE', 503);
        if (payload.kind === 'desktop.open_app' && typeof context.backend.openDesktopApp !== 'function') {
          throw failure('CAPABILITY_UNAVAILABLE', 503);
        }
        if (payload.kind === 'desktop.open_app' && !context.hostOwner(ownerId)) {
          throw failure('CAPABILITY_UNAVAILABLE', 403);
        }
        if (payload.kind === 'session.create' && !context.modelSelectable(ownerId, payload.modelProfileId)) {
          throw failure('MODEL_UNAVAILABLE', 422);
        }
        const payloadHash = digest(JSON.stringify(payload));
        if (context.interactionRequestIdUsed(state, payload.requestId)) throw failure('REQUEST_CONFLICT', 409);
        if (state.modelOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
        if (state.projectOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
        if (state.chatOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
        if (state.sideOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
        if (Object.values(state.commands).some((command) =>
          command.taskControl?.stopRequests.some((entry) => entry.requestId === payload.requestId))) {
          throw failure('REQUEST_CONFLICT', 409);
        }
        if (prior) {
          if (prior.payloadHash !== payloadHash) throw failure('REQUEST_CONFLICT', 409);
          return context.json(response, 202, taskAction
            ? { task: await context.taskDetail(state, rootTaskId), command: publicCommand(prior) }
            : adoptionId ? { ...context.conversationProjection(ownerId, adoptionId), command: publicCommand(prior) }
              : { command: await creationReceipt(publicCommand(prior)) });
        }
        if (payload.kind === 'session.message' && !taskAction) protectMainSession(state, payload.sessionId, 'MAIN_CHAT_ROUTE_REQUIRED');
        if (payload.projectId && (state.projects?.[payload.projectId]?.revoked ||
            state.projects?.[payload.projectId]?.revision !== payload.projectRevision)) {
          throw failure('PROJECT_REVOKED', 409);
        }
        if (taskAction === 'supplement' &&
            (rootSource.taskControl?.state === 'stop_requested' || context.taskHasUnknownEffects(state, rootTaskId))) {
          throw failure('TASK_NOT_READY', 409);
        }
        const resumeReady = taskAction === 'resume' && rootSource.taskControl?.state === 'stop_requested'
          ? (await context.taskStopEvidence(state, rootTaskId)).ready : false;
        if (taskAction === 'resume' && !resumeReady) throw failure('TASK_NOT_READY', 409);
        // A session must be bound to this owner before even the read-only
        // backend preflight can inspect its model or history.
        if (payload.sessionId && (!Object.hasOwn(state.sessions, payload.sessionId) ||
            state.sessions[payload.sessionId].ownerId !== state.ownerId)) {
          throw failure('SESSION_UNAVAILABLE', 404);
        }
        if (payload.kind === 'session.message' &&
            (state.sessions[payload.sessionId].archived === true || state.sessions[payload.sessionId].deleting === true)) throw failure('SESSION_ARCHIVED', 409);
        if (payload.kind === 'session.message' &&
            !['personal-remote', 'shared-chat'].includes(state.sessions[payload.sessionId].origin)) {
          throw failure('SESSION_READ_ONLY', 409);
        }
        if (payload.kind === 'session.message' &&
            !context.messageModelUsable(ownerId, state.sessions[payload.sessionId])) {
          throw failure('MODEL_UNAVAILABLE', 422);
        }
        if (payload.kind === 'session.message') {
          const catalog = await context.backend.listModels({ ownerId });
          const model = catalog.find(row => row.id === state.sessions[payload.sessionId].modelProfileId);
          if (model) context.usage.assertAllowed(ownerId, model);
        }
        if (payload.kind === 'session.message' && payload.sourceSyncEventId &&
            (!payload.conversationId || !context.verifiedSyncUserEvent(ownerId, payload.conversationId,
              payload.sourceSyncEventId, payload.text, deviceId) ||
              Object.values(state.commands).some((item) =>
                item.payload.sourceSyncEventId === payload.sourceSyncEventId))) {
          throw failure('REQUEST_CONFLICT', 409);
        }
        if (payload.kind === 'session.message' && payload.attachments) {
          await context.sharedAttachmentStores.get(ownerId).resolve({ sessionId: payload.sessionId,
            requestId: payload.requestId, attachments: payload.attachments });
        }
        if (payload.kind === 'session.message' && payload.originalAttachments) {
          await context.requireOriginalAttachments(ownerId, payload.sessionId, payload.attachmentMessageId,
            payload.originalAttachments);
        }
        const preflightKey = `${ownerId}|${payload.requestId}`;
        const preflightHash = payload.sideChat?.requestHash ?? payloadHash;
        const pendingPreflight = context.pendingPreflights.get(preflightKey);
        if (pendingPreflight && pendingPreflight.hash !== preflightHash) throw failure('REQUEST_CONFLICT', 409);
        let preflight;
        if (pendingPreflight) preflight = pendingPreflight.promise;
        else {
          preflight = context.callBackend(() => context.backend.preflight({ ...payload, ownerId }));
          context.pendingPreflights.set(preflightKey, { hash: preflightHash, promise: preflight });
          preflight.finally(() => {
            if (context.pendingPreflights.get(preflightKey)?.promise === preflight) {
              context.pendingPreflights.delete(preflightKey);
            }
          }).catch(() => {});
        }
        try { await preflight; }
        catch (error) { throw failure(safeCode(error), error?.code === 'MODEL_UNAVAILABLE' ? 422
          : error?.code === 'SESSION_READ_ONLY' ? 409 : 503); }
        context.requireOpen();
        const result = await context.serial(async () => {
          context.requireOpen();
          const current = context.authenticate(request, 'commands:write');
          if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
          const latest = context.accountState(ownerId);
          if (context.interactionRequestIdUsed(latest, payload.requestId)) throw failure('REQUEST_CONFLICT', 409);
          if (latest.modelOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
          if (latest.projectOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
          if (latest.chatOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
          if (latest.sideOperations?.[payload.requestId]) throw failure('REQUEST_CONFLICT', 409);
          if (Object.values(latest.commands).some((command) =>
            command.taskControl?.stopRequests.some((entry) => entry.requestId === payload.requestId))) {
            throw failure('REQUEST_CONFLICT', 409);
          }
          const existing = Object.values(latest.commands).find((command) =>
            command.ownerId === ownerId && command.requestId === payload.requestId);
          if (existing) {
            if (existing.payloadHash !== payloadHash && !(payload.sideChat &&
                existing.payload.sideChat?.requestHash === payload.sideChat.requestHash)) throw failure('REQUEST_CONFLICT', 409);
            return publicCommand(existing);
          }
          if (payload.sideChat) context.sideChats.validatePrepared(ownerId, payload.sideChat);
          if (latest.memoryCleanupPending) throw failure('SESSION_BUSY', 409);
          if (adoptionId) {
            const fresh = context.conversationSnapshot(ownerId, adoptionId);
            if (!context.sourceDevicesUpgraded(ownerId, fresh)) {
              throw failure('SOURCE_DEVICE_UPGRADE_REQUIRED', 409);
            }
            const turns = Object.values(latest.conversationLocalTurns ?? {})
              .filter((item) => item.conversationId === adoptionId);
            const running = turns.some((item) => context.localTurnState(fresh, item) === 'running');
            const uncertain = turns.some((item) => context.localTurnState(fresh, item) === 'uncertain');
            if (latest.conversationBindings?.[adoptionId] || running ||
                (uncertain && body.acknowledgeUncertainLocalTurn !== true) ||
                (fresh.unfinished && !(uncertain && body.acknowledgeUncertainLocalTurn === true))) {
              throw failure('CONVERSATION_NOT_READY', 409);
            }
            if (fresh.latestSeq !== body.expectedSyncSeq ||
                buildConversationContext(fresh).contextHash !== payload.contextHash) {
              throw failure('CONVERSATION_SYNC_CHANGED', 409);
            }
          }
          if (payload.projectId && (latest.projects?.[payload.projectId]?.revoked ||
              latest.projects?.[payload.projectId]?.revision !== payload.projectRevision)) {
            throw failure('PROJECT_REVOKED', 409);
          }
          if (taskAction) {
            const source = context.taskSource(latest, rootTaskId);
            if (source.sessionId !== payload.sessionId ||
                (taskAction === 'supplement' && (source.taskControl?.state === 'stop_requested' ||
                  context.taskHasUnknownEffects(latest, rootTaskId))) ||
                (taskAction === 'resume' &&
                  (source.taskControl?.state !== 'stop_requested' ||
                    source.taskControl.updatedAt !== rootSource.taskControl.updatedAt ||
                    source.taskControl.stopRequests.length !== rootSource.taskControl.stopRequests.length))) {
              throw failure('TASK_NOT_READY', 409);
            }
          }
          if (!Object.hasOwn(latest.devices, deviceId) || latest.devices[deviceId].revoked ||
              !latest.devices[deviceId].scopes.includes('commands:write')) throw failure('UNAUTHORIZED', 401);
          if (payload.sessionId && (!Object.hasOwn(latest.sessions, payload.sessionId) ||
              latest.sessions[payload.sessionId].ownerId !== ownerId)) throw failure('SESSION_UNAVAILABLE', 404);
          if (payload.kind === 'session.message' && (latest.sessions[payload.sessionId].archived === true || latest.sessions[payload.sessionId].deleting === true))
            throw failure('SESSION_ARCHIVED', 409);
          if (payload.kind === 'session.message' &&
              !['personal-remote', 'shared-chat'].includes(latest.sessions[payload.sessionId].origin)) {
            throw failure('SESSION_READ_ONLY', 409);
          }
          if (payload.kind === 'session.message' &&
              !context.messageModelUsable(ownerId, latest.sessions[payload.sessionId])) {
            throw failure('MODEL_UNAVAILABLE', 422);
          }
          if (payload.kind === 'session.message' && payload.sourceSyncEventId &&
              (!context.verifiedSyncUserEvent(ownerId, payload.conversationId,
                payload.sourceSyncEventId, payload.text, deviceId) ||
                Object.values(latest.commands).some((item) =>
                  item.payload.sourceSyncEventId === payload.sourceSyncEventId))) {
            throw failure('REQUEST_CONFLICT', 409);
          }
          if (payload.kind === 'session.message' && payload.attachments) {
            await context.sharedAttachmentStores.get(ownerId).resolve({ sessionId: payload.sessionId,
              requestId: payload.requestId, attachments: payload.attachments });
          }
          if (payload.kind === 'session.message' && payload.originalAttachments) {
            await context.requireOriginalAttachments(ownerId, payload.sessionId, payload.attachmentMessageId,
              payload.originalAttachments);
          }
          const recorded = Object.values(latest.commands);
          if (recorded.length >= MAX_COMMANDS ||
              recorded.reduce((bytes, command) => bytes +
                (typeof command.payload.text === 'string' ? Buffer.byteLength(command.payload.text, 'utf8') : 0), 0) +
                (typeof payload.text === 'string' ? Buffer.byteLength(payload.text, 'utf8') : 0) > MAX_UNRECONCILED_TEXT_BYTES) {
            throw failure('CAPACITY_LIMIT', 429);
          }
          const commandId = `cmd-${randomUUID()}`;
          const sessionId = payload.kind === 'session.create' ? `session-${randomUUID()}` : payload.sessionId;
          const now = new Date().toISOString();
          await context.mutate(ownerId, (next) => {
            if (adoptionId) {
              next.conversationBindings ??= {};
              if (Object.keys(next.conversationBindings).length >= 500) throw failure('CAPACITY_LIMIT', 429);
              next.conversationBindings[adoptionId] = { conversationId: adoptionId,
                ownerId, sessionId, modelProfileId: payload.modelProfileId, revision: 1,
                status: 'creating', cutoverSyncSeq: body.expectedSyncSeq,
                ...adoptionContext, adoptRequestId: payload.requestId,
                adoptCommandId: commandId, createdAt: now, updatedAt: now };
            }
            next.commands[commandId] = {
              commandId, ownerId: next.ownerId, requestId: payload.requestId,
              payloadHash, payload, sourceDeviceId: deviceId,
              ...(['password', 'cloud'].includes(latest.devices[deviceId].authKind)
                ? { sourceAuthEpoch: latest.devices[deviceId].authEpoch } : {}),
              targetDeviceId: payload.targetDeviceId, kind: payload.kind,
              ...(taskAction ? { rootTaskId, taskAction } : {}),
              ...(sessionId ? { sessionId } : {}), ...(payload.appId ? { appId: payload.appId } : {}),
              state: 'pending', createdAt: now, updatedAt: now,
            };
            if (taskAction === 'resume') {
              const control = next.commands[rootTaskId].taskControl;
              control.state = 'active'; control.updatedAt = now;
            }
          });
          context.schedule(ownerId, commandId);
          return publicCommand(context.accountState(ownerId).commands[commandId]);
        });
        return context.json(response, 202, taskAction
          ? { task: await context.taskDetail(context.accountState(ownerId), rootTaskId), command: result }
          : adoptionId ? { ...context.conversationProjection(ownerId, adoptionId), command: result }
            : { command: await creationReceipt(result) });
      }
      throw failure('NOT_FOUND', 404);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const code = PUBLIC_CODES.has(error?.code) ? error.code : 'SERVICE_UNAVAILABLE';
      const status = code === 'SERVICE_UNAVAILABLE' ? 503
        : Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      context.json(response, status, { error: { code,
        ...(Number.isInteger(error?.nativeStatus) ? { nativeStatus: error.nativeStatus, nativeCode: error.nativeCode } : {}) } });
    }
  }

  return {
    handle,
    handleScoped
  };
}

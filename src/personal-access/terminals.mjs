import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { createTerminalManager } from '../personal-terminal/index.mjs';
import { failure, exactKeys, validId } from './common.mjs';
import { conversationMode } from './work-and-chat.mjs';

export function createTerminalOperations(context) {
  const manager = createTerminalManager();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 70 * 1024, perMessageDeflate: false });
  function current(request) {
    if (context.closing) throw failure('SERVICE_CLOSING', 503);
    if (!context.requestAuthority(request) || (request.headers.origin !== undefined && !context.matchingOrigin(request)))
      throw failure('ORIGIN_NOT_ALLOWED', 403);
    const auth = context.authenticate(request, 'commands:write');
    if (!context.hostOwner(auth.ownerId)) throw failure('FORBIDDEN', 403);
    if (context.dataControls.isLocked(auth.ownerId)) throw failure('SESSION_BUSY', 409);
    return auth;
  }
  async function handle(request, response, url) {
    const match = /^\/personal\/v1\/terminals(?:\/(terminal-[0-9a-f-]{36}))?$/.exec(url.pathname);
    if (!match) return false;
    if (url.search) throw failure('INVALID_REQUEST');
    const auth = current(request), { ownerId, deviceId } = auth;
    if (request.method === 'POST' && !match[1]) {
      const body = await context.readJson(request);
      exactKeys(body, ['conversationId', 'tabId', 'computerId', 'cols', 'rows'], ['conversationId', 'tabId']);
      if (!validId(body.conversationId) || !validId(body.tabId) || body.computerId !== undefined && !validId(body.computerId))
        throw failure('INVALID_REQUEST');
      const account = context.accountState(ownerId), identity = account.chatIdentity;
      if (body.computerId !== undefined && body.computerId !== account.hostId) throw failure('TARGET_UNAVAILABLE', 409);
      const chat = identity?.chats[body.conversationId];
      const sessionId = chat ? identity.segments[chat.activeSegmentId]?.sessionId : body.conversationId;
      const session = account.sessions[sessionId];
      if (!session || session.deleting || session.phoneHistory) throw failure('NOT_FOUND', 404);
      if (session.workHostId && session.workHostId !== account.hostId) throw failure('TARGET_UNAVAILABLE', 409);
      let cwd = homedir();
      if (conversationMode(session) === 'work') {
        const project = account.projects?.[session.projectId];
        if (!project || project.revoked || project.removed) throw failure('PROJECT_NOT_SELECTED', 409);
        cwd = project.rootPath;
      }
      if (!(await stat(cwd).catch(() => null))?.isDirectory()) throw failure('PROJECT_NOT_SELECTED', 409);
      current(request);
      // Directory/mode may have changed while the filesystem call was pending.
      const latest = context.accountState(ownerId);
      if (latest.sessions[sessionId] !== session || latest.projects?.[session.projectId] !== account.projects?.[session.projectId])
        throw failure('SESSION_BUSY', 409);
      let abandoned = false;
      response.once('close', () => { if (!response.writableFinished) abandoned = true; });
      const result = await manager.create({ ownerId, deviceId, ...body, cwd });
      if (abandoned || response.destroyed) { await manager.destroy(ownerId, deviceId, result.terminalId); return true; }
      try { current(request); } catch (error) { await manager.destroy(ownerId, deviceId, result.terminalId); throw error; }
      context.json(response, 201, result);
    } else if (request.method === 'DELETE' && match[1]) {
      await manager.destroy(ownerId, deviceId, match[1]); context.json(response, 200, { closed: true });
    } else throw failure('METHOD_NOT_ALLOWED', 405);
    return true;
  }
  function upgrade(request, socket, head) {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const match = /^\/personal\/v1\/terminals\/(terminal-[0-9a-f-]{36})\/connect$/.exec(url.pathname);
      if (!match || url.search) throw failure('NOT_FOUND', 404);
      const auth = current(request);
      manager.info(auth.ownerId, auth.deviceId, match[1]);
      sockets.handleUpgrade(request, socket, head, ws => {
        let unsubscribe, verified = false;
        const deadline = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
        const send = event => {
          if (ws.readyState !== 1) return;
          if (ws.bufferedAmount > 2 * 1024 * 1024) return ws.close(1013, 'Reconnect to resume');
          ws.send(JSON.stringify(event));
          if (event.type === 'closed') ws.close(1000);
        };
        const timer = setInterval(() => {
          try { current(request); ws.ping(); } catch {
            ws.close(1008, 'Session expired');
            void manager.destroy(auth.ownerId, auth.deviceId, match[1]).catch(() => {});
          }
        }, 15_000);
        ws.on('error', () => {});
        ws.on('close', () => { clearTimeout(deadline); clearInterval(timer); unsubscribe?.(); });
        ws.on('message', bytes => {
          try {
            const message = JSON.parse(bytes.toString());
            if (!verified) {
              if (message.type !== 'resume') throw failure('INVALID_REQUEST');
              // A browser cannot add headers to its upgrade. Its first frame
              // proves the same CSRF secret used by authenticated HTTP writes.
              const proof = { ...request, method: 'POST', headers: { ...request.headers, 'x-weftmate-csrf': message.csrfToken } };
              const active = current(proof);
              if (active.ownerId !== auth.ownerId || active.deviceId !== auth.deviceId) throw failure('UNAUTHORIZED', 401);
              unsubscribe = manager.subscribe(auth.ownerId, auth.deviceId, match[1], message.after, send);
              verified = true; clearTimeout(deadline); return;
            }
            current(request);
            if (message.type === 'input') manager.input(auth.ownerId, auth.deviceId, match[1], message.data);
            else if (message.type === 'resize') manager.resize(auth.ownerId, auth.deviceId, match[1], message.cols, message.rows);
            else throw failure('INVALID_REQUEST');
          } catch { ws.close(1008, 'Invalid terminal request'); }
        });
      });
    } catch (error) {
      socket.end(`HTTP/1.1 ${error.status ?? 403} Rejected\r\nConnection: close\r\n\r\n`);
    }
  }
  async function handleRelease(request, response, url) {
    const match = /^\/personal\/v1\/terminals\/(terminal-[0-9a-f-]{36})\/release$/.exec(url.pathname);
    if (!match) return false;
    if (request.method !== 'POST' || url.search) throw failure('INVALID_REQUEST');
    context.requireBrowserOrigin(request);
    const body = await context.readJson(request);
    exactKeys(body, ['releaseToken'], ['releaseToken']);
    if (typeof body.releaseToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.releaseToken)) throw failure('INVALID_REQUEST');
    // This unguessable, release-only proof came from the original authenticated
    // creation. It conveys no input/output authority and survives cookie rotation.
    await manager.release(match[1], body.releaseToken);
    context.json(response, 200, { closed: true }); return true;
  }
  return { handle, handleRelease, upgrade, async close() {
    for (const ws of sockets.clients) ws.terminate();
    await manager.close(); sockets.close();
  } };
}

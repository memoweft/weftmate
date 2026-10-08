/* Android transport adapter. Cookies, CSRF and model credentials stay in Kotlin. */
(() => {
  function createAndroidBridge({ postMessage, onEvent = () => {}, timeout = 45000 } = {}) {
    let sequence = 0;
    const pending = new Map();
    function call(method, params = {}, timeoutMs = timeout) {
      if (!postMessage) return Promise.reject(new Error('NATIVE_UNAVAILABLE'));
      const id = `r${++sequence}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('TIMEOUT')); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        postMessage(JSON.stringify({ id, method, params }));
      });
    }
    function receive(event) {
      let message;
      try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event; } catch { return; }
      const task = pending.get(message.id);
      if (task) {
        pending.delete(message.id); clearTimeout(task.timer);
        if (message.ok) task.resolve(message.result);
        else task.reject(Object.assign(new Error(message.error?.code || 'OPERATION_FAILED'), { status: message.error?.status }));
      } else if (message.event) onEvent(message);
    }
    const account = profile => ({ ...profile, ownerId: profile.ownerId || profile.owner, username: profile.username || '' });
    async function route(path, method, body) {
      const url = new URL(path, 'https://appassets.androidplatform.net');
      const pathname = url.pathname, query = url.searchParams;
      const match = expression => expression.exec(pathname);
      let row;
      if (pathname === '/personal/v1/auth/me') {
        const profile = await call('auth.me');
        return { ...profile, account: account(profile), device: profile.device, csrfToken: 'native-managed' };
      }
      if (pathname === '/personal/v1/auth/devices') return call('auth.devices');
      if (pathname === '/personal/v1/auth/profile') return call('auth.profile', body);
      if (pathname === '/personal/v1/auth/change-password') return call('auth.changePassword', body);
      if ((row = match(/^\/personal\/v1\/auth\/devices\/([^/]+)$/))) return call(method === 'DELETE' ? 'auth.revokeDevice' : 'auth.renameDevice', { deviceId: decodeURIComponent(row[1]), ...body });
      if (pathname === '/personal/v1/sessions') {
        const result = await call('shared.sessions.list');
        if (result.source !== 'host' || !Array.isArray(result.sessions)) throw new Error('OPERATION_FAILED');
        return result;
      }
      if ((row = match(/^\/personal\/v1\/sessions\/([^/]+)\/events$/))) {
        const sessionId = decodeURIComponent(row[1]);
        const result = await call('shared.sessions.events', { sessionId,
          ...(query.has('afterSeq') ? { afterSeq: Number(query.get('afterSeq')) } : {}),
          ...(query.has('beforeSeq') ? { beforeSeq: Number(query.get('beforeSeq')) } : {}) });
        if (result.source !== 'host' || result.sessionId !== sessionId) throw new Error('COMMAND_RECEIPT_INVALID');
        return result;
      }
      if ((row = match(/^\/personal\/v1\/sessions\/([^/]+)\/events\/(\d+)\/detail$/))) return call('shared.sessions.eventDetail', { sessionId: decodeURIComponent(row[1]), seq: Number(row[2]) });
      if ((row = match(/^\/personal\/v1\/sessions\/([^/]+)\/(approvals|questions)(?:\/([^/]+))?$/))) {
        const sessionId = decodeURIComponent(row[1]), kind = row[2];
        return call(`shared.${kind}.${method === 'GET' ? 'list' : kind === 'approvals' ? 'decide' : 'answer'}`, {
          sessionId, ...(query.has('before') ? { before: query.get('before') } : {}),
          ...(row[3] ? { [kind === 'approvals' ? 'approvalId' : 'questionRpcId']: decodeURIComponent(row[3]) } : {}),
          ...(kind === 'approvals' && body?.outcome === 'allowed-once' ? { scope: 'once' } : {}), ...body });
      }
      if (pathname === '/personal/v1/commands' && method === 'GET') {
        const result = await call('activity.list');
        if (result.hostAvailable === false) throw new Error('HOST_UNAVAILABLE');
        return { commands: (result.activities || []).filter(item => item.source === 'host').map(item => ({ ...item,
          commandId: item.commandId || item.id, state: item.state || item.status, receiptId: item.receiptId })), nextBefore: null };
      }
      if ((row = match(/^\/personal\/v1\/commands\/by-request\/([^/]+)$/))) return call('shared.commands.byRequest', { requestId: decodeURIComponent(row[1]) });
      if ((row = match(/^\/personal\/v1\/tasks\/([^/]+)$/))) return call('shared.tasks.detail', { taskId: decodeURIComponent(row[1]) });
      if ((row = match(/^\/personal\/v1\/tasks\/([^/]+)\/stop$/))) return call('shared.tasks.stop', { taskId: decodeURIComponent(row[1]), ...(typeof body === 'string' ? JSON.parse(body) : body) });
      if ((row = match(/^\/personal\/v1\/tasks\/([^/]+)\/sources\/([^/]+)$/))) return call('shared.sources.detail', { taskId: decodeURIComponent(row[1]), snapshotId: decodeURIComponent(row[2]) });
      if ((row = match(/^\/personal\/v1\/artifacts\/([^/]+)\/preview$/))) return call('shared.artifacts.preview', { artifactId: decodeURIComponent(row[1]) });
      if (pathname === '/personal/v1/models') {
        const result = await call('models.host');
        return { ...result, models: (result.models || []).map(item => ({ ...item, id: item.profileId, name: item.displayName, model: item.modelId })) };
      }
      if ((row = match(/^\/personal\/v1\/sync\/conversations\/([^/]+)\/shared$/))) return call('shared.conversations.get', { conversationId: decodeURIComponent(row[1]) });
      // The existing native business router enforces the allowed /personal/v1 paths.
      return call('host.business', { path: pathname + url.search, method, ...(body !== undefined ? { body } : {}) }, pathname.endsWith('/restart') ? 360000 : timeout);
    }
    async function fetch(path, options = {}) {
      try {
        const result = await route(path, options.method || 'GET', options.body === undefined ? undefined : typeof options.body === 'string' ? JSON.parse(options.body) : options.body);
        return { ok: true, status: 200, json: async () => result };
      } catch (error) {
        const code = error.message || 'OPERATION_FAILED';
        return { ok: false, status: error.status || (code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : 503), json: async () => ({ error: { code } }) };
      }
    }
    return { call, receive, fetch, account, nextRequestId: (prefix = 'ui') => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
  }
  globalThis.WeftUiCore.createAndroidBridge = createAndroidBridge;
})();

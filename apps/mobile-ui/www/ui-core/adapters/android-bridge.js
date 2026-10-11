/* Android transport adapter. Cookies, CSRF and model credentials stay in Kotlin. */
(() => {
  function createAndroidBridge({ postMessage, onEvent = () => {}, timeout = 45000 } = {}) {
    let sequence = 0;
    const pending = new Map();
    let waitingReads=0;
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
      if (pathname === '/personal/v1/status') return call('host.status');
      if (pathname === '/personal/v1/commands' && method === 'POST' && body?.kind === 'session.side.create')
        return call('host.business', { path:pathname,method,body });
      if (pathname === '/personal/v1/auth/me') {
        const profile = await call('auth.me');
        return { ...profile, account: account(profile), device: profile.device, csrfToken: 'native-managed' };
      }
      if (pathname === '/personal/v1/auth/devices') return call('auth.devices');
      if (pathname === '/personal/v1/auth/profile') return call('auth.profile', body);
      if (pathname === '/personal/v1/auth/change-password') return call('auth.changePassword', body);
      if ((row = match(/^\/personal\/v1\/auth\/devices\/([^/]+)$/))) return call(method === 'DELETE' ? 'auth.revokeDevice' : 'auth.renameDevice', { deviceId: decodeURIComponent(row[1]), ...body });
      if (pathname === '/personal/v1/projects' && method === 'GET') return call('shared.projects.list');
      if ((row = match(/^\/personal\/v1\/projects\/([^/]+)\/sessions$/)) && method === 'POST') return call('shared.projects.createSession', { projectId: decodeURIComponent(row[1]), ...body });
      if (pathname === '/personal/v1/sessions/temporary' && method === 'POST') return call('host.business', {path:pathname,method,body});
      if (pathname === '/personal/v1/sessions') {
        if (['limit','cursor','q'].some(key => query.has(key))) {
          const result = await call('host.business', {path:pathname + url.search,method});
          return {...result,source:'host',hostAvailable:true};
        }
        const result = await call('shared.sessions.list');
        if (result.source !== 'host' || !Array.isArray(result.sessions)) throw new Error('OPERATION_FAILED');
        return result;
      }
      if ((row = match(/^\/personal\/v1\/sessions\/([^/]+)(?:\/(archive|unarchive))?$/)) && method !== 'GET')
        return call('shared.sessions.lifecycle', { sessionId: decodeURIComponent(row[1]), action: row[2] || 'delete', ...body });
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
        const waiting=(options.method||'GET')==='GET'&&new URL(path,'https://host.invalid').searchParams.has('waitMs');
        if(waiting&&options.signal?.aborted)throw new Error('ABORTED');
        let abort;
        if(waiting)waitingReads++;
        const read=route(path, options.method || 'GET', options.body === undefined ? undefined : typeof options.body === 'string' ? JSON.parse(options.body) : options.body);
        const physical=waiting?read.finally(()=>{waitingReads--;}):read;
        let result;
        try {result=waiting&&options.signal?await Promise.race([physical,new Promise((_,reject)=>{abort=()=>reject(new Error('ABORTED'));options.signal.addEventListener('abort',abort,{once:true});})]):await physical;}
        finally{if(abort)options.signal.removeEventListener('abort',abort);}
        return { ok: true, status: 200, json: async () => result };
      } catch (error) {
        const code = error.message || 'OPERATION_FAILED';
        return { ok: false, status: error.status || (code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : 503), json: async () => ({ error: { code } }) };
      }
    }
    return { call, receive, fetch, account, canWaitForReply:()=>waitingReads===0, nextRequestId: (prefix = 'ui') => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
  }
  globalThis.WeftUiCore.createAndroidBridge = createAndroidBridge;
  globalThis.WeftUiCore.adoptMobileHostSession = async (call, accept, payload) => {
    const account = await call('cloud.adopt');
    accept(payload);
    return account;
  };
  globalThis.WeftUiCore.restoreMobileHostSession = async (bridge, accept) => {
    const response = await bridge.fetch('/personal/v1/auth/me');
    const payload = await response.json();
    if (!response.ok) throw { code: payload.error?.code || 'UNAUTHORIZED', status: response.status };
    accept(payload);
    return payload;
  };
  // App account transport shares the account core; only the platform owns secrets.
  globalThis.WeftUiCore.createMobileCloudTransport = ({ bridge, native, hostOrigin }) => {
    const request = async (url, options = {}) => {
      if (!native) return globalThis.fetch(url, options);
      const absolute = new URL(url, hostOrigin).href;
      const path = new URL(absolute).pathname;
      if (path === '/personal/v1/cloud/devices/pending' || /^\/personal\/v1\/cloud\/devices\/[^/]+\/decision$/.test(path)) {
        try {
          const body = options.body ? JSON.parse(options.body) : {};
          const result = path.endsWith('/pending') ? await bridge.call('cloud.pending')
            : await bridge.call('cloud.decision', { id: decodeURIComponent(path.split('/').at(-2)), decision: body.decision });
          return { ok: true, status: 200, json: async () => result };
        } catch (error) { return { ok: false, status: error.status || 503, json: async () => ({ error: { code: error.message } }) }; }
      }
      if (!path.startsWith('/personal/v1/cloud/') && !['/personal/v1/auth/cloud-nonce', '/personal/v1/auth/cloud-session'].includes(path)) {
        return bridge.fetch(url, options);
      }
      let result;
      try {
        result = path === '/personal/v1/cloud/config'
          ? { status: 200, body: await bridge.call('cloud.app.configure', { origin: hostOrigin }) }
          : await bridge.call('cloud.app.request', { url: absolute, method: options.method || 'GET', headers: options.headers || {},
            ...(options.body !== undefined ? { body: options.body } : {}) });
      } catch (error) {
        result = { status: error.status || 503, body: { error: { code: error.code || error.message || 'NETWORK' } } };
      }
      return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body,
        headers: { get: name => name.toLowerCase() === 'retry-after' ? result.retryAfter : name.toLowerCase() === 'dpop-nonce' ? result.nonce : null } };
    };
    const credentials = native ? async (key, value, remove) => {
      const result = await bridge.call('cloud.app.credentials', { key, ...(remove ? { remove: true } : value !== undefined ? { value } : {}) });
      return result.value ?? undefined;
    } : (...args) => globalThis.WeftCloud.storage(...args);
    return { fetch: request, cloudCredentials: credentials, nativeCloudKey: native ? {
      get: id => bridge.call('cloud.app.key', { id }),
      sign: async (id, input) => (await bridge.call('cloud.app.sign', { id, input })).signature,
      clear: id => bridge.call('cloud.app.key', { id, clear: true }),
    } : undefined };
  };
  globalThis.WeftUiCore.adaptMobileCloudClient = client => {
    const exchange = client.exchange.bind(client);
    // Cloud sign-in precedes selecting a computer. A missing trusted channel is
    // a device-approval state; it must not send the user back to password entry.
    client.exchange = async (...args) => {
      if (client.config?.hostId === 'unconnected') return { status: 'pending_approval', requestId: null };
      try { return await exchange(...args); }
      catch (error) {
        if (error.code === 'PAIRING_REQUIRED' || error.status === 404 && ['HOST_NOT_FOUND', 'NOT_FOUND'].includes(error.code))
          return { status: 'pending_approval', requestId: null };
        throw error;
      }
    };
    return client;
  };
  globalThis.WeftUiCore.resolveMobileCloudConnection = async (client, connection) => {
    if (connection.hostId !== client.config.hostId || connection.status !== 'offline') return connection;
    // The cloud may lack a relay address while this phone already has a trusted
    // direct channel to the selected computer. Probe that existing channel.
    const configuration = await client.request(client.host + '/personal/v1/cloud/config');
    if (configuration.hostId !== connection.hostId) throw { code: 'HOST_TRUST_INVALID' };
    await client.request(client.host + '/personal/v1/auth/cloud-nonce', { method: 'POST', body: {} });
    return { ...connection, status: 'online', baseUrl: client.host };
  };
})();

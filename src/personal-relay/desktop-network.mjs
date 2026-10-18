import { randomUUID } from 'node:crypto';

const proxyPort = url => Number(url.port || (url.protocol === 'https:' ? 443 : ['socks4:', 'socks5:'].includes(url.protocol) ? 1080 : 80));

const networkFailure = () => Object.assign(new Error('Network connection unavailable'), { code: 'NETWORK_UNAVAILABLE' });

// Use Chromium's normal system/PAC proxy resolution. Explicit environment
// proxies get a separate in-memory session; no cookies accompany these requests.
export async function createDesktopRelayNetwork({ session, net, env = process.env }) {
  let transport = session.defaultSession;
  const http = env.http_proxy || env.HTTP_PROXY;
  const https = env.https_proxy || env.HTTPS_PROXY || http;
  const credentials = new Map(), rules = [];
  for (const [scheme, value] of [['http', http], ['https', https]]) {
    if (!value) continue;
    let url;
    try { url = new URL(value); } catch { throw networkFailure(); }
    if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(url.protocol)) throw networkFailure();
    if (url.username || url.password) credentials.set(scheme + ':', {
      host: url.hostname, port: proxyPort(url),
      username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    });
    url.username = ''; url.password = '';
    rules.push(`${scheme}=${url.protocol}//${url.host}`);
  }
  if (rules.length) {
    transport = session.fromPartition(`weftmate-relay-${randomUUID()}`, { cache: false });
    await transport.setProxy({ mode: 'fixed_servers', proxyRules: rules.join(';'),
      proxyBypassRules: (env.no_proxy || env.NO_PROXY || '').split(/[,;]/).map(s => s.trim()).filter(Boolean).join(',') });
  }
  function authenticatedFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: options.method || 'GET', session: transport,
        headers: Object.fromEntries(new Headers(options.headers)), redirect: options.redirect || 'follow',
        credentials: 'include', useSessionCookies: false });
      const abort = () => { request.abort(); reject(networkFailure()); };
      const finish = () => options.signal?.removeEventListener('abort', abort);
      request.on('login', (auth, callback) => {
        const credential = credentials.get(new URL(url).protocol);
        if (auth.isProxy && credential && auth.host === credential.host && auth.port === credential.port)
          callback(credential.username, credential.password);
        else callback();
      });
      request.once('error', () => { finish(); reject(networkFailure()); });
      request.once('response', response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.once('error', () => { finish(); reject(networkFailure()); });
        response.once('end', () => {
          finish(); const headers = new Headers();
          for (const [name, values] of Object.entries(response.headers))
            for (const value of Array.isArray(values) ? values : [values]) headers.append(name, String(value));
          resolve(new Response(['HEAD'].includes(options.method) || [204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks),
            { status: response.statusCode, headers }));
        });
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) { abort(); return; }
      request.end(options.body);
    });
  }
  return {
    async fetch(input, options = {}) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).href;
      try {
        // net.fetch does not surface proxy authentication challenges. Use the
        // same Chromium session with request's per-request login event only for
        // explicit environment credentials; never answer origin challenges.
        if (credentials.has(new URL(url).protocol)) return await authenticatedFetch(url, options);
        return await transport.fetch(input, { ...options, credentials: 'omit' });
      } catch { throw networkFailure(); }
    },
    async proxyFor(url) {
      // frpc accepts one HTTP/SOCKS5 proxy. Keep PAC order; never silently turn
      // an unsupported or failed proxy into a direct connection.
      let route;
      try { route = (await transport.resolveProxy(url)).split(';')[0].trim(); } catch { throw networkFailure(); }
      if (route === 'DIRECT') return null;
      const match = /^(PROXY|HTTP|SOCKS5|SOCKS)\s+(\S+)$/.exec(route);
      if (!match) throw networkFailure();
      const proxy = new URL(`${match[1] === 'PROXY' || match[1] === 'HTTP' ? 'http' : 'socks5'}://${match[2]}`);
      const credential = credentials.get(new URL(url).protocol);
      if (credential && proxy.hostname === credential.host && proxyPort(proxy) === credential.port) {
        proxy.username = credential.username; proxy.password = credential.password;
      }
      return proxy.href.replace(/\/$/, '');
    },
    async close() { await transport.closeAllConnections(); },
  };
}


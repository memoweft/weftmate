import { randomUUID } from 'node:crypto';

const proxyPort = url => Number(url.port || (url.protocol === 'https:' ? 443 : ['socks4:', 'socks5:'].includes(url.protocol) ? 1080 : 80));

const networkFailure = () => Object.assign(new Error('Network connection unavailable'), { code: 'NETWORK_UNAVAILABLE' });
const configurationFailure = () => Object.assign(new Error('Proxy configuration invalid'), { code: 'PROXY_CONFIGURATION_INVALID' });
// Explicit rules also apply when the system/PAC configuration disables
// Chromium's implicit loopback bypass. CIDRs match URL literals, without local
// DNS lookups that would disclose names intended for a proxy to resolve.
const localBypass = ['localhost', '*.localhost', 'localhost.', '*.localhost.', 'loopback', 'loopback.', '127.0.0.0/8', '10.0.0.0/8',
  '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '[::1]', 'fc00::/7', 'fe80::/10',
  '::ffff:127.0.0.0/104', '::ffff:10.0.0.0/104', '::ffff:172.16.0.0/108',
  '::ffff:192.168.0.0/112', '::ffff:169.254.0.0/112'];

// Use Chromium's normal system/PAC proxy resolution. Explicit environment
// proxies get a separate in-memory session; no cookies accompany these requests.
export async function createDesktopRelayNetwork({ session, net, env = process.env }) {
  let transport = session.defaultSession;
  const http = env.http_proxy || env.HTTP_PROXY;
  const https = env.https_proxy || env.HTTPS_PROXY || http;
  const credentials = new Map(), rules = [];
  const owned = new Set();
  const partition = () => {
    const value = session.fromPartition(`weftmate-relay-${randomUUID()}`, { cache: false });
    owned.add(value); return value;
  };
  const close = async () => { await Promise.all([...owned].map(value => value.closeAllConnections())); };
  const configureProxy = async (value, config) => {
    await value.setProxy(config);
    // setProxy acknowledges the preference write, not its propagation to the
    // Chromium network service. Wait for that service before the first lookup
    // or request, including the session used to decide whether to bypass.
    await value.forceReloadProxyConfig();
  };
  let bypass;
  try {
    for (const [scheme, value] of [['http', http], ['https', https]]) {
      if (!value) continue;
      const url = new URL(value);
      if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(url.protocol)) throw configurationFailure();
      if (url.username || url.password) credentials.set(scheme + ':', {
        host: url.hostname, port: proxyPort(url),
        username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      });
      url.username = ''; url.password = '';
      rules.push(`${scheme}=${url.protocol}//${url.host}`);
    }
    const proxyBypassRules = ['<-loopback>', ...(env.no_proxy || env.NO_PROXY || '').split(/[,;]/).map(s => s.trim()).filter(Boolean), ...localBypass].join(',');
    if (rules.length) {
      transport = partition();
      await configureProxy(transport, { mode: 'fixed_servers', proxyRules: rules.join(';'), proxyBypassRules });
    }
    // Ask Chromium to parse the SAME bypass rules for both system and env
    // proxies. This session only resolves URLs; it never sends a request to the
    // synthetic proxy. Keep the user's default session and PAC unchanged.
    bypass = partition();
    await configureProxy(bypass, { mode: 'fixed_servers', proxyRules: 'http://bypass.invalid:80', proxyBypassRules });
  } catch {
    // A bad proxy must not escape into main's fatal local-startup path. Fail
    // remote traffic closed, with no raw URL or decoded credentials in errors.
    return { fetch: async () => { throw configurationFailure(); },
      proxyFor: async () => { throw configurationFailure(); }, close };
  }
  let direct;
  const bypasses = async url => (await bypass.resolveProxy(url)).trim() === 'DIRECT';
  const directTransport = () => direct ??= (async () => {
    const value = partition(); await configureProxy(value, { mode: 'direct' }); return value;
  })();
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
        if (await bypasses(url)) return await (await directTransport()).fetch(input, { ...options, credentials: 'omit' });
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
      try {
        if (await bypasses(url)) return null;
        route = (await transport.resolveProxy(url)).split(';')[0].trim();
      } catch { throw networkFailure(); }
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
    close,
  };
}


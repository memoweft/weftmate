import { fork } from 'node:child_process';
import { boundedCommand } from '../personal-update/watchdog-commands.mjs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { createHostTlsAdapter, developmentCertificate } from './tls.mjs';
import { createCertificateManager, certificateInfo } from './certificates.mjs';

export function relayFromEnvironment(env = process.env) {
  if (env.WEFTMATE_RELAY_ENABLED !== 'true') return null;
  return { binary: env.WEFTMATE_FRPC_FILE, transportCaFile: env.WEFTMATE_RELAY_CA_FILE,
    certFile: env.WEFTMATE_RELAY_CERT_FILE, acme: env.WEFTMATE_RELAY_ACME_ENABLED === 'true' ? {
      directoryUrl: env.WEFTMATE_ACME_DIRECTORY_URL, email: env.WEFTMATE_ACME_EMAIL } : null, developmentTls: env.WEFTMATE_RELAY_DEVELOPMENT_TLS === 'true' };
}
async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
export function frpcConfig({ credentials: c, localPort, transportCaFile, adminPort, adminPassword, logLevel = 'error', proxyUrl }) {
  const str = JSON.stringify;
  return `serverAddr = ${str(c.serverAddr)}
serverPort = ${c.serverPort}
user = ${str(c.hostId)}
loginFailExit = false
metadatas.credential = ${str(c.credential)}
transport.tls.enable = true
transport.tls.disableCustomTLSFirstByte = true
transport.tls.serverName = ${str(c.serverName)}
transport.tls.trustedCaFile = ${str(transportCaFile)}
${proxyUrl ? `transport.proxyURL = ${str(proxyUrl)}\n` : ''}transport.tcpMux = true
transport.heartbeatInterval = 5
transport.heartbeatTimeout = 15
webServer.addr = "127.0.0.1"
webServer.port = ${adminPort}
webServer.user = "relay"
webServer.password = ${str(adminPassword)}
log.to = "console"
log.level = ${str(logLevel)}
[[proxies]]
name = "content"
type = "https"
localIP = "127.0.0.1"
localPort = ${localPort}
customDomains = [${str(new URL(c.baseUrl).hostname)}]
`;
}
export async function createHostRelay({ root, identity, options, setPublicOrigin, executeCommand=boundedCommand, clock = Date.now, fetchImpl = fetch, pollMs = 2000 }) {
  if (!identity || !options?.binary || !options?.transportCaFile || (!options.certFile && !options.developmentTls && !options.acme))
    throw new Error('Relay requires cloud identity, frpc, transport CA and host certificate');
  let stdout;
  try { ({stdout}=await executeCommand(options.binary,['-v'],{timeoutMs:15000,windowsHide:true})); }
  catch(error) { options.diagnostic?.(error); throw error; }
  if (stdout.trim() !== '0.71.0') throw new Error('Relay requires official frpc 0.71.0');
  const dir = path.join(root, 'relay'); await ensurePrivateDirectory(dir);
  let origin, child, adapter, timer, polling, closed = false, state = 'stopped', publicOrigin = null, failure = null;
  let credentials, adminPort, adminPassword, certificates, activeCertFile, certificateExpiresAt = null;
  const configFile = path.join(dir, 'frpc.toml');
  let retryAt = 0, retryMs = 2000, lastReason = null;
  // Optional diagnostics are a side channel: never affect relay results/errors.
  function observe(stage, detail, childProcess) {
    try {
      if (options.observe) options.observe({ stage, detail: typeof detail === 'function' ? detail() : detail }, childProcess)?.catch?.(() => {});
    } catch {}
  }
  function failed(error) {
    const reason = error?.code ?? error?.cause?.code ?? error?.message ?? 'RELAY_UNAVAILABLE';
    if (reason !== lastReason) options.diagnostic?.(error);
    lastReason = reason;
    retryAt = clock() + retryMs; retryMs = Math.min(retryMs * 2, 60_000);
    state = closed ? 'stopped' : 'offline'; failure = 'RELAY_UNAVAILABLE';
    observe('relay.failed', { code: error?.code, cause: error?.cause?.code, reason });
  }
  async function stopChild() {
    const current = child; child = null;
    if (!current || current.exitCode !== null || current.signalCode !== null) return;
    await new Promise(resolve => {
      const timeout = setTimeout(() => current.kill('SIGKILL'), 3000);
      current.once('exit', () => { clearTimeout(timeout); resolve(); }); current.kill('SIGTERM');
    });
  }
  async function launch(next) {
    await stopChild();
    if (closed) return;
    if (publicOrigin && next.baseUrl !== publicOrigin) throw new Error('Relay changed claimed domain');
    publicOrigin = next.baseUrl; credentials = { ...next, serverAddr: options.connectAddress ?? next.serverAddr, serverPort: options.connectPort ?? next.serverPort };
    if (!adapter) {
      observe('host.tls.requested');
      const domain = new URL(publicOrigin).hostname, tls = identity.tls();
      if (options.acme && !options.developmentTls) {
        certificates ??= await createCertificateManager({ root, domain, identity, certFile: options.certFile,
          ...options.acme, diagnostic: options.diagnostic, onInstalled: async () => { await adapter?.reload(); } });
        if (closed) { await certificates.close(); return; }
        certificates.start();
        await certificates.check();
        const status = certificates.status();
        if (!status.certificateExpiresAt && status.certificateErrorCode)
          throw Object.assign(new Error('Certificate unavailable'), { code: status.certificateErrorCode });
      }
      const certificate = options.developmentTls
        ? await developmentCertificate({ root, domain, privateJwk: tls.privateJwk, diagnostic:options.diagnostic }) : { certFile: certificates?.certFile ?? options.certFile };
      activeCertFile = certificate.certFile;
      certificateExpiresAt = certificateInfo(await readFile(certificate.certFile), { domain, spki: tls.spki }).certificateExpiresAt;
      if (closed) return;
      adapter = await createHostTlsAdapter({ origin, publicOrigin, ...tls, certFile: certificate.certFile });
      observe('host.tls.ready');
      setPublicOrigin(publicOrigin);
    }
    adminPort = await unusedPort(); adminPassword = randomBytes(32).toString('base64url');
    const proxyUrl = await options.proxyFor?.(`https://${credentials.serverName}:${credentials.serverPort}`);
    await writeFile(configFile, frpcConfig({ credentials, localPort: adapter.port, proxyUrl,
      transportCaFile: options.transportCaFile, adminPort, adminPassword, logLevel: options.observe ? 'info' : 'error' }), { mode: 0o600 });
    await ensurePrivateFile(configFile);
    if (closed) return;
    state = 'connecting'; failure = null;
    const childEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    if (options.proxyFor) for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete childEnv[name];
    child = fork(fileURLToPath(new URL('./sidecar.mjs', import.meta.url)), [options.binary, configFile], {
      stdio: ['ignore', options.observe ? 'pipe' : 'ignore', options.observe ? 'pipe' : 'ignore','ipc'], execArgv: [],
      env: childEnv, windowsHide: true });
    const current = child;
    current.stdout?.resume(); current.stderr?.resume();
    observe('sidecar.spawned', {}, current);
    current.on('message', message => {
      if (message?.kind === 'frpc.spawned') observe('frpc.spawned', { pid: message.pid });
    });
    current.once('error', () => { state = 'offline'; failure = 'FRPC_START_FAILED'; });
    current.once('exit', (code, signal) => {
      observe('sidecar.exited', { code, signal });
      if (child === current) { child = null; state = closed ? 'stopped' : 'offline'; }
    });
  }
  async function tick() {
    if (closed || polling) return polling;
    polling = (async () => {
      try {
        if (identity.relayReady?.() === false) {
          await stopChild(); state = 'stopped'; failure = null; retryAt = 0; retryMs = 2000;
          return;
        }
        if (clock() < retryAt) return;
        if (!child) {
          state = 'connecting';
          observe('relay.registration.requested');
          const next = await identity.relayRequest('/hosts/relay/credentials', {});
          observe('relay.registration.received');
          await launch(next);
        }
        if (!child || closed) return;
        const result = await fetchImpl(`http://127.0.0.1:${adminPort}/api/status`, {
          headers: { authorization: `Basic ${Buffer.from(`relay:${adminPassword}`).toString('base64')}` },
          signal: AbortSignal.timeout(1500), redirect: 'error' });
        const status = await result.json();
        observe('frpc.status', () => ({ httpStatus: result.status, proxies: status.https?.map(p => ({ status: p.status, err: p.err })) }));
        state = result.ok && status.https?.some(p => p.status === 'running') ? 'online' : 'offline';
        failure = state === 'online' ? null : 'RELAY_UNAVAILABLE';
        if (state === 'online') {
          observe('host.online');
          retryAt = 0; retryMs = 2000;
          if (lastReason !== null) { lastReason = null; options.onRecovery?.('relay'); }
        } else failed(Object.assign(new Error('RELAY_UNAVAILABLE'), { code: 'RELAY_UNAVAILABLE' }));
      } catch (error) { if (!closed) failed(error); }
    })().finally(() => { polling = null; });
    return polling;
  }
  return {
    start(localOrigin) { origin = localOrigin; void tick(); timer = setInterval(() => { void tick(); }, pollMs); timer.unref(); },
    status() { return { state, baseUrl: publicOrigin, certificateExpiresAt, certificateErrorCode: null, ...certificates?.status(), ...(failure ? { errorCode: failure } : {}),
      ...(certificates?.status().certificateErrorCode === 'CERTIFICATE_NETWORK_UNAVAILABLE' ? { message: '网络连不上证书服务。请检查网络或代理设置，再点重试。' }
        : state === 'offline' && ['NETWORK_UNAVAILABLE', 'CLOUD_UNAVAILABLE', 'RELAY_UNAVAILABLE'].includes(lastReason) ? { message: '网络连不上远程连接服务。请检查网络或代理设置，再点重试。' } : {}) }; },
    async rotate(requestId) {
      await polling;
      const next = await identity.relayRequest('/hosts/relay/rotate', { requestId });
      await launch(next); return this.status();
    },
    async reconnect() {
      await polling;
      await stopChild();
      retryAt = 0;
      await tick();
      return this.status();
    },
    async reloadCertificate() {
      await certificates?.retry();
      await certificates?.refresh();
      await adapter?.reload();
      if (adapter) certificateExpiresAt = certificateInfo(await readFile(activeCertFile),
        { domain: new URL(publicOrigin).hostname, spki: identity.tls().spki }).certificateExpiresAt;
    },
    async close() {
      closed = true; clearInterval(timer); await certificates?.close(); await polling;
      await stopChild(); await adapter?.close(); state = 'stopped';
    },
  };
}

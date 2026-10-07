import { fork, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { createHostTlsAdapter, developmentCertificate } from './tls.mjs';

export function relayFromEnvironment(env = process.env) {
  if (env.WEFTMATE_RELAY_ENABLED !== 'true') return null;
  return { binary: env.WEFTMATE_FRPC_FILE, transportCaFile: env.WEFTMATE_RELAY_CA_FILE,
    certFile: env.WEFTMATE_RELAY_CERT_FILE, developmentTls: env.WEFTMATE_RELAY_DEVELOPMENT_TLS === 'true' };
}
async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
export function frpcConfig({ credentials: c, localPort, transportCaFile, adminPort, adminPassword }) {
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
transport.tcpMux = true
transport.heartbeatInterval = 5
transport.heartbeatTimeout = 15
webServer.addr = "127.0.0.1"
webServer.port = ${adminPort}
webServer.user = "relay"
webServer.password = ${str(adminPassword)}
log.to = "console"
log.level = "error"
[[proxies]]
name = "content"
type = "https"
localIP = "127.0.0.1"
localPort = ${localPort}
customDomains = [${str(new URL(c.baseUrl).hostname)}]
`;
}
export async function createHostRelay({ root, identity, options, setPublicOrigin }) {
  if (!identity || !options?.binary || !options?.transportCaFile || (!options.certFile && !options.developmentTls))
    throw new Error('Relay requires cloud identity, frpc, transport CA and host certificate');
  const { stdout } = await promisify(execFile)(options.binary, ['-v']);
  if (stdout.trim() !== '0.71.0') throw new Error('Relay requires official frpc 0.71.0');
  const dir = path.join(root, 'relay'); await ensurePrivateDirectory(dir);
  let origin, child, adapter, timer, polling, closed = false, state = 'stopped', publicOrigin = null, failure = null;
  let credentials, adminPort, adminPassword;
  const configFile = path.join(dir, 'frpc.toml');
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
      const domain = new URL(publicOrigin).hostname, tls = identity.tls();
      const certificate = options.developmentTls
        ? await developmentCertificate({ root, domain, privateJwk: tls.privateJwk }) : { certFile: options.certFile };
      if (closed) return;
      adapter = await createHostTlsAdapter({ origin, publicOrigin, ...tls, certFile: certificate.certFile });
      setPublicOrigin(publicOrigin);
    }
    adminPort = await unusedPort(); adminPassword = randomBytes(32).toString('base64url');
    await writeFile(configFile, frpcConfig({ credentials, localPort: adapter.port,
      transportCaFile: options.transportCaFile, adminPort, adminPassword }), { mode: 0o600 });
    await ensurePrivateFile(configFile);
    if (closed) return;
    state = 'connecting'; failure = null;
    child = fork(fileURLToPath(new URL('./sidecar.mjs', import.meta.url)), [options.binary, configFile], {
      stdio: ['ignore','ignore','ignore','ipc'], execArgv: [],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
    const current = child;
    current.once('error', () => { state = 'offline'; failure = 'FRPC_START_FAILED'; });
    current.once('exit', () => { if (child === current) { child = null; state = closed ? 'stopped' : 'offline'; } });
  }
  async function tick() {
    if (closed || polling) return polling;
    polling = (async () => {
      try {
        if (!child) {
          state = 'connecting';
          await launch(await identity.relayRequest('/hosts/relay/credentials', {}));
        }
        if (!child || closed) return;
        const result = await fetch(`http://127.0.0.1:${adminPort}/api/status`, {
          headers: { authorization: `Basic ${Buffer.from(`relay:${adminPassword}`).toString('base64')}` },
          signal: AbortSignal.timeout(1500), redirect: 'error' });
        const status = await result.json();
        state = result.ok && status.https?.some(p => p.status === 'running') ? 'online' : 'offline';
        failure = state === 'online' ? null : 'RELAY_UNAVAILABLE';
      } catch (error) { options.diagnostic?.(error); state = closed ? 'stopped' : 'offline'; failure = 'RELAY_UNAVAILABLE'; }
    })().finally(() => { polling = null; });
    return polling;
  }
  return {
    start(localOrigin) { origin = localOrigin; void tick(); timer = setInterval(() => { void tick(); }, 2000); timer.unref(); },
    status() { return { state, baseUrl: publicOrigin, ...(failure ? { errorCode: failure } : {}) }; },
    async rotate(requestId) {
      await polling;
      const next = await identity.relayRequest('/hosts/relay/rotate', { requestId });
      await launch(next); return this.status();
    },
    reloadCertificate: () => adapter?.reload(),
    async close() {
      closed = true; clearInterval(timer); await polling;
      await stopChild(); await adapter?.close(); state = 'stopped';
    },
  };
}

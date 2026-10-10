/** Shared Linux full-chain fixture: real cloud identity, HAProxy, frps and TLS. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { createServer as tcpServer } from 'node:net';
import { createServer as httpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import path from 'node:path';
import { fixture } from './identity-helpers.mjs';
const run = promisify(execFile), pause = ms => new Promise(r => setTimeout(r, ms));
export async function freePort() {
  const s = tcpServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const port = s.address().port; await new Promise(r => s.close(r)); return port;
}
export async function waitFor(fn, message, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await pause(200); }
  throw new Error(message);
}
export function processChild(binary, args) {
  const child = spawn(binary, args, { stdio: ['ignore','pipe','pipe'] }); let logs = '';
  child.stdout.on('data', c => { logs += c; }); child.stderr.on('data', c => { logs += c; });
  return { child, logs: () => logs, async close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000); await exited; clearTimeout(timer);
  } };
}

export async function relayFixture(t, { liveClock = false } = {}) {
    const frontPort = Number(process.env.WEFTMATE_RELAY_FRONT_PORT ?? '443');
    const ports = {};
    for (const name of ['frps','https','control','content','plugin','api']) ports[name] = await freePort();
    const f = await fixture(t, { env: { CLOUD_RELAY_DOMAIN: 'hosts.example.com', CLOUD_RELAY_SERVER_NAME: 'relay.example.com',
      CLOUD_RELAY_FRPS_PORT: String(ports.frps), CLOUD_RELAY_FRPS_HTTPS_PORT: String(ports.https),
      CLOUD_RELAY_CONTROL_PORT: String(ports.control), CLOUD_RELAY_CONTENT_PORT: String(ports.content), CLOUD_RELAY_PLUGIN_PORT: String(ports.plugin) } });
    const root = await realpath(f.root), infra = path.join(root, 'infra'); await mkdir(infra);
    // Identity tests normally control a frozen clock. This longer browser
    // scenario needs real-time JWT/installation authentication throughout.
    const clockTimer = liveClock ? setInterval(() => f.advance(Date.now() - f.now), 250) : null;
    const frpDir = process.env.WEFTMATE_FRP_DIR, haproxy = process.env.WEFTMATE_HAPROXY ?? 'haproxy';
    assert.ok(frpDir, 'official frp directory must be supplied');
    const procs = []; let apiTls;
    let closing;
    const close = () => closing ??= (async () => {
      clearInterval(clockTimer);
      for (const proc of procs.reverse()) await proc.close();
      if (apiTls) await new Promise(r => { apiTls.close(r); apiTls.closeAllConnections(); });
      await f.identity.relay.close();
    })();
    t.after(close);
      await writeFile(path.join(infra,'transport.cnf'),'[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=relay.example.com\n[ext]\nsubjectAltName=DNS:relay.example.com,DNS:api.example.com\nbasicConstraints=critical,CA:TRUE\n');
      await run('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(infra,'key.pem'),
        '-out',path.join(infra,'cert.pem'),'-days','2','-config',path.join(infra,'transport.cnf')]);
      const infraCert = await readFile(path.join(infra,'cert.pem')), infraKey = await readFile(path.join(infra,'key.pem'));
      await f.identity.relay.start();
      const frpsFile = path.join(infra, 'frps.toml');
      await writeFile(frpsFile, `bindAddr="127.0.0.1"\nbindPort=${ports.frps}\nproxyBindAddr="127.0.0.1"\nvhostHTTPSPort=${ports.https}\ntransport.tls.force=true\ntransport.tls.certFile=${JSON.stringify(path.join(infra,'cert.pem'))}\ntransport.tls.keyFile=${JSON.stringify(path.join(infra,'key.pem'))}\ntransport.tcpMux=true\ntransport.heartbeatTimeout=15\nlog.level="info"\n[[httpPlugins]]\nname="weftmate"\naddr="127.0.0.1:${ports.plugin}"\npath="/frp/plugin"\nops=["Login","NewProxy","Ping","NewWorkConn","NewUserConn"]\n`);
      const frps = processChild(path.join(frpDir, 'frps'), ['-c',frpsFile]); procs.push(frps);
      apiTls = httpsServer({ cert: infraCert, key: infraKey }, (req, res) => {
        const upstream = httpRequest(f.origin + req.url, { method: req.method }, remote => { res.writeHead(remote.statusCode, remote.headers); remote.pipe(res); });
        upstream.on('error', () => res.destroy()); req.pipe(upstream);
      });
      apiTls.listen(ports.api,'127.0.0.1'); await once(apiTls,'listening');
      let cfg = await readFile(new URL('../deploy/haproxy.cfg',import.meta.url),'utf8');
      cfg = cfg.replace(' send-proxy-v2', '').replace('bind :443',`bind 127.0.0.1:${frontPort}`).replace('127.0.0.1:9443',`127.0.0.1:${ports.api}`)
        .replace('127.0.0.1:7001',`127.0.0.1:${ports.control}`).replace('127.0.0.1:7444',`127.0.0.1:${ports.content}`);
      const haproxyFile = path.join(infra,'haproxy.cfg'); await writeFile(haproxyFile,cfg);
      await run(haproxy,['-c','-f',haproxyFile]);
      const front = processChild(haproxy,['-db','-f',haproxyFile]); procs.push(front);
      await pause(300); assert.equal(front.child.exitCode,null,front.logs());
      const controlHealth = await run('curl',['--silent','--show-error','--fail','--cacert',path.join(infra,'cert.pem'),'--noproxy','*','--resolve',`api.example.com:${frontPort}:127.0.0.1`,`https://api.example.com:${frontPort}/healthz`]);
      assert.equal(JSON.parse(controlHealth.stdout).status,'ok');
    return { f, root, infra, frontPort, ports, frpDir, procs, frps, close, logs: () => procs.map(p => p.logs()).join('\n') };
}

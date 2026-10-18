import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostRelay } from '../../../src/personal-relay/index.mjs';
import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto';
import { developmentCertificate } from '../../../src/personal-relay/tls.mjs';
import { relayDiagnostics, closeRelayProcesses, trackRelayChild } from './relay-processes.mjs';
import { distinctPorts, processChild, waitFor } from './relay-fixture.mjs';

for (const observer of ['record', 'throw', 'reject']) {
  test(`relay observation (${observer}) preserves request failures, status and cleanup`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-relay-observe-'));
    const original = Object.assign(new Error('synthetic registration failure'), { code: 'SYNTHETIC_REGISTRATION' });
    const events = [], errors = []; let calls = 0;
    const relay = await createHostRelay({ root,
      identity: { relayRequest: async () => { calls++; throw original; } },
      options: { binary: 'synthetic-frpc', transportCaFile: 'synthetic-ca', developmentTls: true,
        diagnostic: error => errors.push(error), observe: event => {
          if (observer === 'throw') throw new Error('observer failed');
          if (observer === 'reject') return Promise.reject(new Error('observer rejected'));
          events.push(event);
        } },
      executeCommand: async () => ({ stdout: '0.71.0\n' }), pollMs: 60_000,
    });
    try {
      // Explicitly run one tick without a polling timer or startup sleeps.
      await relay.reconnect();
      assert.equal(calls, 1);
      assert.equal(errors[0], original);
      assert.deepEqual(relay.status(), { state: 'offline', baseUrl: null, certificateExpiresAt: null,
        certificateErrorCode: null, errorCode: 'RELAY_UNAVAILABLE' });
      await assert.rejects(relay.rotate('synthetic'), error => error === original);
      if (observer === 'record') assert.deepEqual(events.map(e => e.stage), ['relay.registration.requested', 'relay.failed']);
    } finally {
      await relay.close();
      assert.equal(relay.status().state, 'stopped');
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('diagnostic dump includes full output, exit signal, stage timestamps and last status', () => {
  const lines = [];
  const diagnostics = relayDiagnostics({ diagnostic: value => lines.push(value) }, [{
    label: 'synthetic-frpc', child: { exitCode: null, signalCode: 'SIGTERM' }, logs: () => 'first\nlast\n',
  }]);
  diagnostics.mark('relay.registration.received');
  diagnostics.dump({ state: 'offline' });
  const event = JSON.parse(lines[0]);
  assert.equal(event.stage, 'relay.registration.received');
  assert.ok(Number.isFinite(Date.parse(event.at))); assert.ok(event.elapsedMs >= 0);
  assert.match(lines[1], /signal=SIGTERM; log bytes=11\nfirst\nlast/);
  assert.deepEqual(JSON.parse(lines[2]), { state: 'offline' });
  assert.doesNotThrow(() => relayDiagnostics({ diagnostic() { throw new Error('sink failed'); } }, []).dump());
});

test('real frp still comes online and closes when its observer throws', {
  skip: !process.env.WEFTMATE_FRP_DIR && 'official frp directory required', timeout: 45_000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'wm-relay-observe-frp-'));
  const procs = [], events = []; let relay;
  t.after(async () => {
    try { await closeRelayProcesses([...procs, { close: () => relay?.close() }]); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  const ports = await distinctPorts(['frps', 'https', 'host']);
  const domain = `h-${'a'.repeat(32)}.hosts.example.com`;
  const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  const privateJwk = privateKey.export({ format: 'jwk' });
  const spki = createHash('sha256').update(createPublicKey(privateKey).export({ format: 'der', type: 'spki' })).digest('base64url');
  const cert = await developmentCertificate({ root, domain, privateJwk });
  const config = join(root, 'frps.toml');
  await writeFile(config, `bindAddr="127.0.0.1"\nbindPort=${ports.frps}\nproxyBindAddr="127.0.0.1"\nvhostHTTPSPort=${ports.https}\ntransport.tls.force=true\ntransport.tls.certFile=${JSON.stringify(cert.certFile)}\ntransport.tls.keyFile=${JSON.stringify(cert.keyFile)}\n`);
  const binary = name => join(process.env.WEFTMATE_FRP_DIR, name + (process.platform === 'win32' ? '.exe' : ''));
  const frps = processChild(binary('frps'), ['-c', config], 'frps'); procs.push(frps);
  await waitFor(() => frps.logs().includes('frps started successfully'), 'frps did not start', 5000);
  relay = await createHostRelay({ root, identity: {
    tls: () => ({ privateJwk, spki }), relayRequest: async () => ({ hostId: 'synthetic', credential: 'synthetic',
      serverAddr: '127.0.0.1', serverPort: ports.frps, serverName: domain, baseUrl: `https://${domain}` }),
  }, setPublicOrigin() {}, pollMs: 50, options: {
    binary: binary('frpc'), transportCaFile: cert.caFile, certFile: cert.certFile,
    observe(event, child) {
      events.push(event);
      if (child) procs.push(trackRelayChild(child, 'host-frpc-sidecar'));
      throw new Error('synthetic observer failure');
    },
  } });
  relay.start(`http://127.0.0.1:${ports.host}`);
  await waitFor(() => relay.status().state === 'online', 'observed relay did not come online');
  for (const stage of ['relay.registration.requested', 'relay.registration.received', 'host.tls.ready', 'sidecar.spawned', 'frpc.spawned', 'frpc.status', 'host.online']) {
    assert.ok(events.some(event => event.stage === stage), stage);
  }
  const sidecar = procs.find(proc => proc.label === 'host-frpc-sidecar');
  const frpcPid = events.find(event => event.stage === 'frpc.spawned').detail.pid;
  await closeRelayProcesses([...procs, { close: () => relay.close() }]);
  assert.equal(relay.status().state, 'stopped');
  assert.ok(sidecar.child.exitCode !== null || sidecar.child.signalCode !== null);
  assert.throws(() => process.kill(frpcPid, 0), { code: 'ESRCH' });
});

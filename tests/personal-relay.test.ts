import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadFrp, FRP_SHA256, FRP_VERSION } from '../scripts/download-frp.mjs'
import { relayFromEnvironment, frpcConfig } from '../src/personal-relay/index.mjs'

test('relay is opt-in; sidecar config forces verified TLS and publishes only the loopback HTTPS adapter', () => {
  assert.equal(relayFromEnvironment({}), null)
  const config = frpcConfig({ credentials: { hostId: 'host-test', baseUrl: 'https://h-' + 'a'.repeat(32) + '.hosts.example.com',
    serverAddr: 'relay.example.com', serverName: 'relay.example.com', serverPort: 443, credential: 'synthetic-test-secret' },
    localPort: 54321, transportCaFile: '/isolated/ca.pem', adminPort: 54322, adminPassword: 'synthetic-admin' })
  assert.match(config, /transport.tls.enable = true/)
  assert.match(config, /trustedCaFile = "/)
  assert.match(config, /serverName = "relay.example.com"/)
  assert.match(config, /disableCustomTLSFirstByte = true/)
  assert.match(config, /serverPort = 443/)
  assert.match(config, /type = "https"/)
  assert.match(config, /localIP = "127.0.0.1"/)
  assert.doesNotMatch(config, /remotePort|type = "http"/)
})

test('frp downloader fixes official release hashes and rejects tampering before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wm-frp-hash-'))
  let requested = ''
  try {
    await assert.rejects(downloadFrp({ platform: 'darwin', arch: 'x64', destination: root,
      fetcher: async (url: string) => { requested = url; return new Response('tampered-release') } }), /SHA256 mismatch/)
    assert.equal(requested, `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_darwin_amd64.tar.gz`)
    assert.equal(Object.keys(FRP_SHA256).length, 6)
    await assert.rejects(downloadFrp({ platform: 'unrecognized', destination: root }), /Unsupported frp target/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('host IPC disconnect terminates its sidecar even when the host cannot run graceful shutdown',
  { skip: process.platform === 'win32' && 'Unix executable fixture; real Windows frpc validation belongs to deployment', timeout: 10_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-frpc-lifetime-'))
    const binary = join(root, 'synthetic-frpc.mjs'), pidFile = join(root, 'child.pid')
    await writeFile(binary, '#!/usr/bin/env node\nimport {writeFileSync} from "node:fs";writeFileSync(process.argv[3],String(process.pid));setInterval(()=>{},1000);\n')
    await chmod(binary, 0o700)
    const child = fork(fileURLToPath(new URL('../src/personal-relay/sidecar.mjs', import.meta.url)), [binary, pidFile], {
      stdio: ['ignore','ignore','ignore','ipc'], execArgv: [] })
    let daemonPid = 0
    try {
      const until = Date.now() + 5000
      while (!daemonPid && Date.now() < until) {
        daemonPid = Number(await readFile(pidFile, 'utf8').catch(() => '0'))
        if (!daemonPid) await new Promise(r => setTimeout(r, 20))
      }
      assert.ok(daemonPid)
      const exited = once(child, 'exit'); child.disconnect(); await exited
      assert.throws(() => process.kill(daemonPid, 0), /ESRCH/)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      if (daemonPid) { try { process.kill(daemonPid, 'SIGTERM') } catch {} }
      await rm(root, { recursive: true, force: true })
    }
  })

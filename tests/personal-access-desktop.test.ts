import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

const makeBackend = () => {
  const calls = { open: 0 }
  return { calls,
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready', capabilities: {
      chat: { available: false, reasonCode: 'MODEL_UNAVAILABLE', inferenceVerified: false },
      desktopOpenApp: { available: true, appIds: ['notepad'] },
      naturalLanguageDesktop: { available: false, reasonCode: 'MODEL_UNAVAILABLE' },
    } }),
    listModels: async () => [], preflight: async () => ({ ok: true }),
    createSession: async () => { throw new Error('unused') },
    sendMessage: async () => { throw new Error('unused') },
    cancelSession: async () => { throw new Error('unused') },
    readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
    describeSession: async () => null,
    openDesktopApp: async () => { calls.open++; return { accepted: true, observed: true, outcome: 'opened' } },
  }
}

async function req(origin: string, token: string, method: string, path: string, body?: object) {
  const response = await fetch(`${origin}${path}`, { method, headers: {
    authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}),
  }, body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}

async function commandState(origin: string, token: string, commandId: string, state: string) {
  for (let index = 0; index < 100; index++) {
    const value = await req(origin, token, 'GET', `/personal/v1/commands/${commandId}`)
    if (value.body.command.state === state) return value.body.command
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('command did not reach expected state')
}

test('notepad command is strictly bounded, deduplicated across devices, listed and recoverable by requestId', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-desktop-command-'))
  const backend = makeBackend()
  const service = await createPersonalAccessService({ root, port: 0, backend })
  try {
    const { origin, hostId } = await service.start()
    const a = await service.enrollDevice({ name: 'a' })
    const b = await service.enrollDevice({ name: 'b' })
    const payload = { requestId: 'open-notepad-1', kind: 'desktop.open_app', targetDeviceId: hostId, appId: 'notepad' }
    assert.equal((await req(origin, a.token, 'POST', '/personal/v1/commands',
      { ...payload, appId: 'calc' })).status, 400)
    assert.equal((await req(origin, a.token, 'POST', '/personal/v1/commands',
      { ...payload, path: 'C:/Windows/System32/cmd.exe' })).status, 400)
    const [first, repeated] = await Promise.all([
      req(origin, a.token, 'POST', '/personal/v1/commands', payload),
      req(origin, b.token, 'POST', '/personal/v1/commands', payload),
    ])
    assert.equal(first.status, 202)
    assert.equal(repeated.status, 202)
    assert.equal(first.body.command.commandId, repeated.body.command.commandId)
    const observed = await commandState(origin, b.token, first.body.command.commandId, 'observed')
    assert.equal(backend.calls.open, 1)
    assert.deepEqual(observed.verification.status, 'observed')
    assert.deepEqual(observed.verification.method, 'visible_window')
    assert.equal(observed.verification.outcome, 'opened')
    assert.equal((await req(origin, b.token, 'GET', '/personal/v1/commands/by-request/open-notepad-1'))
      .body.command.commandId, first.body.command.commandId)
    const listed = await req(origin, a.token, 'GET', '/personal/v1/commands?limit=1')
    assert.equal(listed.body.commands[0].commandId, first.body.command.commandId)
    assert.equal(listed.body.hasMore, false)
    assert.equal((await req(origin, a.token, 'GET', '/personal/v1/status')).body.backend.capabilities.chat.available, false)
    assert.deepEqual((await req(origin, a.token, 'GET', '/personal/v1/status'))
      .body.backend.capabilities.desktopOpenApp.appIds, ['notepad'])
    assert.equal((await req(origin, a.token, 'GET', '/personal/v1/commands/by-request/absent')).status, 404)
    assert.equal((await req(origin, a.token, 'POST', '/personal/v1/commands',
      { ...payload, appId: 'different' })).status, 400)
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('a restarted dispatching desktop action remains uncertain and is not launched twice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-desktop-uncertain-'))
  const backend = makeBackend()
  const first = await createPersonalAccessService({ root, port: 0, backend })
  const { hostId } = await first.start()
  const device = await first.enrollDevice({ name: 'phone' })
  await first.close()
  const file = join(root, 'store.json')
  const store = JSON.parse(readFileSync(file, 'utf8'))
  const payload = { requestId: 'before-crash', kind: 'desktop.open_app', targetDeviceId: hostId, appId: 'notepad' }
  store.accounts[store.legacyOwnerId].commands['cmd-crashed'] = { commandId: 'cmd-crashed', requestId: payload.requestId,
    ownerId: store.legacyOwnerId, sourceDeviceId: device.deviceId, targetDeviceId: hostId,
    payload, payloadHash: (await import('node:crypto')).createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    kind: payload.kind, appId: 'notepad', state: 'dispatching',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  writeFileSync(file, JSON.stringify(store))
  const second = await createPersonalAccessService({ root, port: 0, backend })
  try {
    const { origin } = await second.start()
    const recovered = await req(origin, device.token, 'GET', '/personal/v1/commands/by-request/before-crash')
    assert.equal(recovered.body.command.state, 'uncertain')
    assert.equal(backend.calls.open, 0)
    assert.equal((await req(origin, device.token, 'POST', '/personal/v1/commands', payload))
      .body.command.commandId, 'cmd-crashed')
    assert.equal(backend.calls.open, 0)
  } finally { await second.close(); rmSync(root, { recursive: true, force: true }) }
})

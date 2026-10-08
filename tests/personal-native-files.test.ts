import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { trackNativeFiles, appendNativeArtifacts, conversationCreatedFiles } from '../src/plugins/personal-native-files.mjs'
import { createNativeBrowserOperations } from '../src/personal-access/native-browser.mjs'
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs'
import { projectHistoryEvent } from '../src/runtime/dsh-adapter/sessions.mjs'

test('native file observation publishes every changed file, leaves unchanged files and standard presets alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-artifacts-'))
  try {
    await writeFile(join(root, 'source.txt'), 'existing')
    const frames: any[] = []
    const bridge = { request: async (frame: any) => {
      frames.push(frame)
      return { artifactId: `artifact-${frames.length}`, taskId: 'cmd-native', fileName: frame.filePath.split(/[\\/]/).at(-1),
        contentType: 'text/plain', size: 4, state: 'observed' }
    } }
    const exec = { name: 'pwsh', agent: { session: { header: { agentPreset: 'personal-remote', cwd: root } } } }
    const native = { isError: false, value: 'native result', content: [{ type: 'text', text: 'native result' }] }
    const result = await trackNativeFiles(bridge, exec, async () => {
      await mkdir(join(root, 'outputs'))
      await writeFile(join(root, 'outputs/report.md'), 'done')
      await writeFile(join(root, 'script.mjs'), 'done')
      return native
    }, () => ({ sessionId: 'session-native', receiptId: 'receipt-native', turn: 1, callId: 'call-native', messageHash: 'a'.repeat(64) }))
    assert.equal(result, native, 'the around-dispatch result keeps native output normalization')
    assert.equal(frames.length, 2)
    const post = await appendNativeArtifacts(exec, result, async () => ({ kind: 'accept' }))
    assert.equal(post.content.length, 3)
    const restored = { events: [{ type: 'tool/result', data: { message: { content: [{ type: 'tool-result', content: post.content }] } } }] }
    assert.deepEqual([...conversationCreatedFiles(restored)].sort(), [join(root, 'outputs/report.md'), join(root, 'script.mjs')].sort())
    assert.deepEqual([...conversationCreatedFiles({ events: [] })], [])
    const event = projectHistoryEvent({ seq: 9, type: 'tool/result', data: { turn: 1,
      message: { source: { kind: 'tool', callId: 'call-native' }, content: [{ type: 'tool-result', toolCallId: 'call-native',
        isError: false, content: post.content }] } } }, { type: 'tool/call', data: { name: 'pwsh', callId: 'call-native', turn: 1 } })
    assert.equal(event.type, 'artifact.created')
    assert.equal(event.data.artifacts.length, 2)
    assert.equal(event.data.completedStep.stepId, 'call-native')
    assert.equal((await appendNativeArtifacts(exec, result, async () => ({ kind: 'accept' }))).content, undefined)
    await trackNativeFiles(bridge, exec, async () => native, () => ({}))
    assert.equal(frames.length, 2, 'unchanged files do not create another artifact')
    exec.agent.session.header.agentPreset = 'standard'
    await trackNativeFiles(bridge, exec, async () => { await writeFile(join(root, 'standard.txt'), 'done'); return native }, () => ({}))
    assert.equal(frames.length, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('one browser capability opens model-selected URLs, reads captures and follows links across turns without a browser workspace', async () => {
  const urls: string[] = []
  const account = { sessions: { conversation: { origin: 'personal-remote' }, other: { origin: 'personal-remote' } } }
  const browser = createNativeBrowserOperations({ rootState: { legacyOwnerId: 'owner' }, accountState: () => account,
    personalExecutionSource: () => ({ root: { commandId: 'cmd-native' } }), browserReader: { read: async ({ url }: any) => {
      urls.push(url)
      return { url, title: 'Fixture', capturedText: 'Full captured page', links: [{ linkId: 'next', url: 'https://example.org/next' }], outline: [], captureTruncated: false }
    } } })
  const opened = await browser.browse({ sessionId: 'conversation', browserAction: 'open', url: 'https://example.org/discovered' })
  assert.equal(opened.text, 'Full captured page')
  const segment = await browser.browse({ sessionId: 'conversation', browserAction: 'read', snapshotId: opened.snapshotId, turn: 2 })
  assert.equal(segment.text, opened.text)
  await browser.browse({ sessionId: 'conversation', browserAction: 'follow', snapshotId: opened.snapshotId, linkId: 'next', turn: 3 })
  assert.deepEqual(urls, ['https://example.org/discovered', 'https://example.org/next'])
  await assert.rejects(browser.browse({ sessionId: 'other', browserAction: 'read', snapshotId: opened.snapshotId }),
    (error: any) => error.code === 'BROWSER_SOURCE_UNVERIFIED')
})

test('new owner conversations get separate host data directories; shared chat retains native defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-session-cwd-'))
  try {
    const created: any[] = []
    const backend = createPersonalAccessBackend({ currentOrigin: () => 'http://127.0.0.1:1234',
      profiles: () => [{ id: 'local', model: 'fixture' }], hasCredential: () => true,
      routeForProfile: () => ({ provider: 'fixture' }), sessionWorkspaceRoot: join(root, 'conversations'),
      hostOwnerId: () => 'owner', modelAllowed: () => true,
      listSessions: async () => ({ items: created }), queue: (run: any) => run(), bindSession: () => {},
      gateway: async (route: string, init: any) => {
        if (route === '/models') return { groups: [{ id: 'fixture', models: [{ id: 'fixture' }] }] }
        if (route === '/sessions') { const request = JSON.parse(init.body); created.push(request); return { sessionId: request.sessionId } }
        return {}
      } })
    for (const sessionId of ['one', 'two']) await backend.createSession({ sessionId, modelProfileId: 'local', ownerId: 'owner' })
    await backend.createSession({ sessionId: 'shared', modelProfileId: 'local', ownerId: 'other' })
    assert.equal(created[0].cwd, join(root, 'conversations/one'))
    assert.equal(created[1].cwd, join(root, 'conversations/two'))
    assert.equal(created[2].cwd, undefined)
    assert.equal(created[2].agentPreset, 'personal-shared-chat')
  } finally { await rm(root, { recursive: true, force: true }) }
})

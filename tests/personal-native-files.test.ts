import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { trackNativeFiles, appendNativeArtifacts, conversationCreatedFiles, createNativeFileProvenance } from '../src/plugins/personal-native-files.mjs'
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

test('background child files retain the native parent receipt after its turn ends, including nested children', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-background-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = { turn: 1, running: true }, child = { session: { header: { origin: 'subagent', agentPreset: 'personal-remote', cwd: root } } };
  const proof = createNativeFileProvenance((exec: any) => {
    if (exec.agent !== parent || !parent.running) throw new Error('Parent turn ended');
    return { sessionId: 'parent-session', turn: parent.turn, receiptId: 'original-receipt', callId: 'original-call', messageHash: 'a'.repeat(64) };
  });
  proof.inherit(child, { agent: parent });parent.running = false;parent.turn = 2;
  const grandchild = { session: child.session };proof.inherit(grandchild, { agent: child });
  const frames: any[] = [];
  await trackNativeFiles({ request: async (frame: any) => { frames.push(frame);return { artifactId: 'background-file', fileName: 'late.md' }; } },
    { name: 'write', agent: grandchild, arguments: { file_path: 'late.md' } },
    async () => { await writeFile(join(root, 'late.md'), '# Late result');return { content: [] }; },proof.identity);
  assert.equal(frames.length, 1);assert.equal(frames[0].sessionId, 'parent-session');assert.equal(frames[0].turn, 1);
  assert.equal(frames[0].receiptId, 'original-receipt');assert.equal(frames[0].callId, 'original-call');
});

test('one browser capability opens model-selected URLs, reads captures and follows links across turns without a browser workspace', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-browser-captures-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const urls: string[] = []
  const account = { sessions: { conversation: { origin: 'personal-remote' }, other: { origin: 'personal-remote' } } }
  const browser = createNativeBrowserOperations({
    root: join(root, 'personal-access'),
    sessionOperations: {executionOwnerForSession: () => 'owner'}, rootState: { legacyOwnerId: 'owner' }, accountState: () => account,
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

test('new owner conversations get separate host data directories; shared chat also gets an account-isolated native cwd', async () => {
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
        if (!init && /^\/sessions\/[^/]+$/.test(route)) return created.find(row=>row.sessionId===route.split('/').at(-1))
        return {}
      } })
    for (const sessionId of ['one', 'two']) await backend.createSession({ sessionId, modelProfileId: 'local', ownerId: 'owner' })
    await backend.createSession({ sessionId: 'shared', modelProfileId: 'local', ownerId: 'other' })
    assert.equal(created[0].cwd.split(/[/\\]/).at(-1), 'one')
    assert.equal(created[1].cwd.split(/[/\\]/).at(-1), 'two')
    assert.ok(created[2].cwd.startsWith(join(root, 'conversations'))); assert.notEqual(created[0].cwd.split(/[/\\]/).at(-2), created[2].cwd.split(/[/\\]/).at(-2))
    assert.equal(created[2].agentPreset, 'personal-shared-chat')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('FX-11 direct write observes a file once across Windows cwd/argument casing and preserves update provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-first-write-'))
  try {
    const frames: any[] = []
    const bridge = {request: async (frame: any) => {
      frames.push(frame)
      return {artifactId:`artifact-${frames.length}`,taskId:'cmd-first',fileName:'first.txt',state:'observed'}
    }}
    const target = join(process.platform === 'win32' ? root.toUpperCase() : root, 'first.txt')
    const exec = {name:'write',arguments:{file_path:target},agent:{session:{header:{agentPreset:'personal-remote',cwd:root}}}}
    const native = {isError:false,content:[{type:'text',text:'Created file'}]}
    const run = (text: string) => trackNativeFiles(bridge,exec,async()=>{await writeFile(target,text);return native},()=>({sessionId:'first-write'}))
    await run('first')
    assert.equal(frames.length,1,'cwd scan and explicit file argument refer to the same file')
    const created = await appendNativeArtifacts(exec,native,async()=>({kind:'accept'}))
    assert.equal(created.content.length,2)
    assert.equal(JSON.parse(created.content[1].text).createdFilePath,target)
    await run('first')
    assert.equal(frames.length,1,'unchanged content is not registered again')
    await run('updated')
    assert.equal(frames.length,2,'an actual update creates one new artifact')
    const updated = await appendNativeArtifacts(exec,native,async()=>({kind:'accept'}))
    assert.equal(updated.content.length,2)
    assert.equal(JSON.parse(updated.content[1].text).createdFilePath,undefined,'different casing cannot turn an update into a new creation')
  } finally {await rm(root,{recursive:true,force:true})}
})

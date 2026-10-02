/**
 * Black-box compatibility boundary for the pinned alpha.2 V4 migration.
 *
 * Fixtures reproduce the official migration test's released V3 JSONL shape
 * in a temporary directory. They are deliberately not copied from the
 * dogfood store or any user's DSH home.
 */
import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFile = promisify(execFileCallback)
const checkout = 'D:/AIProjects/WeftMate/Runtime/HarnessWorktrees/dsh-00102833-alpha2'
const migration = join(checkout, 'scripts', 'migrate-sessions-to-v4.ts')

type Fixture = { directory: string, source: string, bytes: Buffer }
type Compression = 'none' | 'zstd'

async function temporaryRoot() {
  return mkdtemp(join(tmpdir(), 'weftmate-alpha2-v3-migration-'))
}

const zstdPath = join(checkout, 'packages', 'session', 'session-persistence-jsonl', 'lib', 'types', 'zstd.js')
const zstd = () => import(pathToFileURL(zstdPath).href) as Promise<{
  compressZstdFrame: (input: string | Buffer) => Promise<Buffer>
  decompressZstdFrame: (input: Buffer) => Promise<Buffer>
  scanZstdFrames: (input: Buffer) => { frames: Array<{ start: number, end: number }> }
}>

/** Write a released V3 physical generation in the official project/session layout. */
async function v3Fixture(
  root: string, id: string, events: readonly Record<string, unknown>[] = [],
  compression: Compression = 'none', headerFields: Record<string, unknown> = {},
): Promise<Fixture> {
  const directory = join(root, '_no-cwd', id)
  await mkdir(directory, { recursive: true })
  const header = JSON.stringify({ type: 'session', version: 3, id, createdAt: 1, delegationDepth: 0, isSeeded: false, ...headerFields }) + '\n'
  const body = events.map((event, seq) => JSON.stringify({ ...event, seq, time: seq + 2 }) + '\n').join('')
  const bytes = compression === 'none' ? Buffer.from(header + body) : Buffer.concat([
    await (await zstd()).compressZstdFrame(header),
    ...body === '' ? [] : [await (await zstd()).compressZstdFrame(body)],
  ])
  const source = join(directory, `session.v3.jsonl${compression === 'zstd' ? '.zstd' : ''}`)
  await writeFile(source, bytes)
  return { directory, source, bytes }
}

async function readV4(directory: string, compression: Compression) {
  const path = join(directory, `session.v4.jsonl${compression === 'zstd' ? '.zstd' : ''}`)
  const bytes = await readFile(path)
  if (compression === 'none') return { path, bytes, text: bytes.toString('utf8') }
  const codec = await zstd()
  const text = Buffer.concat(await Promise.all(codec.scanZstdFrames(bytes).frames.map(frame => codec.decompressZstdFrame(bytes.subarray(frame.start, frame.end))))).toString('utf8')
  return { path, bytes, text }
}

async function runMigration(root: string) {
  try {
    const result = await execFile(process.execPath, ['--import', 'tsx', migration, '--sessions-dir', root, '--jobs', '1'], {
      cwd: checkout, maxBuffer: 2 * 1024 * 1024,
    })
    return { status: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error: unknown) {
    const failure = error as { code?: unknown, stdout?: unknown, stderr?: unknown }
    return { status: typeof failure.code === 'number' ? failure.code : -1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '') }
  }
}

const toolTurn = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'step/start', data: { turn: 1, step: 1 } },
  { type: 'request/header', data: { reason: 'initial', header: { config: { provider: 'fake-local', model: 'fixture-model' } } } },
  { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: {
    id: 'assistant', role: 'assistant', source: { kind: 'model', provider: 'fake-local', model: 'fixture-model' },
    content: [{ type: 'text', text: 'synthetic V3 fixture' }],
  } } },
  { type: 'step/end', data: { turn: 1, step: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

// Exact released V3 wrapper form from alpha.2's upstream migration corpus:
// the V4 converter must lift this user-role wrapper to a first-class tool role.
const userToolAttachmentTurn = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'step/start', data: { turn: 1, step: 1 } },
  { type: 'user/message', surfaceOp: 'append', data: {
    id: 'user-with-image', role: 'user', source: { kind: 'user' }, content: [
      { type: 'text', text: 'inspect the attachment with a tool' },
      { type: 'image', attachment: { attachmentId: 'fixture-image', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
    ],
  } },
  { type: 'request/header', data: { reason: 'initial', header: { config: { provider: 'fake-local', model: 'fixture-model' } } } },
  { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: {
    id: 'assistant-tool-call', role: 'assistant', source: { kind: 'model', provider: 'fake-local', model: 'fixture-model' },
    content: [{ type: 'tool-call', id: 'read-image', name: 'read_image', arguments: '{"attachment":"fixture-image"}' }],
  } } },
  { type: 'tool/call', data: { turn: 1, step: 1, callId: 'read-image', name: 'read_image', arguments: '{"attachment":"fixture-image"}' } },
  { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: {
    id: 'tool-result-read-image', role: 'user', source: { kind: 'tool', callId: 'read-image' },
    content: [{ type: 'tool-result', toolCallId: 'read-image', isError: false, content: [{ type: 'text', text: 'image accepted' }] }],
  } } },
  { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: {
    id: 'assistant-final', role: 'assistant', source: { kind: 'model', provider: 'fake-local', model: 'fixture-model' },
    content: [{ type: 'text', text: 'attachment result incorporated' }],
  } } },
  { type: 'step/end', data: { turn: 1, step: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

test('alpha.2 migrates a synthetic V3 session to V4, reopens it on rerun, and leaves V3 bytes immutable', async () => {
  const root = await temporaryRoot()
  try {
    const fixture = await v3Fixture(root, 'synthetic-v3', toolTurn)
    const first = await runMigration(root)
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    assert.match(first.stdout, /converted=1, already-V4=0, failed=0, skipped=0/)
    const target = join(fixture.directory, 'session.v4.jsonl')
    const v4First = await readFile(target)
    assert.match(v4First.toString('utf8'), /"version":4/)
    assert.match(v4First.toString('utf8'), /synthetic V3 fixture/)
    assert.deepEqual(await readFile(fixture.source), fixture.bytes, 'a V3/rc5-compatible source generation is never renamed or rewritten')

    const second = await runMigration(root)
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    assert.match(second.stdout, /converted=0, already-V4=1, failed=0, skipped=0/)
    assert.deepEqual(await readFile(target), v4First, 'the current V4 generation is opened read-only on rerun')
    assert.deepEqual(await readFile(fixture.source), fixture.bytes, 'rerun keeps the original V3 bytes immutable')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('alpha.2 migrates released V3 user/tool/attachment and parent-child corpus from real zstd input without rewriting any V3 generation', async () => {
  const root = await temporaryRoot()
  try {
    const parent = await v3Fixture(root, 'parent-zstd', [], 'zstd')
    const child = await v3Fixture(root, 'child-zstd', [
      { type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'synthetic child' } },
    ], 'zstd', { origin: 'subagent', parentSession: 'parent-zstd', createdAt: 2, delegationDepth: 1 })
    const conversation = await v3Fixture(root, 'tool-attachment-zstd', userToolAttachmentTurn, 'zstd')
    const result = await runMigration(root)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /converted=3, already-V4=0, failed=0, skipped=0/)

    const migrated = await readV4(conversation.directory, 'zstd')
    const rows = migrated.text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const user = rows.find(row => row.type === 'user/message') as { data?: { source?: unknown, content?: unknown } } | undefined
    const tool = rows.find(row => row.type === 'tool/result') as { data?: { message?: Record<string, unknown> } } | undefined
    assert.deepEqual(user?.data?.source, { kind: 'user' })
    assert.deepEqual((user?.data?.content as Array<{ type?: string, attachment?: unknown }>)[1]?.attachment, {
      attachmentId: 'fixture-image', mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    })
    assert.deepEqual(tool?.data?.message, {
      id: 'tool-result-read-image', role: 'tool', source: { kind: 'tool', callId: 'read-image' },
      toolCallId: 'read-image', isError: false, content: [{ type: 'text', text: 'image accepted' }],
    })

    const parentV4 = await readV4(parent.directory, 'zstd')
    assert.match(parentV4.text, /"type":"subagent\/catalog"/)
    assert.match(parentV4.text, /"childId":"child-zstd"/)
    for (const fixture of [parent, child, conversation]) assert.deepEqual(await readFile(fixture.source), fixture.bytes)

    const beforeRerun = await Promise.all([readV4(parent.directory, 'zstd'), readV4(child.directory, 'zstd'), readV4(conversation.directory, 'zstd')])
    const second = await runMigration(root)
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    assert.match(second.stdout, /converted=0, already-V4=3, failed=0, skipped=0/)
    const afterRerun = await Promise.all([readV4(parent.directory, 'zstd'), readV4(child.directory, 'zstd'), readV4(conversation.directory, 'zstd')])
    beforeRerun.forEach((item, index) => assert.deepEqual(afterRerun[index]?.bytes, item.bytes, 'V4 zstd successor stays byte-identical on reread'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('alpha.2 rejects corrupt V3 inputs without publishing a V4 successor', async () => {
  const root = await temporaryRoot()
  try {
    const fixture = await v3Fixture(root, 'corrupt-v3', [{ type: 'unrecognized/required', data: {} }])
    const result = await runMigration(root)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /converted=0, already-V4=0, failed=1, skipped=0/)
    assert.equal(await readFile(fixture.source).then(bytes => bytes.equals(fixture.bytes)), true)
    await assert.rejects(readFile(join(fixture.directory, 'session.v4.jsonl')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('alpha.2 rejects a corrupt zstd V3 source without changing its bytes or publishing a zstd V4 successor', async () => {
  const root = await temporaryRoot()
  try {
    const fixture = await v3Fixture(root, 'corrupt-zstd-v3', [{ type: 'unrecognized/required', data: {} }], 'zstd')
    const result = await runMigration(root)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /converted=0, already-V4=0, failed=1, skipped=0/)
    assert.deepEqual(await readFile(fixture.source), fixture.bytes)
    await assert.rejects(readFile(join(fixture.directory, 'session.v4.jsonl.zstd')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an existing V4 generation wins the selection boundary and is never overwritten by an older V3 source', async () => {
  const root = await temporaryRoot()
  try {
    const fixture = await v3Fixture(root, 'v4-wins', toolTurn)
    const existingV4 = Buffer.from('{"type":"session","version":4,"id":"v4-wins","createdAt":1,"delegationDepth":0,"isSeeded":false}\n')
    const target = join(fixture.directory, 'session.v4.jsonl')
    await writeFile(target, existingV4)
    const result = await runMigration(root)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /converted=0, already-V4=1, failed=0, skipped=0/)
    assert.deepEqual(await readFile(target), existingV4, 'an existing V4 artifact is only read, never replaced')
    assert.deepEqual(await readFile(fixture.source), fixture.bytes, 'the V3 source remains available as an immutable rollback boundary')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

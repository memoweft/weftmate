import './helpers/posix-project-fixture.mjs'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { stagePersonalPlugins } from './support/personal-plugins.ts'
import { waitForCommand } from './helpers/wait-for-command.mjs'

// Load the host after the POSIX folder-selection fixture has installed its hook.
// Static imports are linked before that fixture's module body executes.
const { createPersonalAccessService } = await import('../src/personal-access/index.mjs')
const vendor = (name: string) => pathToFileURL(join(process.cwd(), 'vendor/dsh-runtime/node_modules/@deepseek-ai', name, 'lib/index.js')).href
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
async function until(check: () => Promise<any>) {
  for (let i = 0; i < 150; i++) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw Error('approval did not become pending before the tool finished')
}

// Real HTTP host settings, production personal plugin and pinned DSH ToolRuntime.
// Only the backend's model/receipt carrier and the write producer are synthetic;
// the latter actually writes a file, so bypassing approval is observable.
async function fixture(t: any, { inheritedAllow = false, toolName = 'write' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-approval-execution-'))
  const events: any[] = [], sessions = new Set<string>()
  const receiptId = 'receipt-mode-execution'
  const text = 'Write the requested file after asking me.'
  const backend: any = {
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
    preflight: async () => ({ ok: true }),
    createSession: async ({ sessionId }: any) => { sessions.add(sessionId); return { sessionId } },
    sendMessage: async () => {
      events.push({ seq: 0, type: 'turn.started', data: { turn: 1 } },
        { seq: 1, type: 'user.message', data: { receiptId, messageHash: hash(text), text } })
      return { accepted: true, receiptId }
    },
    readEvents: async () => ({ events, nextSeq: events.at(-1)?.seq ?? -1, nextBeforeSeq: 0, hasMore: false, hasOlder: false }),
    getTaskReplyEvidence: async () => ({ turn: 1, status: 'waiting' }),
    describeSession: async (sessionId: string) => sessions.has(sessionId) ?
      { sessionId, running: true, agentPreset: 'personal-remote', modelProfileId: 'local' } : null,
    cancelSession: async () => ({ accepted: true }),
  }
  const service = await createPersonalAccessService({ root: join(root, 'host'), port: 0, backend })
  let serviceClosed = false
  const closeService = async () => { if (!serviceClosed) { serviceClosed = true; await service.close() } }
  t.after(async () => { await closeService(); rmSync(root, { recursive: true, force: true }) })
  const { origin, hostId } = await service.start(), setup = await service.issueSetupGrant()
  const registration = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: setup.grant,
      username: 'ApprovalModeOwner', password: 'synthetic approval mode password', deviceName: 'Synthetic desktop' }) })
  assert.equal(registration.status, 201)
  const auth = await registration.json(), cookie = registration.headers.get('set-cookie')!.split(';')[0]
  const api = async (path: string, body?: any, method = body ? 'POST' : 'GET') => {
    const response = await fetch(origin + '/personal/v1' + path, { method,
      headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken },
      body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json() }
  }
  const command = async (body: any) => {
    const result = await api('/commands', { targetDeviceId: hostId, ...body })
    assert.equal(result.status, 202, JSON.stringify(result.body))
    return waitForCommand(async () => (await api('/commands/' + result.body.command.commandId)).body.command)
  }
  if (inheritedAllow) assert.equal((await api('/settings/approvals', { rules: { write: 'allow', command: 'allow' } }, 'PATCH')).status, 200)
  const registered = await api('/projects', { requestId: 'mode-project', name: 'Synthetic approval files', rootPath: root, permission: 'write' })
  assert.equal(registered.status, 201, JSON.stringify(registered.body))
  const projectId = registered.body.project.projectId
  let sessionId: string, source: any
    const creation = await api(`/projects/${projectId}/sessions`, { requestId: 'mode-create', modelProfileId: 'local' })
    assert.equal(creation.status, 202, JSON.stringify(creation.body))
    const created = await waitForCommand(async () => (await api('/commands/' + creation.body.command.commandId)).body.command)
    sessionId = created.sessionId
    assert.equal((await api(`/sessions/${sessionId}/approval-mode`, { mode: 'ask' }, 'PATCH')).status, 200)
    source = await command({ kind: 'session.message', requestId: 'mode-source', sessionId, text })
  assert.equal(service.getApprovalPolicy({ sessionId }).mode, 'ask')
  const staged = stagePersonalPlugins(join(root, 'plugins'))
  const [plugin, { Context, Service }, { default: SystemPrompt }, { default: Sessions }, tools,
    { default: Approval }, { default: Web }, { createScope }] = await Promise.all([
    import(staged.plugin), import(vendor('cordis')), import(vendor('dsh-system-prompt')),
    import(vendor('dsh-session')), import(vendor('dsh-tools')), import(vendor('dsh-user-approval')),
    import(vendor('dsh-web')), import(vendor('dsh-scope')),
  ])
  const ctx = new Context(), agents = new Map(), runtimeId = randomUUID()
  class FixtureAgents extends Service {
    constructor(context: any) { super(context, 'agents') }
    get(id: string) { return agents.get(id) }
  }
  t.mock.method(plugin.PersonalDesktopBridge.prototype, 'request', async (frame: any) => {
    const input = { ...frame, runtimeId }
    if (frame.action === 'approval_policy') return service.getApprovalPolicy(input)
    if (['register_approval', 'read_approval', 'resolve_approval'].includes(frame.action)) return service.trackToolApproval(input)
    if (['authorize_execution', 'finish_execution'].includes(frame.action)) return service.trackToolExecution(input)
    if (frame.action === 'register_file') return {}
    throw Error('Unexpected host request: ' + frame.action)
  })
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  await ctx.plugin(Sessions)
  await ctx.plugin(tools.default, { mode: 'native' })
  await ctx.plugin(Approval, { policy: 'ask' })
  await ctx.plugin(Web)
  await ctx.plugin(FixtureAgents)
  await ctx.plugin(plugin.default)
  const cwd = join(root, 'files'); mkdirSync(cwd)
  const session = ctx.sessions.create(sessionId, { meta: { agentPreset: 'personal-remote', cwd } })
  const agent: any = { id: session.id, session, ctx: null, options: {}, status: 'running', inbox: {},
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {}, whenIdle: async () => {} }
  agents.set(session.id, agent); agent.ctx = createScope(ctx, agent).ctx
  // Artifact export is outside this fixture; the producer writes a real file.
  ctx.tools.register(tools.defineTool({ name: toolName, description: 'Write an isolated file',
    parameters: { file_path: { type: 'string', required: true }, content: { type: 'string', required: true }, command: { type: 'string' } },
    output: { schema: { type: 'json' }, render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args: any) => {
      if (toolName === 'shell') execFileSync(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1],process.argv[2])", args.file_path, args.content], { windowsHide: true })
      else writeFileSync(args.file_path, args.content)
      return { written: true }
    } }))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', { source: { kind: 'user', rpcId: source.receiptId }, content: [{ type: 'text', text }] }, { surfaceOp: 'append' })
  const controller = new AbortController()
  let pending: Promise<any> | undefined, settled: any
  const execute = (name: string) => {
    const args = { file_path: join(root, name), content: 'APPROVED ONLY', ...(toolName === 'shell' ? { command: 'node isolated-write' } : {}) }, callId = 'call-' + name
    session.append('tool/call', { turn: 1, step: 1, callId, name: toolName, arguments: JSON.stringify(args) })
    pending = ctx.tools.execute({ name: toolName, arguments: args, agent, callId, signal: controller.signal })
    settled = undefined
    void pending.then(value => { settled = value })
    return pending
  }
  return { root, api, session, execute, sessionId: session.id,
    approval: async () => until(async () => {
      const response = await api(`/sessions/${session.id}/approvals`)
      const row = response.body.approvals?.find((row: any) => row.status === 'pending')
      if (!row && settled) throw Error(JSON.stringify({ result: settled, fileExists: existsSync(join(root, 'first-message.txt')), response, events: session.events.slice(-4) }))
      return row
    }),
    close: async () => { controller.abort(); await pending; await ctx.fiber.dispose(); await closeService(); rmSync(root, { recursive: true, force: true }) } }
}

for (const toolName of ['write', 'shell']) for (const inheritedAllow of [false, true]) test(`FIX-40 phone PATCH ask waits before every ${toolName}, including inherited allow=${inheritedAllow}`, async t => {
  const f = await fixture(t, { inheritedAllow, toolName })
  try {
    for (const outcome of ['allowed-once', 'rejected', 'allowed-once']) {
      const name = `${outcome}-${randomUUID()}.txt`, file = join(f.root, name)
      const work = f.execute(name), approval = await f.approval()
      assert.equal(existsSync(file), false, 'file cannot exist while approval is pending')
      assert.equal((await f.api(`/sessions/${f.sessionId}/approvals/${approval.approvalId}`,
        { requestId: 'answer-' + randomUUID(), outcome, ...(outcome === 'allowed-once' ? { scope: 'once' } : {}) })).status, 200)
      const result = await work
      assert.equal(result.isError, outcome === 'rejected')
      assert.equal(existsSync(file), outcome === 'allowed-once')
      if (outcome === 'allowed-once') assert.equal(readFileSync(file, 'utf8'), 'APPROVED ONLY')
      else assert.match(JSON.stringify(result.content), /rejected/i, 'the native tool error tells the model the user rejected it')
    }
  } finally { await f.close() }
})

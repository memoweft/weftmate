import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { stagePersonalPlugins } from './support/personal-plugins.ts'

const base = join(process.cwd(), 'vendor/dsh-runtime/node_modules/@deepseek-ai')
const vendor = (name: string) => import(pathToFileURL(join(base, name, 'lib/index.js')).href)
const skip = !existsSync(join(base, 'dsh-tool-jobs/lib/index.js')) && 'Requires pinned compiled DSH runtime'

async function fixture(t: any, status = 'running') {
  const [{ Context, Service }, tools, nativeExec, systemPrompt, Jobs, jobTools] = await Promise.all([
    vendor('cordis'), vendor('dsh-tools'), vendor('dsh-tool-executor-native'),
    vendor('dsh-system-prompt'), vendor('dsh-jobs-local'), vendor('dsh-tool-jobs'),
  ])
  const ctx = new Context()
  let finish: (result: any) => void = () => {}
  const result = new Promise<any>(resolve => { finish = resolve })
  const settle = () => finish({ stopReason: 'completed', output: [{ type: 'text', text: 'Checked child result' }] })
  t.after(async () => { settle(); await ctx.fiber.dispose() })
  const notices: any[] = [], sequence: string[] = []
  const agent: any = { id: 'fixture-parent',
    session: { id: 'fixture-parent', events: [] as any[], append(type: string, data: any) { this.events.push({ type, data }) } },
    inbox: { nextStep: [], remove() { return false } }, ctx, status,
    inject(message: any) { notices.push(message); sequence.push('notice') },
    followup(message: any) { notices.push(message); sequence.push('wakeup') } }
  await ctx.plugin(class extends Service { constructor(ctx: any) { super(ctx, 'agents') } get() { return agent } })
  await ctx.plugin(systemPrompt.default, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  await ctx.plugin(tools.default)
  await ctx.plugin(nativeExec)
  await ctx.plugin(Jobs.default)
  await ctx.plugin(jobTools, { completionDelivery: 'wakeup', inlineOutputBytes: 0 })
  const startJob = () => {
    sequence.push('delegate')
    return ctx.jobs.start({
      kind: 'subagent',
      label: 'Check independent material',
      owner: agent.id,
      run(handle: any) {
        return {
          cancel() {},
          done: result.then(done => {
            handle.append(done.output[0].text)
            sequence.push('child-disposed')
            return { status: 'completed', detail: done.stopReason }
          }),
        }
      },
    })
  }
  const execute = async (name: string, args: any) => (await ctx.tools.execute({
    calls: [{ id: `call-${sequence.length}`, name, arguments: JSON.stringify(args) }],
    agent, signal: new AbortController().signal })).results[0].result
  return { ctx, agent, notices, sequence, startJob, execute, settle }
}

test('native background delegation waits, collects and then summarizes the child result', { skip }, async t => {
  const f = await fixture(t)
  const jobId = f.startJob()
  const pending = await f.execute('job_output', { job_id: jobId })
  assert.equal(pending.value.job.status, 'running')
  assert.equal(pending.value.text, '')
  const collecting = f.execute('job_output', { job_id: jobId, wait: true, timeout_ms: 1000 })
  // Advance once so the native waiter is installed before child settlement.
  await new Promise(resolve => setImmediate(resolve))
  f.settle()
  const collected = await collecting
  f.sequence.push('collect')
  assert.equal(collected.value.text, 'Checked child result')
  assert.equal(collected.value.job.status, 'completed')
  assert.equal((await f.execute('job_output', { job_id: jobId })).value.text, '')
  f.sequence.push(`summary: ${collected.value.text}`)
  assert.deepEqual(f.sequence, ['delegate', 'child-disposed', 'collect', 'summary: Checked child result'])
  assert.equal(f.notices.length, 0, 'a blocking collector suppresses the redundant completion reminder')
})

for (const status of ['running', 'idle']) test(`native uncollected completion sends one ${status === 'idle' ? 'wakeup' : 'notice'} then is collected`, { skip }, async t => {
  const f = await fixture(t, status)
  const jobId = f.startJob()
  f.settle()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.notices.length, 1)
  assert.equal(f.notices[0].source.kind, 'tool-jobs')
  assert.equal(f.notices[0].source.form, 'notice')
  assert.match(f.notices[0].content[0].text, /Read its output with job_output/)
  for (let step = 0; step < 3; step++) await f.execute('job_list', {})
  const collected = await f.execute('job_output', { job_id: jobId })
  assert.equal(collected.value.text, 'Checked child result')
  assert.equal((await f.execute('job_output', { job_id: jobId })).value.text, '')
  assert.equal(f.notices.length, 1)
})

test('personal preset preserves the native delegation schema and explains collection before summary', { skip }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-delegation-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const staged = stagePersonalPlugins(root)
  const preset = await import(staged.preset)
  const desktop = await import(staged.plugin)
  t.mock.method(desktop.PersonalDesktopBridge.prototype, 'request', async (request: any) => {
    assert.equal(request.action, 'approval_policy')
    return { mode: 'auto', allowedCategories: [], connectorTools: [] }
  })
  const handlers = new Map(), registered = new Map()
  preset.apply({ tools: { register: (tool: any) => { registered.set(tool.name, tool); return () => {} }, restrict: () => () => {}, schemas: () => [] },
    on: (name: string, handler: any) => handlers.set(name, handler), effect() {} })
  const native = { name: 'subagent', description: 'Native standalone task; returns job id. Collect with job_output.', parameters: { prompt: {} } }
  const scope = { session: { header: { agentPreset: 'personal-remote' } } }
  const assemble = () => handlers.get('system-prompt/assemble')({}, { scope }, async () => ({ sections: [], tools: [native] }))
  await assemble() // Populate the real personal tool catalog before loading by name.
  registered.get('load_tools').execute({ names: ['subagent'] }, { agent: scope })
  const assembly = await assemble()
  assert.equal(assembly.tools[0].name, native.name)
  assert.equal(assembly.tools[0].parameters, native.parameters)
  const guidance = assembly.sections.find((section: any) => section.name === 'weftmate:delegation-guidance').text
  assert.match(guidance, /Record each returned job id/)
  assert.match(guidance, /never redo delegated batches/)
  assert.match(guidance, /call job_output.*before using its work or summarizing/)
  assert.match(guidance, /wait: true/)
})

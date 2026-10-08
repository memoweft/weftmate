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
  const [{ Context, Service }, tools, systemPrompt, Jobs, jobTools, subagentTools] = await Promise.all([
    vendor('cordis'), vendor('dsh-tools'), vendor('dsh-system-prompt'), vendor('dsh-jobs-local'),
    vendor('dsh-tool-jobs'), vendor('dsh-tool-subagent'),
  ])
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const notices: any[] = [], sequence: string[] = []
  const agent: any = { id: 'fixture-parent', session: { id: 'fixture-parent', events: [] }, ctx, status,
    inject(message: any) { notices.push(message); sequence.push('notice') },
    followup(message: any) { notices.push(message); sequence.push('wakeup') } }
  await ctx.plugin(class extends Service { constructor(ctx: any) { super(ctx, 'agents') } get() { return agent } })
  await ctx.plugin(systemPrompt.default, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  await ctx.plugin(tools.default, { mode: 'native', maxParallelSubCalls: 1 })
  await ctx.plugin(Jobs.default)
  await ctx.plugin(jobTools, { completionDelivery: 'wakeup' })
  let finish: (result: any) => void = () => {}
  const result = new Promise(resolve => { finish = resolve })
  // Only the child producer is synthetic; delegation, settlement, notices,
  // blocking waits and reported state use the pinned native implementations.
  const provider = { name: 'spawn', inheritsParentContext: false, capabilities: { depthLimit: true } }
  await ctx.plugin(class extends Service {
    constructor(ctx: any) { super(ctx, 'subagents') }
    getProvider() { return provider }
    async start() { sequence.push('delegate'); return { id: 'fixture-child', result,
      async dispose() { sequence.push('child-disposed') } } }
  })
  await ctx.plugin(subagentTools, { provider: 'spawn', backgroundMode: 'one-shot' })
  const execute = (name: string, args: any) => ctx.tools.execute({ name, arguments: args, agent,
    signal: new AbortController().signal, callId: `call-${sequence.length}` })
  const settle = () => finish({ stopReason: 'completed', output: [{ type: 'text', text: 'Checked child result' }] })
  return { ctx, agent, notices, sequence, execute, settle }
}

test('native background delegation waits, collects and then summarizes the child result', { skip }, async t => {
  const f = await fixture(t)
  const delegated = await f.execute('subagent', { description: 'Check independent material', prompt: 'Check material', run_in_background: true })
  assert.equal(delegated.value.kind, 'background')
  const jobId = delegated.value.jobId
  const pending = await f.execute('job_output', { job_id: jobId })
  assert.equal(pending.value.job.status, 'running')
  assert.equal(f.ctx.jobs.get(jobId, f.agent).reported, false)
  const collecting = f.execute('job_output', { job_id: jobId, wait: true, timeout_ms: 1000 })
  // Advance once so the native waiter is installed before child settlement.
  await new Promise(resolve => setImmediate(resolve))
  f.settle()
  const collected = await collecting
  f.sequence.push('collect')
  assert.equal(collected.value.text, 'Checked child result')
  assert.equal(collected.value.job.status, 'completed')
  assert.equal(f.ctx.jobs.get(jobId, f.agent).reported, true)
  f.sequence.push(`summary: ${collected.value.text}`)
  assert.deepEqual(f.sequence, ['delegate', 'child-disposed', 'collect', 'summary: Checked child result'])
  assert.equal(f.notices.length, 0, 'a blocking collector suppresses the redundant completion reminder')
})

for (const status of ['running', 'idle']) test(`native uncollected completion sends one ${status === 'idle' ? 'wakeup' : 'notice'} then is collected`, { skip }, async t => {
  const f = await fixture(t, status)
  const delegated = await f.execute('subagent', { description: 'Check material', prompt: 'Check material', run_in_background: true })
  f.settle()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.notices.length, 1)
  assert.equal(f.notices[0].source.plugin, 'tool-jobs')
  assert.equal(f.notices[0].source.form, 'notice')
  assert.match(f.notices[0].content[0].text, /Read its output with job_output/)
  const jobId = delegated.value.jobId
  assert.equal(f.ctx.jobs.get(jobId, f.agent).reported, false, 'notice alone does not collect the result')
  for (let step = 0; step < 3; step++) await f.execute('job_list', {})
  const collected = await f.execute('job_output', { job_id: jobId })
  assert.equal(collected.value.text, 'Checked child result')
  assert.equal(f.ctx.jobs.get(jobId, f.agent).reported, true)
  assert.equal(f.notices.length, 1)
})

test('personal preset preserves the native delegation schema and explains collection before summary', { skip }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-delegation-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const preset = await import(stagePersonalPlugins(root).preset)
  const handlers = new Map()
  preset.apply({ tools: { register: () => () => {}, restrict: () => () => {} },
    on: (name: string, handler: any) => handlers.set(name, handler), effect() {} })
  const native = { name: 'subagent', description: 'Native standalone task; returns job id. Collect with job_output.', parameters: { prompt: {} } }
  const assembly = await handlers.get('system-prompt/assemble')({}, {}, async () => ({ sections: [], tools: [native] }))
  assert.equal(assembly.tools[0], native)
  const guidance = assembly.sections.find((section: any) => section.name === 'weftmate:delegation-guidance').text
  assert.match(guidance, /Record each returned job id/)
  assert.match(guidance, /never redo delegated batches/)
  assert.match(guidance, /call job_output.*before using its work or summarizing/)
  assert.match(guidance, /wait: true/)
})

/**
 * R2-03 契约测试：mock LLM 链路契约（checkout 形态）。
 *
 * 锁定「官方 web 组合在 Node 测试进程里 in-process boot + 无浏览器驱动同一套 RPC
 * 契约」的公开接口事实：
 *   - boot 完成（loader.await + assertEntriesLoaded + installLlmReplay 成功）；
 *   - session.create 成功拿到 sessionId；
 *   - events.mux 事件序列含 turn/start、user/message、assistant/message、tool/call
 *     （read 读工具）、tool/result、turn/end（reason=completed）——只锁「形状」不锁值；
 *   - ctx.sessions.flush 后 session.jsonl.zstd 落盘于临时 persistenceRoot；
 *   - replay fixture 全量消费（ReplayHandle.assertConsumed）；
 *   - ctx.fiber.dispose 干净收口后进程 exit 0。
 *
 * boot+驱动+断言 放 fixture 文件（fixtures/web-chat-contract-fixture.mts），由本测试
 * 经 checkout 的 tsx spawn 运行，fixture 内 import checkout 包走 tsx（复用 probe-b 的
 * runNode/isolatedEnv 风格）。vendor 形态（WEFTMATE_DSH_RUNTIME 设置时）skip：vendor
 * 闭包无 dsh-llm-replay/test-support 包（与 tests/dsh-runtime.test.ts T2 的 skip 惯例
 * 一致），mock LLM 链路契约只在 checkout 形态可运行。
 */
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  contractDir,
  isolatedEnv,
  loadPin,
  resolveCheckout,
  runNode,
} from './support/checkout.ts'

const vendorMode = process.env.WEFTMATE_DSH_RUNTIME !== undefined && process.env.WEFTMATE_DSH_RUNTIME !== ''

interface WebChatEvidence {
  booted: boolean
  webServerPort: number | null
  sessionId: string
  eventTypes: string[]
  toolCalls: { name: string; arguments: string }[]
  toolResultTexts: string[]
  assistantTexts: string[]
  turnEndReason: string | null
  archiveExists: boolean
  archivePath: string | null
  replayConsumed: boolean
}

function extractEvidence(stdout: string): WebChatEvidence {
  const match = /\[web-chat\] EVIDENCE (.*)/.exec(stdout)
  assert.ok(match !== null, `fixture 未输出 EVIDENCE。stdout 尾部：\n${stdout.slice(-2000)}`)
  return JSON.parse(match[1]) as WebChatEvidence
}

const REQUIRED_EVENT_TYPES = [
  'turn/start',
  'step/start',
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
  'step/end',
  'turn/end',
] as const

test('R2-03: mock LLM 链路契约（checkout 形态）', {
  timeout: 240_000,
  skip: vendorMode
    ? 'vendor 闭包无 dsh-llm-replay/test-support 包，mock LLM 链路契约测试只在 checkout 形态运行'
    : false,
}, async () => {
  const pin = await loadPin()
  const checkout = await resolveCheckout(pin)
  const fixturePath = join(contractDir, 'fixtures', 'web-chat-contract-fixture.mts')

  const env = isolatedEnv(join(tmpdir(), 'weftmate-web-chat-contract-home'))
  env.WEFTMATE_CHECKOUT = checkout

  const result = await runNode({
    args: ['--import', 'tsx/esm', fixturePath],
    cwd: checkout,
    env,
    timeoutMs: 180_000,
  })

  assert.equal(result.timedOut, false, `fixture 超时。stderr 尾部：\n${result.stderr.slice(-2000)}`)
  assert.equal(result.spawnError, undefined, `spawn 失败：${result.spawnError ?? ''}`)
  assert.equal(result.code, 0, `fixture 非零退出（${result.code}）。stderr 尾部：\n${result.stderr.slice(-2000)}`)
  assert.doesNotMatch(result.stdout, /\[web-chat\] REJECT/, 'run 不应被拒绝')

  const evidence = extractEvidence(result.stdout)

  // 1. boot 完成。
  assert.equal(evidence.booted, true, 'boot 应完成（loader.await + assertEntriesLoaded + installLlmReplay）')

  // 2. 会话创建成功。
  assert.match(evidence.sessionId, /^session-/, `sessionId 格式应为 session-*，实际 ${evidence.sessionId}`)

  // 3. 事件序列（锁形状与顺序，不锁绝对数量）。
  for (const required of REQUIRED_EVENT_TYPES) {
    assert.ok(evidence.eventTypes.includes(required), `事件流缺 ${required}：${evidence.eventTypes.join(',')}`)
  }
  assert.ok(
    evidence.eventTypes.indexOf('turn/start') < evidence.eventTypes.indexOf('turn/end'),
    'turn/start 应先于 turn/end',
  )

  // 4. tool 调用事件：read 读工具，参数指向临时 workspace 里的真实文件。
  const readCall = evidence.toolCalls.find((call) => call.name === 'read')
  assert.ok(readCall !== undefined, `应有一次 read 工具调用：${JSON.stringify(evidence.toolCalls)}`)
  const readArgs = JSON.parse(readCall.arguments) as { file_path?: string }
  assert.match(readArgs.file_path ?? '', /weftmate-note\.txt/, `read 参数应指向 weftmate-note.txt，实际 ${readArgs.file_path}`)

  // 5. tool/result 回填真实文件内容（证明真实 read 工具执行，而非仅脚本形状）。
  assert.ok(
    evidence.toolResultTexts.join('\n').includes('hello-weftmate-note'),
    `tool/result 应含真实文件内容 hello-weftmate-note：${JSON.stringify(evidence.toolResultTexts)}`,
  )

  // 6. 助手最终文本：含 text 内容块（形状）。
  assert.ok(evidence.assistantTexts.length > 0, '应至少一条 assistant/message 文本块')
  assert.ok(
    evidence.assistantTexts.some((text) => text.includes('读到了：')),
    `助手最终文本应含「读到了：」：${JSON.stringify(evidence.assistantTexts)}`,
  )

  // 7. turn/end 存在且 reason 形状为 completed（mock LLM 正常收口）。
  assert.equal(evidence.turnEndReason, 'completed', `turn/end reason.kind 应为 completed，实际 ${evidence.turnEndReason}`)

  // 8. 会话落盘：flush 后 session.jsonl.zstd 存在于临时 persistenceRoot。
  assert.equal(evidence.archiveExists, true, 'flush 后应存在 session.jsonl.zstd')
  assert.ok(
    evidence.archivePath?.endsWith('session.jsonl.zstd') === true,
    `落盘路径应指向 session.jsonl.zstd：${evidence.archivePath ?? '(null)'}`,
  )

  // 9. replay fixture 全量消费。
  assert.equal(evidence.replayConsumed, true, 'replay fixture 应全量消费')
})

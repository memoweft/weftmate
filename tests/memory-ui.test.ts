import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8')
const start = source.indexOf('    function memoryJobStatus(')
const end = source.indexOf('    // ── R6/R8', start)
const functions = source.slice(start, end)

function render(evidence: unknown, jobs: unknown) {
  const states = [evidence, jobs]
  const React = {
    useState: () => [states.shift(), () => {}],
    useEffect: () => {},
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
  }
  const api = runInNewContext(functions + '\n({memoryJobStatus, MemoryProcessing})', {
    React, sectionTitleStyle: {}, dimStyle: {}, pillStyle: {},
  })
  return { api, tree: JSON.stringify(api.MemoryProcessing({ health: {} })) }
}

test('记忆状态区分来源保存、正在处理、无需新增、失败与理解形成', () => {
  const { api } = render(null, null)
  const state = (value: string, terminal: string | null = null) => api.memoryJobStatus({ worker: { state: value }, core_terminal: { terminal_state: terminal } })
  assert.equal(state('pending'), '等待处理')
  assert.equal(state('processing'), '正在处理')
  assert.equal(state('no_change'), '已处理 · 无需新增理解')
  assert.equal(state('dead'), '处理失败 · 原话保留')
  assert.equal(state('no_change', 'clarification_required'), '需要补充说明')
  assert.equal(state('applied'), '理解已形成')
  assert.equal(api.memoryJobStatus(null), '处理状态未确认')
})

test('读取失败不显示空库或已处理，桥接排队单独可见', () => {
  const { tree } = render({ available: false }, { available: true, jobs: [], handoff: { pending: 1, error: 'unavailable' } })
  assert.match(tree, /读取失败/)
  assert.match(tree, /当前数量未知/)
  assert.match(tree, /待交接 1 条/)
  assert.doesNotMatch(tree, /尚无已保存的聊天来源|理解已形成/)
})

test('来源和对应任务关联，受限内容不展示正文', () => {
  const evidence = { available: true, evidence: [
    { evidence_id: 'e1', source_kind: 'spoken', content_available: true, raw_content: '测试原话', origin_id: 'dsh:s1:2' },
    { evidence_id: 'e2', source_kind: 'observed', content_available: false, raw_content: '不可泄露正文' },
  ] }
  const jobs = { available: true, jobs: [{ acceptance: { evidence_ids: ['e1'] }, worker: { state: 'pending' } }] }
  const { tree } = render(evidence, jobs)
  assert.match(tree, /测试原话|本人聊天原话/)
  assert.match(tree, /等待处理/)
  assert.match(tree, /来源记录：dsh:s1:2/)
  assert.match(tree, /此来源当前不可读取/)
  assert.doesNotMatch(tree, /不可泄露正文/)
})

const commandFunctions = source.slice(source.indexOf('    function memoryCommandFeedback('), source.indexOf('    function MemoryAdoptions('))

test('调整记忆以Core回执确认，冲突或仅HTTP受理不冒充成功', () => {
  const feedback = runInNewContext(commandFunctions + '\nmemoryCommandFeedback')
  assert.equal(feedback({ ok: true }, 'mute_world_item').ok, false)
  assert.equal(feedback({ receipt: { accepted: false, result_state: 'revision_conflict' } }, 'mute_world_item').ok, false)
  assert.match(feedback({ receipt: { accepted: false, result_state: 'revision_conflict' } }, 'mute_world_item').text, /刷新/)
  const muted = feedback({ receipt: { accepted: true, result_state: 'applied' } }, 'mute_world_item')
  assert.equal(muted.ok, true)
  assert.match(muted.text, /并未永久删除/)
})

test('超时后重复提交同一操作沿用命令ID，不静默增加新修改', async () => {
  const requests: any[] = []
  const messages: string[] = []
  let id = 0
  const React = {
    useState: (value: unknown) => [value, () => {}],
    useRef: () => ({ current: null }),
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
  }
  const Item = runInNewContext(commandFunctions + '\nMemoryItem', {
    React, dimStyle: {}, sectionSmallBtnStyle: {}, AbortSignal,
    crypto: { randomUUID: () => 'command-' + (++id) },
    fetchAvailableJson: () => {},
    fetch: async (_url: string, options: any) => {
      requests.push(JSON.parse(options.body).command)
      if (requests.length === 1) throw new Error('timeout')
      return { ok: true, json: async () => ({ receipt: { accepted: true, result_state: 'applied' } }) }
    },
  })
  const tree = Item({ item: { id: 'c1', content: '测试理解' }, kind: 'cognition', subjectId: 'test-owner', revision: 3, onResult: (message: string) => messages.push(message) })
  function find(node: any): any {
    if (!node || typeof node !== 'object') return null
    if (node.type === 'button' && node.children.includes('不再使用')) return node
    for (const child of node.children || []) { const result = find(child); if (result) return result }
    return null
  }
  const action = find(tree)
  assert.ok(action)
  action.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(messages[messages.length - 1], /尚未确认/)
  action.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.equal(requests[0].command_id, requests[1].command_id)
  assert.equal(requests[1].expected_world_revision, 3)
  assert.match(messages[messages.length - 1], /已设为不再使用/)
})

const interactionFunctions = source.slice(source.indexOf('    function InteractionExcerpt('), source.indexOf('    function memoryJobStatus('))
function interactionUi(states: unknown[] = []) {
  return runInNewContext(interactionFunctions + '\n({InteractionExcerpt, MemoryInteractions, MemoryRecordedInteraction})', {
    React: { useState: () => [states.shift(), () => {}], useRef: (value: unknown) => ({ current: value }), useEffect: () => {}, createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) },
    dimStyle: {}, sectionSmallBtnStyle: {},
  })
}

test('共同讨论保留AI建议与用户回应的角色和顺序', () => {
  const { InteractionExcerpt } = interactionUi()
  const tree = JSON.stringify(InteractionExcerpt({ item: { id: 'i1', conversation_id: 's1', created_at: '2026-09-09T00:00:00Z', turns: [
    { role: 'assistant', content: '可以先做方案A。' }, { role: 'user', content: '先搁置。' },
  ] } }))
  assert.ok(tree.indexOf('AI 当时说') < tree.indexOf('可以先做方案A。'))
  assert.ok(tree.indexOf('你当时说') < tree.indexOf('先搁置。'))
  assert.ok(tree.indexOf('可以先做方案A。') < tree.indexOf('先搁置。'))
  assert.match(tree, /原会话：s1/)
})

test('共同讨论读取失败不冒充没有记忆，历史不冒充实施授权', () => {
  const { MemoryInteractions } = interactionUi(['上次方案', { available: false }, false])
  const tree = JSON.stringify(MemoryInteractions())
  assert.match(tree, /讨论读取失败/)
  assert.doesNotMatch(tree, /没有找到相关的共同讨论/)
  assert.match(tree, /历史建议不代表你已经同意实施/)
})

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { checkForgetCompletion } from '../src/personal-memory/forget-model.mjs'
import { handlePersonalMemoryTool } from '../src/personal-access/memory-runtime.mjs'

for (const scenario of ['standalone', 'unknown subject', 'mixed source', 'associated World conflict', 'shared source', 'denied permission', 'changed revision'] as const)
test(`page source completion: ${scenario}`, async t => {
  const permissions = { allow_inference: true, allow_cloud_read: scenario !== 'denied permission', allow_local_read: true }
  const evidence = { evidence_id: 'selected', raw_content: '记住：我的收藏编号是Q42。', content_available: true, permissions }
  const row = (id: string, content: string) => ({ object_kind: 'cognition', item_id: id, value: { content },
    provenance: [{ evidence_id: 'selected', evidence, permissions }] })
  const worlds = scenario === 'associated World conflict' ? [row('collection', '用户的收藏编号是Q42。')]
    : scenario === 'shared source' ? [row('collection', '用户的收藏编号是Q42。'), row('walking', '用户喜欢散步。')] : []
  const inputs: any[] = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part
    const request = JSON.parse(body), input = JSON.parse(request.messages.at(-1).content)
    inputs.push(input)
    const items = input.candidates.map((candidate: any) => {
      const subjects = [scenario === 'unknown subject' ? 'unknown' : scenario === 'associated World conflict' ? 'other:妈妈' : 'self']
      return { key: candidate.key, matchesTopic: true, hasTargetFact: true, subjects, targetSubjects: subjects,
        sourceFullyAuthorized: !['mixed source', 'shared source'].includes(scenario) }
    })
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function',
      function: { name: 'classify_forget_candidates', arguments: JSON.stringify({ items }) } }] } }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const queries: string[] = []
  const manager = { async query(_owner: string, method: string, args: any) {
    queries.push(method)
    if (method === 'preview_forget') return { world_revision: 7, evidence_ids: ['selected'],
      items: worlds.map(row => ({ object_kind: row.object_kind, item_id: row.item_id, name: row.value.content })) }
    if (method === 'query_world') return { world_revision: scenario === 'changed revision' && args.operation === 'revision' ? 8 : 7,
      items: args.object_kind === 'cognition' ? worlds : [] }
    if (method === 'query_evidence') return { world_revision: 7, evidence }
    if (method === 'query_jobs') return { world_revision: 7, jobs: [] }
    throw Error(`Unexpected mutation or query: ${method}`)
  } }
  const result = await checkForgetCompletion(manager, 'synthetic-owner',
    { targetKind: 'evidence', targetId: 'selected', expectedWorldRevision: 7 },
    { baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, credential: 'synthetic', model: 'synthetic', modelTier: 'cloud' })
  assert.equal(result.state, scenario === 'standalone' ? 'complete' : 'withheld')
  assert.ok(queries.every(method => ['query_world', 'query_evidence', 'query_jobs', 'preview_forget'].includes(method)))
  if (scenario === 'denied permission') assert.equal(inputs.length, 0)
  else {
    assert.equal(inputs.length, 1)
    if (!worlds.length) assert.ok(inputs[0].candidates.some((candidate: any) => candidate.key === 'target:evidence:selected'
      && candidate.text === evidence.raw_content && candidate.sourceTexts[0] === evidence.raw_content))
    else assert.ok(inputs[0].candidates.every((candidate: any) => candidate.key !== 'target:evidence:selected'),
      'Associated World items must still be the attribution checks, never bypassed by a source-only target')
  }
})

for (const scenario of ['missing', 'oversized', 'truncated', 'complete'] as const)
test(`host forgetting input: ${scenario}`, async () => {
  const text = '忘掉我喝茶的偏好。', seen: any[] = []
  const source = scenario === 'missing' ? undefined : { text: scenario === 'oversized' ? text + '附加说明。'.repeat(3300) : text,
    ...(scenario === 'truncated' ? { message: { content: text + '如果会删除来源原文就先别执行。' } } : {}) }
  const result = await handlePersonalMemoryTool({ async mutateFromTool(_owner: string, action: any) {
    seen.push(action); return { state: 'no_action' }
  } }, 'synthetic-owner', { name: 'memory_forget', arguments: { query: '我喝茶的偏好' }, source,
    requestId: 'memory-tool:' + 'a'.repeat(64) }, { sessionId: 'synthetic', memoryPolicy: { recall: true } })
  assert.equal(result.state, scenario === 'complete' ? 'no_action' : 'withheld')
  assert.equal(seen.length, scenario === 'complete' ? 1 : 0)
  if (scenario !== 'complete') assert.match(result.message, /没有执行遗忘/)
})

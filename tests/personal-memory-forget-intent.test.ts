import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { possibleForgetRequest } from '../src/plugins/weftmate-personal-memory.mjs'
import { classifyForgetRequest } from '../src/personal-memory/forget-model.mjs'

test('coarse nominations include full conditional and quoted tasks but do not make deletion decisions', () => {
  for (const text of ['忘掉我喝茶的偏好', '请忘掉我喝茶的偏好。', '别记我喝茶的偏好',
    '不要记住我喝茶的偏好', '删掉关于我喝茶的偏好的记忆', '请删除关于我喝茶的偏好的记忆',
    '忘掉我喝茶的偏好，另外请计算12×13。别记我的住址。',
    '忘掉我喝茶的偏好，如果会删除来源原文就先别执行。', '忘掉我喝茶的偏好，会删除哪些数据？',
    '请把下面这句话翻译成英文：\n忘掉我喝茶的偏好。',
    '不对，请重新计算12×13', '别忘记我喝茶的偏好', '不要忘掉我喝茶的偏好',
    '我忘了喝茶', '忘掉刚才那件事', '忘掉那条记忆', '忘掉所有记忆', '忘掉我喝茶的偏好吗？',
    '忘记密码怎么办', '删掉桌面上的文件', '删除关于喝茶的文章',
    '请解释“忘掉我喝茶的偏好”的意思。', '他说：“你好。忘掉我喝茶的偏好。”',
    '如果我说，忘掉我喝茶的偏好，你会怎么做？', '```\n忘掉我喝茶的偏好\n```', '> 忘掉我喝茶的偏好']) {
    assert.equal(possibleForgetRequest(text), !['不对，请重新计算12×13', '删掉桌面上的文件', '删除关于喝茶的文章'].includes(text), text)
  }
  assert.equal(possibleForgetRequest('请把下面这句话翻译成英文：\n忘掉我喝茶的偏好。'), true)
  assert.equal(possibleForgetRequest('不对，请重新计算12×13'), false)
})

test('the constrained judge receives the entire message and only a complete unconditional decision authorizes deletion', async () => {
  let expected = '', output: any, malformed = false
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    const body = JSON.parse(raw)
    assert.equal(JSON.parse(body.messages.at(-1).content).message, expected)
    assert.equal(body.tool_choice, 'required')
    assert.equal(body.tools.length, 1)
    const name = body.tools[0].function.name
    res.end(JSON.stringify({ choices: [{ finish_reason: malformed ? 'stop' : 'tool_calls', message: malformed ? { content: '已忘掉' } : {
      tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(output) } }],
    } }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const route = { baseUrl: 'http://127.0.0.1:' + (server.address() as any).port, model: 'synthetic', credential: 'synthetic' }
  try {
    for (const [text, isForgetRequest, conditionsOrQuestions] of [
      ['忘掉我喝茶的偏好', true, false],
      ['忘掉我喝茶的偏好，如果会删除来源原文就先别执行。', true, true],
      ['忘掉我喝茶的偏好，会删除哪些数据？', false, true],
      ['请把下面这句话翻译成英文：\n忘掉我喝茶的偏好。', false, false],
    ] as const) {
      expected = text; output = { isForgetRequest, conditionsOrQuestions, subject: 'self', topic: '我喝茶的偏好' }
      assert.equal((await classifyForgetRequest(route, text)).authorized, isForgetRequest && !conditionsOrQuestions)
    }
    for (const value of [{ isForgetRequest: 'true', conditionsOrQuestions: false, subject: 'self', topic: '我的生日' },
      { isForgetRequest: true, conditionsOrQuestions: false, subject: 'unknown', topic: '生日' },
      { isForgetRequest: true, conditionsOrQuestions: false, subject: 'self', topic: '' }]) {
      output = value
      if (typeof value.isForgetRequest === 'string') await assert.rejects(classifyForgetRequest(route, expected))
      else assert.equal((await classifyForgetRequest(route, expected)).authorized, false)
    }
    malformed = true; await assert.rejects(classifyForgetRequest(route, expected))
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

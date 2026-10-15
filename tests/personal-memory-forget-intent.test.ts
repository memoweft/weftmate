import assert from 'node:assert/strict'
import test from 'node:test'
import { explicitForgetTopics } from '../src/plugins/weftmate-personal-memory.mjs'

test('explicit forget requests identify only the requested concrete topics', () => {
  for (const text of ['忘掉我喝茶的偏好', '请忘掉我喝茶的偏好。', '别记我喝茶的偏好',
    '不要记住我喝茶的偏好', '删掉关于我喝茶的偏好的记忆', '请删除关于我喝茶的偏好的记忆']) {
    assert.deepEqual(explicitForgetTopics(text), ['我喝茶的偏好'], text)
  }
  assert.deepEqual(explicitForgetTopics('忘掉我喝茶的偏好，另外请计算12×13。别记我的住址。'), ['我喝茶的偏好', '我的住址'])
})

test('ordinary corrections, quoted instructions, questions and vague references stay with the model', () => {
  for (const text of ['不对，请重新计算12×13', '别忘记我喝茶的偏好', '不要忘掉我喝茶的偏好',
    '我忘了喝茶', '忘掉刚才那件事', '忘掉那条记忆', '忘掉所有记忆', '忘掉我喝茶的偏好吗？',
    '忘记密码怎么办', '删掉桌面上的文件', '删除关于喝茶的文章',
    '请解释“忘掉我喝茶的偏好”的意思。', '他说：“你好。忘掉我喝茶的偏好。”',
    '如果我说，忘掉我喝茶的偏好，你会怎么做？', '```\n忘掉我喝茶的偏好\n```', '> 忘掉我喝茶的偏好']) {
    assert.deepEqual(explicitForgetTopics(text), [], text)
  }
})

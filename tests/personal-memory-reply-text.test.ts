import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryReplyStream, withoutMemoryToolMarkup } from '../src/plugins/weftmate-personal-memory.mjs'

test('a split model-emitted memory call never exposes its markup or tool name', () => {
  const filter = memoryReplyStream()
  assert.equal(filter('正在处理。<too'), '正在处理。')
  assert.equal(filter('l_call><function=load_tools>memory_'), '')
  assert.equal(filter('forget</function></tool_call>完成。'), '完成。')
  assert.equal(withoutMemoryToolMarkup('前文<tool_call>memory_correct 未闭合'), '前文')
  assert.equal(withoutMemoryToolMarkup('普通文字与代码 a < b。'), '普通文字与代码 a < b。')
  assert.equal(withoutMemoryToolMarkup('  保留普通消息的缩进。\n'), '  保留普通消息的缩进。\n')
})

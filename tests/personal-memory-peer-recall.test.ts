import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import test from 'node:test'

// A new phone chat uses personal-remote on the same host as desktop chats.
// Preserve Core's permission-filtered payload, including provisional/old warnings;
// the envelope must distinguish reading it from acknowledging a new memory write.
for (const preset of ['personal-remote', 'personal-shared-chat']) {
  test(`M6 ${preset}: a first peer conversation receives readable saved memory`, { timeout: 15000 }, async () => {
    const context = '记忆：用户最喜欢的花是木棉花。\n\n记忆（过往）：旧值已被纠正，不能作为当前事实。\n\n【近期原话，尚未整理】本人原话：我最喜欢的花是什么？'
    const child = fork(new URL('fixtures/personal-memory-plugin-child.mjs', import.meta.url), ['--protocol-only'], {
      env: { ...process.env, WEFTMATE_PERSONAL_MEMORY_ENABLED: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    })
    try {
      const result: any = await new Promise((resolve, reject) => {
        child.on('message', (message: any) => {
          if (message.type === 'ready') child.send({ type: 'run-peer-recall', preset })
          else if (message.type === 'result') resolve(message)
          else if (message.type === 'failed') reject(Error(message.error))
          else if (message.protocol === 'weftmate.personal-memory.v1') {
            assert.equal(message.action, 'recall')
            assert.equal(message.query, '我最喜欢的花是什么？')
            child.send({ protocol: message.protocol, id: message.id, ok: true,
              result: { state: 'ready', contextText: context, memories: [{ kind: 'cognition', id: 'flower', summary: '用户最喜欢的花是木棉花。' }] } })
          }
        })
        child.once('error', reject)
        child.once('exit', () => reject(Error('plugin exited before result')))
      })
      assert.equal(result.count, 1)
      assert.equal(result.currentQuestionLast, true)
      assert.ok(result.text.endsWith(context), 'do not rewrite returned facts or erase correction/provisional warnings')
      assert.match(result.text, /本轮已读取/)
      assert.match(result.text, /新对话或.*设备/)
      assert.match(result.text, /新.*形成.*已有记忆/)
      assert.match(result.text, /不是.*指令/)
    } finally { child.kill() }
  })
}

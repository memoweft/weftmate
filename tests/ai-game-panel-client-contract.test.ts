import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const manifest = JSON.parse(readFileSync(new URL('../src/plugins/weftmate-client/package.json', import.meta.url), 'utf8'))
const activeApply = client.slice(
  client.indexOf("apply: function (ctx)"),
  client.indexOf('// 声明等待：', client.indexOf("apply: function (ctx)")),
)

describe('AI-GAME client surfaces use the official DSH seams', () => {
  it('publishes only conversation execution details until lifecycle ownership exists', () => {
    assert.deepEqual(manifest.dsh.client.inject, [
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-tool',
    ])
    assert.match(activeApply, /inject\('tool\.call\.toolview'/)
    assert.match(activeApply, /inject\('conversation\.details\.supplement'/)
    assert.match(activeApply, /register\(\{ name: 'tool\.call\.toolview', key: 'phone_execution' \}, PhoneExecutionRow\)/)
    assert.match(activeApply, /register\(\{ name: 'conversation\.details\.supplement', key: 'phone_execution' \}, AiGameExecutionDetails\)/)
    assert.doesNotMatch(activeApply, /name: 'settings\.section'/)
    assert.doesNotMatch(activeApply, /name: 'sidebar\.footer\.action'/)
    assert.doesNotMatch(activeApply, /name: 'shell\.overlay'/)
    assert.doesNotMatch(activeApply, /installAiGameControlCenterStyles\(\)/)
    assert.match(activeApply, /are absent until WeftMate owns the AI-GAME lifecycle/)
    assert.doesNotMatch(client, /AndroidSimulatorsSection|MobileTaskCenter|fetchAiGameProjection/)
    assert.doesNotMatch(client, /\/weftmate\/ai-game\/(?:tasks|task|simulators|simulator-discovery|simulator-profile|task-frame)\.json/)
    assert.doesNotMatch(activeApply, /slot\.register/)
    assert.equal((activeApply.match(/key: 'phone_execution'/g) ?? []).length, 2)
    assert.doesNotMatch(activeApply, /inject\('details'/)
    assert.doesNotMatch(activeApply, /inject\('conversation\.details\.tool'/)
    assert.doesNotMatch(activeApply, /inject\('conversation'/)
  })

  it('uses the official details action and keeps automatic opening idempotent', () => {
    assert.match(client, /aiGameAutoOpened\[key\]/)
    assert.match(client, /overview\.selectedExecutionId !== pointer\.executionId/)
    assert.match(client, /props\.openDetails\(\)/)
    assert.doesNotMatch(client, /localStorage.*task|sessionStorage.*task/)
    assert.match(client, /meta\.schemaVersion !== 1 \|\| meta\.kind !== 'ai-game-execution'/)
  })

  it('reads one fixed same-origin route without putting capabilities in the renderer', () => {
    assert.match(client, /fetch\('\/weftmate\/ai-game\/panel\.json\?'/)
    assert.match(client, /credentials: 'same-origin'/)
    assert.match(client, /method: 'GET'/)
    assert.doesNotMatch(client, /Authorization|capabilityToken|X-WeftMate-Capability/)
    assert.doesNotMatch(client, /fetch\([^\n]+\/api\/execution\/v1/)
  })

  it('bounds polling, rejects stale work, resumes from eventCursor, and supports reduced motion', () => {
    assert.match(client, /new AbortController\(\)/)
    assert.match(client, /controller\.abort\(\)/)
    assert.match(client, /next\.selectedExecutionId !== pointer\.executionId/)
    assert.match(client, /cursorRef\.current/)
    assert.match(client, /Math\.min\(backoff \* 2, 10000\)/)
    assert.match(client, /prefers-reduced-motion:reduce/)
  })

  it('routes answer, cancel, and resume intents through the official composer', () => {
    assert.match(client, /props\.inputActions\.setDraft/)
    assert.match(client, /请调用 phone_execution 取消执行/)
    assert.match(client, /请调用 phone_execution 恢复执行/)
    assert.match(client, /到输入区回答/)
    const panelSource = client.slice(client.indexOf('function AiGameExecutionDetails'), client.indexOf('/** 状态接口失败'))
    assert.doesNotMatch(panelSource, /createElement\('textarea'|createElement\('input'/)
    assert.doesNotMatch(panelSource, /method:\s*'POST'|method:\s*'DELETE'/)
  })

})

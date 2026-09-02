import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import {
  MEMOWEFT_PYTHON,
  compareMemoWeft,
  loadMemoWeftPin,
  memoweftBridgeAvailable,
  probeInstalledMemoWeft,
} from './support/memoweft-pin.ts'
import { contractDir } from './support/checkout.ts'

const pin = await loadMemoWeftPin(contractDir)
const optIn = process.env.WEFTMATE_TEST_LEGACY_MEMOWEFT_PIN === '1'

describe('P2-01 · 旧 MemoWeft 试验 pin（退出默认工程门）', {
  skip: optIn ? false : '旧 0.7/schema8/RPC1 pin 仅作历史诊断；MemoWeft 尚未重新冻结',
}, () => {
  it('pin 文件形状：协议 v1 / schema v8 / 版本与哈希齐备', () => {
    assert.equal(pin.memoProtocolVersion, 1)
    assert.equal(pin.schemaVersion, 8)
    assert.match(pin.packageVersion, /^0\.7\.0\.dev0$/)
    assert.match(pin.artifactSha256, /^[a-f0-9]{64}$/)
  })

  it('纯函数：任何漂移都给出「差在哪 + 怎么恢复」的明确报错（不依赖环境）', async () => {
    const tampered = { ...pin, packageVersion: '9.9.9', artifactSha256: 'f'.repeat(64) }
    const installed = {
      version: pin.packageVersion,
      schemaVersion: pin.schemaVersion,
      memoProtocolVersion: pin.memoProtocolVersion,
      artifactSha256: pin.artifactSha256,
    }
    const result = compareMemoWeft(tampered, installed)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.message, /packageVersion: 期望 9\.9\.9，实况 0\.7\.0\.dev0/)
      assert.match(result.message, /artifactSha256/)
      assert.match(result.message, /恢复指引/)
      assert.equal(result.mismatches.length, 2)
    }
    assert.deepEqual(compareMemoWeft(pin, installed), { ok: true })
  })

  it('已装环境与冻结基线一致；漂移时以明确报错失败', { skip: memoweftBridgeAvailable() ? false : `MemoWeft 桥环境不可用（${MEMOWEFT_PYTHON}）` }, async () => {
    const installed = await probeInstalledMemoWeft()
    const result = compareMemoWeft(pin, installed)
    if (!result.ok) assert.fail(result.message) // 环境漂移 → 明确报错文本即测试失败原因
    assert.equal(installed.version, '0.7.0.dev0')
  })
})

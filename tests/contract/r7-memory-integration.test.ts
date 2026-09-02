import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  contractDir,
  isolatedEnv,
  loadPin,
  resolveCheckout,
  runNode,
} from './support/checkout.ts';

const PYTHON = process.env.WEFTMATE_MEMOWEFT_PYTHON ?? 'D:\\MemoWeft\\.venv-memoweft\\Scripts\\python.exe';
const PYTHONPATH = process.env.WEFTMATE_MEMOWEFT_PYTHONPATH ?? 'D:\\AIProjects\\MemoWeft\\Core\\py\\src';
const { existsSync } = await import('node:fs');
const memoweftAvailable = existsSync(PYTHON) && existsSync(join(PYTHONPATH, 'memoweft', 'integrations', 'dsh_bridge', '__main__.py'));
const optIn = process.env.WEFTMATE_TEST_MEMOWEFT === '1';

describe('R7 记忆插件集成（checkout 形态，真插件→真桥→applied→浏览/召回）', {
  skip: !optIn ? 'MemoWeft 正向集成不属于默认工程门（设置 WEFTMATE_TEST_MEMOWEFT=1 显式运行）'
    : memoweftAvailable ? false : `MemoWeft 桥环境不可用（${PYTHON} / ${PYTHONPATH}）`,
}, () => {
  test('compaction 事件 → 插件组装 → 桥解释落库 → 管理面浏览/确定性召回命中、负查询不泄露', { timeout: 240_000 }, async () => {
    const pin = await loadPin();
    const checkout = await resolveCheckout(pin);
    const fixturePath = join(contractDir, 'fixtures', 'r7-memory-integration.mts');
    const env = isolatedEnv(join(tmpdir(), 'weftmate-r7-memory-home'));
    env.WEFTMATE_CHECKOUT = checkout;
    env.WEFTMATE_MEMOWEFT_PYTHON = PYTHON;
    env.WEFTMATE_MEMOWEFT_PYTHONPATH = PYTHONPATH;
    env.WEFTMATE_MEMOWEFT_ENABLED = '1';
    env.MEMOWEFT_TEST_MODEL_RESPONSE = '__smart__';

    const result = await runNode({
      args: ['--import', 'tsx/esm', fixturePath],
      cwd: checkout,
      env,
      timeoutMs: 220_000,
    });
    assert.equal(result.timedOut, false, `fixture 超时。stderr 尾部：\n${result.stderr.slice(-2000)}`);
    assert.equal(result.spawnError, undefined, `spawn 失败：${result.spawnError ?? ''}`);
    assert.equal(result.code, 0, `fixture 非零退出（${result.code}）。stderr 尾部：\n${result.stderr.slice(-2000)}\nstdout:\n${result.stdout.slice(-2000)}`);

    const match = /\[r7-memory\] EVIDENCE (.*)/.exec(result.stdout);
    assert.ok(match !== null, `fixture 未输出 EVIDENCE。stdout 尾部：\n${result.stdout.slice(-2000)}`);
    const evidence = JSON.parse(match[1]);
    assert.ok(Array.isArray(evidence.cognitions) && evidence.cognitions.length >= 1, `应形成 ≥1 条 cognition：${JSON.stringify(evidence)}`);
    assert.match(JSON.stringify(evidence.cognitions), /茉莉花茶/);
    assert.ok(evidence.searchHit >= 1, `确定性召回应命中：${JSON.stringify(evidence)}`);
    assert.match(evidence.searchText ?? '', /茉莉花茶/);
    assert.equal(evidence.negativeCount, 0, '负查询不得泄露');
  });
});

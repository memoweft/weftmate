import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Uses the controller's deadline, log capture and owned-process cleanup. */
export async function runVendorTests(run, worktree, out) {
  if (!existsSync(join(worktree, 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'))) {
    await run('node', [join(worktree, 'scripts/vendor-dsh.mjs')], { name: 'vendor-assemble' });
  }
  const report = join(out, 'vendor-test-results.json');
  const execution = await run('node', [join(worktree, '.github/scripts/ci-unit-tests.mjs'), 'vendor', '--report', report], { name: 'vendor-tests', allowFailure: true });
  let tests;
  try { tests = JSON.parse(await readFile(report, 'utf8')); }
  catch { throw Error(`vendor 模式未生成测试结果（退出 ${execution.code}；见 logs/vendor-tests.log），检查固定 DSH 构建和 pin`); }
  const failed = execution.code !== 0 || tests.failed !== 0 || tests.exitCode !== 0;
  return { status: failed ? 'failed' : 'passed', tests,
    ...(failed ? { reason: `vendor 测试失败：${tests.passed} 通过 / ${tests.failed} 失败；见 logs/vendor-tests.log` } : {}) };
}

export function vendorTestMarkdown(phases) {
  const phase = phases.find(item => item.name === 'vendor-tests');
  if (!phase) return ['## 固定 DSH vendor（运行时依赖）测试', '', '🔴 未运行。'];
  const tests = phase.tests;
  return ['## 固定 DSH vendor（运行时依赖）测试', '',
    `${phase.status === 'passed' ? '🟢 通过' : '🔴 失败'}${tests ? `：${tests.passed} 通过 / ${tests.failed} 失败 / ${tests.skipped} 跳过` : `：${phase.reason}`}`,
    '[测试日志](logs/vendor-tests.log)', '',
    ...(tests?.failures.length ? tests.failures.map(name => `- 🔴 ${name}`) : tests ? ['失败名单：无。'] : [])];
}

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// R7 记忆契约：MemoWeft 2.0 本地桥（stdio JSON-Lines + dsh_bridge entrypoint）。
// 环境门（缺失则 skip，与 DSH contract 同纪律）：
//   WEFTMATE_MEMOWEFT_PYTHON     → 桥 python（缺省 D:\AIProjects\WeftMate\Runtime\MemoWeftVenv\Scripts\python.exe）
//   WEFTMATE_MEMOWEFT_PYTHONPATH → 2.0 源码（缺省 D:\AIProjects\MemoWeft\Core\py\src）
const PYTHON = process.env.WEFTMATE_MEMOWEFT_PYTHON ?? 'D:\\AIProjects\\WeftMate\\Runtime\\MemoWeftVenv\\Scripts\\python.exe';
const PYTHONPATH = process.env.WEFTMATE_MEMOWEFT_PYTHONPATH ?? 'D:\\AIProjects\\MemoWeft\\Core\\py\\src';
const FIXTURE = new URL('./contract/fixtures/r7-bridge-smoke.py', import.meta.url);

const available = existsSync(PYTHON) && existsSync(join(PYTHONPATH, 'memoweft', 'integrations', 'dsh_bridge', '__main__.py'));

function runPython(args: string[], input?: string, timeoutMs = 120_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, args, {
      env: { ...process.env, PYTHONPATH },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    child.stderr.on('data', (c: string) => { stderr += c; });
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + `\nspawn error: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

describe('R7 MemoWeft 2.0 本地桥契约', { skip: available ? false : `MemoWeft 桥环境不可用（${PYTHON} / ${PYTHONPATH}）` }, () => {
  it('边界链纵切：真实边界→durable 存储→Job applied→cognition→确定性召回（预算 0/1）', { timeout: 180_000 }, async () => {
    const result = await runPython([FIXTURE.pathname.slice(1)], undefined, 150_000);
    assert.equal(result.code, 0, `冒烟失败。stderr:\n${result.stderr.slice(-2000)}\nstdout:\n${result.stdout.slice(-2000)}`);
    assert.match(result.stdout, /\[r7-bridge\] 冒烟结果: PASS/);
    // 预算不变式断言逐项在场（0/1 调用、Recall 0 生成调用、正命中/负不泄露）。
    assert.match(result.stdout, /memory_world 调用=1 \(期望 1\)/);
    assert.match(result.stdout, /recall: \{[^}]*"count": 1/);
    assert.match(result.stdout, /negative recall: \{[^}]*"count": 0/);
    assert.match(result.stdout, /\'applied\'/);
  });

  it('stdio 传输：initialize/health/shutdown JSON-Lines 往返（无凭据→模型无关 no_change 形态）', { timeout: 60_000 }, async () => {
    const home = join(tmpdir(), `weftmate-r7-stdio-${Date.now()}`);
    const lines = [
      { id: 1, method: 'initialize', params: { session_id: 's1', dsh_home: home, platform: 'dsh', auto_route: false } },
      { id: 2, method: 'health', params: {} },
      { id: 3, method: 'shutdown', params: {} },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n';
    const result = await runPython(['-m', 'memoweft.integrations.dsh_bridge'], lines, 60_000);
    assert.equal(result.code, 0, `桥退出异常。stderr:\n${result.stderr.slice(-2000)}`);
    const responses = result.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(responses.length, 3);
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].result.host_id, 'weftmate:dsh');
    assert.match(responses[0].result.db_path, /memoweft\.sqlite3$/);
    assert.equal(responses[1].ok, true);
    assert.equal(responses[1].result.enabled, true);
    assert.equal(responses[2].ok, true);
    assert.equal(responses[2].result.ok, true);
  });
});

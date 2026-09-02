/**
 * 正式契约工程门固定验证随包 vendor，而不是开发机上的外部 dirty Harness。
 * 不写入 vendor；缺 manifest 或子测试失败都以非零码明确失败。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimePath = join(projectRoot, 'vendor', 'dsh-runtime');
if (!existsSync(join(runtimePath, 'VENDOR-MANIFEST.json'))) {
  console.error('[contract] verified vendor 缺 VENDOR-MANIFEST.json；先运行 npm run vendor:dsh。');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'tests/contract/**/*.test.ts'], {
  cwd: projectRoot,
  env: { ...process.env, WEFTMATE_DSH_RUNTIME: runtimePath },
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', () => { process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });

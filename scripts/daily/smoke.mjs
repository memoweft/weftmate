// 用法：node scripts/daily/smoke.mjs --builds <builds> --version 0.2.0-preview.N
// 从版本导出副本加载助手，使用隔离目录运行打包程序并验证首条回复。
// 无论成败都关闭测试宿主，报告写入版本目录的 packaged-smoke.json。
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOptions, json } from './common.mjs';

const { version, output } = parseOptions('smoke');
const repo = join(output, 'source-final'), build = join(output, 'build-final');
let h;
const report = { version, isolated: true, passed: false };
try {
  report.sourceCommit = (await json(join(output, 'daily-build.json'))).sourceCommit;
  const { managedMkdtempSync } = await import(pathToFileURL(join(repo, 'tests/helpers/managed-temp.mjs')).href);
  const scope = managedMkdtempSync('daily-smoke-' + version + '-', { prune: false });
  Object.assign(process.env, { WEFTMATE_TEST_TEMP_SCOPE: scope, TMP: scope, TEMP: scope, TMPDIR: scope });
  const { migrationHost } = await import(pathToFileURL(join(repo, 'tests/helpers/migration-host.mjs')).href);
  h = await migrationHost({ nativeSession: true, startInTray: true, executable: join(build, 'win-unpacked/WeftMate.exe') });
  report.app = await h.app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }));
  assert.equal(report.app.version, version);
  assert.equal(report.app.packaged, true);
  const first = await h.firstMessage();
  report.firstMessage = { replied: !!first.reply };
  assert.ok(report.firstMessage.replied);
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  try {
    await h?.close({ failed: !report.passed });
  } catch (error) {
    report.closeError = error.stack;
    report.passed = false;
    process.exitCode = 1;
  } finally {
    await writeFile(join(output, 'packaged-smoke.json'), JSON.stringify(report, null, 2));
  }
}
console.log(JSON.stringify(report));

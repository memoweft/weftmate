import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatHarnessStartupError } from '../src/harness-startup-error.ts';

describe('Harness 启动失败原生提示', () => {
  it('将缺失运行时归类为可操作提示，而不回显原始错误', () => {
    const secret = 'DEEPSEEK_API_KEY=should-not-be-shown';
    const view = formatHarnessStartupError(new Error(`ERR_MODULE_NOT_FOUND ${secret}`));

    assert.equal(view.title, 'WeftMate 无法启动 Harness');
    assert.match(view.message, /运行时文件缺失或不完整/);
    assert.doesNotMatch(view.message, /DEEPSEEK_API_KEY|should-not-be-shown|ERR_MODULE_NOT_FOUND/);
    assert.ok(view.message.length < 240);
  });

  it('中文 checkout 缺失错误、超时和未知错误都使用有界说明', () => {
    assert.match(formatHarnessStartupError(new Error('当前 checkout 缺少 vendor group 文件')).message, /运行时文件缺失或不完整/);
    assert.match(formatHarnessStartupError(new Error('startup timeout')).message, /预期时间/);
    const unknown = formatHarnessStartupError('x'.repeat(20_000));
    assert.match(unknown.message, /未能完成启动/);
    assert.ok(unknown.message.length < 240);
  });
});

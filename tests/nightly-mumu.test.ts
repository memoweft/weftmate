import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMuMuInfo, readMuMuInfo, connectMuMu, mumuManager, adbExecutable } from '../scripts/nightly/mumu.mjs';

const output = (port: unknown = 16386, extra = {}) => JSON.stringify({ adb_port: port, is_android_started: true, is_process_started: true, android_version: '15.0', error_code: 0, ...extra });
test('MuMu runtime address comes exclusively from manager info -v 0', async () => {
  for (const port of [16386, 19001]) {
    const info = readMuMuInfo((command: string, args: string[]) => { assert.equal(command, mumuManager); assert.deepEqual(args, ['info', '-v', '0']); return output(port); });
    assert.equal(info.serial, `127.0.0.1:${port}`);
    const calls: unknown[] = [];
    assert.equal((await connectMuMu(async (command: string, args: string[]) => { calls.push([command, args]); return { output: command === mumuManager ? output(port) : `connected to 127.0.0.1:${port}` }; })).serial, info.serial);
    assert.deepEqual(calls, [[mumuManager, ['info', '-v', '0']], [adbExecutable, ['connect', info.serial]]]);
  }
});
test('unavailable emulator and missing manager output are environment issues without any port probes', async () => {
  for (const value of ['', 'not json', output(16386, { adb_port: undefined }), output(0), output(65536), output('wrong'), output(16386, { is_android_started: false }), output(16386, { error_code: 1 })]) {
    assert.throws(() => parseMuMuInfo(value), /环境问题：未拍/);
    const calls: string[] = [];
    await assert.rejects(connectMuMu(async (command: string) => { calls.push(command); return { output: value }; }), /环境问题：未拍/);
    assert.deepEqual(calls, [mumuManager]);
  }
  assert.throws(() => readMuMuInfo(() => { throw Error('missing manager'); }), /环境问题：未拍/);
});
test('failed connection disconnects only the reported address and never tries a fallback', async () => {
  const calls: unknown[] = [];
  await assert.rejects(connectMuMu(async (command: string, args: string[]) => { calls.push([command, args]); return { output: command === mumuManager ? output(19001) : 'unable to connect' }; }), /环境问题：未拍/);
  assert.deepEqual(calls, [[mumuManager, ['info', '-v', '0']], [adbExecutable, ['connect', '127.0.0.1:19001']], [adbExecutable, ['disconnect', '127.0.0.1:19001']]]);
});

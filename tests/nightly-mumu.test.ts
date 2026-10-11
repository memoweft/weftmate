import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMuMuInfo, readMuMuInfo, connectMuMu, mumuManager, adbExecutable, assertAndroidDevice } from '../scripts/nightly/mumu.mjs';

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

test('the round reads the manager once, passes the same serial and rejects device changes before operations', async () => {
  const calls: unknown[] = [];
  const run = async (command: string, args: string[]) => {
    calls.push([command,args]);
    return {output:command===mumuManager?output(19001):args[0]==='connect'?'connected to 127.0.0.1:19001':'127.0.0.1:19001'};
  };
  const info=await connectMuMu(run);
  await assertAndroidDevice(info.serial,run);await assertAndroidDevice(info.serial,run);
  assert.equal(calls.filter((call:any)=>call[0]===mumuManager).length,1);
  assert.deepEqual(calls.slice(2),[[adbExecutable,['-s',info.serial,'get-serialno']],[adbExecutable,['-s',info.serial,'get-serialno']]]);
  await assert.rejects(assertAndroidDevice(info.serial,async()=>({output:'127.0.0.1:19002'})),/环境问题：未拍.*序列号/);
  await assert.rejects(assertAndroidDevice(info.serial,async()=>{throw Error('disconnected')}),/环境问题：未拍.*不可核实/);
});

import { androidBusyReason } from '../scripts/nightly/android-packages.mjs';
test('independent APK compilation does not occupy MuMu, but connected tests and instrumentation do', () => {
  assert.equal(androidBusyReason('', '', '', ['java gradle -PweftmateApplicationId=com.memoweft.weftmate.mobile.diag2qa :app:assembleDebug :app:testDebugUnitTest']), '');
  assert.equal(androidBusyReason('', '', '', ['pwsh -Command \"echo adb shell am instrument; node review-capture-mobile.mjs --android\"']), '');
  for (const command of ['gradle :app:connectedDebugAndroidTest', 'adb shell am instrument -w synthetic.test/runner', 'node review-capture-mobile.mjs --android'])
    assert.match(androidBusyReason('', '', '', [command]), /Windows/);
});

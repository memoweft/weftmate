import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');

describe('本机数据删除接线（新基座：main 壳接缝）', () => {
  it('带标记的擦除重启在单实例锁之前验证并执行', () => {
    const wipeLaunch = main.indexOf('const wipeLaunch = localDataWipeLaunchRequest(process.argv)');
    const wipeCall = main.indexOf('wipeLocalDataFromMarker({', wipeLaunch);
    const singleInstanceLock = main.indexOf('app.requestSingleInstanceLock()');
    assert.ok(wipeLaunch >= 0, 'main 必须先解析擦除启动请求');
    assert.ok(wipeCall > wipeLaunch, '擦除调用必须发生在擦除启动请求之后');
    assert.ok(wipeCall < singleInstanceLock, '擦除调用必须发生在单实例锁之前');
  });
});

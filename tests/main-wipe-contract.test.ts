import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R4 退役收口：旧 bridge/旧 UI 已删——本机数据删除契约只锁新基座事实源 = src/main.mjs 的壳接缝
// （ARCHITECTURE §5 保留的擦除接缝；IPC 面暂无官方 UI 调用方，安全次序必须由壳自身保证）。
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');

describe('本机数据删除接线（新基座：main 壳接缝）', () => {
  it('擦除发生在单实例锁之前，确认短语校验必须先于创建擦除标记', () => {
    const wipeLaunch = main.indexOf('const wipeLaunch = localDataWipeLaunchRequest(process.argv)');
    const wipeCall = main.indexOf('wipeLocalDataFromMarker({', wipeLaunch);
    const singleInstanceLock = main.indexOf('app.requestSingleInstanceLock()');
    assert.ok(wipeLaunch >= 0, 'main 必须先解析擦除启动请求');
    assert.ok(wipeCall > wipeLaunch, '擦除调用必须发生在擦除启动请求之后');
    assert.ok(wipeCall < singleInstanceLock, '擦除调用必须发生在单实例锁之前');
    const wipeHandler = main.indexOf("ipcMain.handle('wm:delete-all-local-data'");
    assert.ok(wipeHandler > 0, 'main 必须保留擦除 IPC 接缝');
    assert.ok(
      main.indexOf('createLocalDataWipeMarker', wipeHandler)
        > main.indexOf("confirmation !== '删除 WeftMate'", wipeHandler),
      '确认短语校验必须先于创建擦除标记',
    );
    assert.match(main, /confirmation !== '删除 WeftMate' && confirmation !== 'Delete WeftMate'/);
  });

  it('IPC 只信任 canonical 主 frame，重入与失败都有明确错误码', () => {
    const wipeHandler = main.slice(main.indexOf("ipcMain.handle('wm:delete-all-local-data'"));
    assert.match(wipeHandler, /stageOneTrusted\(event\)[\s\S]*WIPE_UNTRUSTED_SOURCE/);
    assert.match(wipeHandler, /WIPE_ALREADY_PREPARING/);
    assert.match(wipeHandler, /WIPE_MARKER_FAILED/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('阶段 0 主进程启动与退出收口', () => {
  it('开发版和安装版都固定使用 WeftMate 自有 vendor DSH', () => {
    assert.match(main, /const productDshRuntime = app\.isPackaged\s*\? join\(process\.resourcesPath, 'dsh-runtime'\)\s*:\s*join\(app\.getAppPath\(\), 'vendor', 'dsh-runtime'\)/);
    assert.match(main, /runtimePath: productDshRuntime/);
    assert.doesNotMatch(main.slice(main.indexOf('const createWebRuntime =')), /checkoutPath:/);
  });

  it('显式 dogfood userData 在 wipe 和单实例锁之前生效，且 IPC 仅在控制开关开启时退出', () => {
    const userDataOverride = main.indexOf('const requestedUserData =');
    const wipeLaunch = main.indexOf('const wipeLaunch = localDataWipeLaunchRequest(process.argv)');
    const instanceLock = main.indexOf('app.requestSingleInstanceLock()');
    assert.ok(userDataOverride >= 0 && userDataOverride < wipeLaunch && wipeLaunch < instanceLock);
    assert.match(main, /app\.setPath\('userData', resolve\(requestedUserData\)\)/);

    const control = main.slice(main.indexOf("process.on('message'"), main.indexOf('const PET_WINDOW_SIZE'));
    assert.match(control, /WEFTMATE_DOGFOOD_CONTROL !== '1'/);
    assert.match(control, /message\.type !== 'weftmate:quit'/);
    assert.match(control, /isQuitting = true;\n  app\.quit\(\);/);
  });

  it('bootstrap、窗口和 shutdown 都有阶段 0 的确定性收口顺序', () => {
    assert.match(main, /app\.whenReady\(\)\.then\(bootstrap\)\.catch\(\(error\) => failBootstrap\(error\)\)/);
    assert.match(main, /if \(!win \|\| win\.isDestroyed\(\)\) return/);

    const windowStart = main.indexOf('win = new BrowserWindow({');
    // 主窗口使用受管官方 DSH surface；其精确动态 origin 在窗口/托盘接线后才加载。
    const load = main.indexOf('await navigateToRuntimeSurface(origin);', windowStart);
    const close = main.indexOf("win.on('close'", windowStart);
    const closed = main.indexOf("win.on('closed'", windowStart);
    const tray = main.indexOf('setupTray();', windowStart);
    assert.ok(windowStart >= 0 && close > windowStart && closed > close && tray > closed && tray < load);

    const shutdown = main.slice(main.indexOf("app.on('before-quit'"));
    assert.match(shutdown, /if \(shutdownPromise\) return;/);
    assert.match(shutdown, /exclusiveMainQueue\?\.stopAcceptingAndDrain\(\)/);
    assert.match(shutdown, /await exclusiveMainQueue\.stopAcceptingAndDrain\(async \(\) => \{\s*await webRuntime\?\.close\?\.\(\);/);
    assert.ok(shutdown.indexOf('stopAcceptingAndDrain') < shutdown.indexOf('app.exit(startupExitCode)'));
    assert.match(shutdown, /shutdownPromise = \(async \(\) =>/);
  });
});

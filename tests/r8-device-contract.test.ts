import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R8-01 设备接缝契约（源码锁）：手机源开关独立默认关、main 设备管理（token 轮换/消费）、
// 宿主插件端点（token 校验先于动作、白名单）、感知手机段合并与注入、UI tooltip。
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const devices = readFileSync(new URL('../src/devices.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const perception = readFileSync(new URL('../src/perception.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// P1-02：端点/校验/注入实现下沉 gateway/legacy（路由表 + 设备面 + 注入面）。
const gatewayRouter = readFileSync(new URL('../src/runtime/gateway/legacy/http.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gatewayDevice = readFileSync(new URL('../src/runtime/gateway/legacy/device.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gatewayInject = readFileSync(new URL('../src/runtime/gateway/legacy/inject.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

// 取顶层函数体（列 0 的收尾 `}` 为止；嵌套闭合均缩进）。
function fnBody(source: string, name: string): string {
  const match = new RegExp(`^(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm').exec(source);
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

describe('R8-01 设备接缝契约（手机源 · 桌面侧）', () => {
  it('手机感知源开关：独立、默认关，不动桌面/剪贴板/注入开关', () => {
    const getter = between(settings, 'export function getMobilePerceptionEnabled()', 'export function setMobilePerceptionEnabled');
    const setter = between(settings, 'export function setMobilePerceptionEnabled(on: boolean)', '/** 感知设置视图');
    assert.match(getter, /sources\?\.mobile\?\.enabled === true/);
    assert.match(setter, /p\.sources = \{ \.\.\.\(p\.sources \?\? \{\}\), mobile: \{ \.\.\.\(p\.sources\?\.mobile \?\? \{\}\), enabled: !!on \} \}/);
    assert.doesNotMatch(setter, /desktop|clipboard|inject/);
    const view = between(settings, 'export function readPerceptionView()', 'export interface DesktopPetWindowState');
    assert.match(view, /mobile: \{ enabled: getMobilePerceptionEnabled\(\) \}/);
  });

  it('main 设备管理：token 生成/TTL 轮换、pair/observation 消费、开关关即丢弃', () => {
    assert.match(devices, /PAIRING_TTL_MS = 10 \* 60_000/);
    assert.match(devices, /randomBytes\(16\)\.toString\('hex'\)/);
    assert.match(devices, /now >= state\.pairing\.expiresAt/);
    assert.match(devices, /raw\.action === 'pair'/);
    assert.match(devices, /raw\.action === 'observation'/);
    assert.ok(devices.indexOf("if (getMobilePerceptionEnabled() !== true) return") > devices.indexOf("raw.action === 'observation'"));
    assert.match(devices, /OBSERVATION_MAX_CHARS = 500/);
    assert.match(devices, /observations = observations\.slice\(0, MAX_OBSERVATIONS\)/);
    assert.match(devices, /消费即删/);
  });

  it('main 接线：devices 先于 perception（手机段读取面）、退出双收口', () => {
    assert.ok(main.indexOf('devicesRuntime = initDevices({ dshHome })') < main.indexOf('perceptionRuntime = initPerception({'));
    assert.match(main, /readMobileObservations: \(\) => devicesRuntime\?\.readMobileObservations\(\) \?\? \[\]/);
    const quit = between(main, "app.on('before-quit'", 'cleanupDone = true');
    assert.ok(quit.indexOf('perceptionRuntime?.dispose?.()') < quit.indexOf('devicesRuntime?.dispose?.()'));
  });

  it('宿主插件端点：token 校验先于任何动作；pair/observation 白名单与配对前置', () => {
    // P1-02：路由表在 gateway/legacy/http.mjs，token 校验/请求写在 gateway/legacy/device.mjs。
    assert.match(gatewayRouter, /pathname === '\/weftmate\/device\/state\.json'/);
    assert.match(gatewayRouter, /pathname === '\/weftmate\/device\/v1\/pair' && req\.method === 'POST'/);
    assert.match(gatewayRouter, /pathname === '\/weftmate\/device\/v1\/observation' && req\.method === 'POST'/);
    const verifier = between(gatewayDevice, 'function verifyDeviceToken(token)', 'function writeDeviceRequest');
    assert.match(verifier, /token !== pairing\.token/);
    assert.match(verifier, /Date\.now\(\) >= pairing\.expiresAt/);
    assert.match(verifier, /return 'EXPIRED_TOKEN'/);
    const pairRoute = between(gatewayRouter, "pathname === '/weftmate/device/v1/pair'", "pathname === '/weftmate/device/v1/observation'");
    assert.ok(pairRoute.indexOf('verifyDeviceToken(payload?.token)') < pairRoute.indexOf('writeDeviceRequest'), 'token 校验必须先于动作');
    const obsRoute = between(gatewayRouter, "pathname === '/weftmate/device/v1/observation'", 'res.writeHead(404)');
    assert.ok(obsRoute.indexOf('verifyDeviceToken(payload?.token)') < obsRoute.indexOf('writeDeviceRequest'));
    assert.match(obsRoute, /code: 'UNPAIRED_DEVICE'/);
  });

  it('感知手机段：开关开才合并、截断、注入快照加手机行、设置节展示', () => {
    assert.match(perception, /mobile: mobileEnabled/);
    assert.match(perception, /if \(mobileEnabled\) \{/);
    assert.match(perception, /latest\.content\.slice\(0, 300\)/);
    const inject = fnBody(gatewayInject, 'createPerceptionInjector');
    assert.match(inject, /sample\.mobile && typeof sample\.mobile\.content === 'string'/);
    assert.match(inject, /手机（用户已开启手机源，设备/);
    assert.match(client, /sample\.mobile\.content\.slice\(0, 40\)/);
    assert.match(client, /手机\[/);
    // 配对 token/设备列表展示面 = 官方设置页 WeftMate 节（R8 收口）。
    assert.match(client, /fetch\('\/weftmate\/device\/state\.json', \{ cache: 'no-store' \}\)/);
    assert.match(client, /pairing\.token/);
    assert.match(client, /暂无已配对设备/);
  });
});

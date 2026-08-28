import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R6-01 感知接缝契约：锁新基座事实源（源码形状）——settings 三开关独立默认关、
// main 采集面隐私纪律、宿主插件 HTTP/注入面白名单、客户端胶囊轮询与开关动作。
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const perception = readFileSync(new URL('../src/perception.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// P1-02：路由/白名单/注入实现下沉 gateway/legacy；入口只留挂载与注册（下方仍锁入口接线）。
const hostPlugin = readFileSync(new URL('../src/plugins/weftmate-host.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gatewayRouter = readFileSync(new URL('../src/runtime/gateway/legacy/http.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gatewayPerception = readFileSync(new URL('../src/runtime/gateway/legacy/perception.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gatewayInject = readFileSync(new URL('../src/runtime/gateway/legacy/inject.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// 取顶层函数体（列 0 的收尾 `}` 为止；嵌套闭合均缩进）。
function fnBody(source: string, name: string): string {
  const match = new RegExp(`^(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm').exec(source);
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

describe('R6-01 桌面感知接缝契约', () => {
  it('感知三开关独立、默认全关；readPerceptionView 暴露完整形状', () => {
    const clipboardGet = between(settings, 'export function getClipboardEnabled()', 'export function setClipboardEnabled');
    const injectGet = between(settings, 'export function getInjectEnabled()', 'export function setInjectEnabled');
    assert.match(clipboardGet, /clipboard\?\.enabled === true/);
    assert.match(injectGet, /inject\?\.enabled === true/);
    // 默认关：读不到字段 → false（断言取值的 === true 形状）。
    const view = between(settings, 'export function readPerceptionView()', 'export interface DesktopPetWindowState');
    assert.match(view, /clipboard: \{ enabled: getClipboardEnabled\(\) \}/);
    assert.match(view, /inject: \{ enabled: getInjectEnabled\(\), intervalMs: getInjectIntervalMs\(\) \}/);
    // 开关互不串联：setPerceptionEnabled 不写 clipboard/inject；setClipboardEnabled 不写 inject/sources。
    const setMain = between(settings, 'export function setPerceptionEnabled(on: boolean)', '/** 是否允许感知数据上云');
    const setClipboard = between(settings, 'export function setClipboardEnabled(on: boolean)', '/** 感知注入模型上下文');
    assert.doesNotMatch(setMain, /clipboard|inject/);
    assert.doesNotMatch(setClipboard, /inject|sources/);
    // 注入间隔夹取 5s–1h。
    const interval = between(settings, 'export function getInjectIntervalMs()', '/** 感知设置视图');
    assert.match(interval, /Math\.min\(3_600_000, Math\.max\(5_000, Math\.round\(n\)\)\)/);
  });

  it('采集面隐私纪律：不开不采、剪贴板独立门、标题/剪贴板截断、原子写', () => {
    assert.match(perception, /if \(!config\.enabled\)[\s\S]*sample: null/);
    assert.match(perception, /if \(config\.clipboard\)/);
    assert.match(perception, /CLIPBOARD_MAX_CHARS = 500/);
    assert.match(perception, /TITLE_MAX_CHARS = 300/);
    assert.match(perception, /writeFileSync\(`\$\{stateFile\}\.tmp`, text, 'utf8'\)[\s\S]*renameSync/);
    // 采样只写本地 dsh-home 文件，无网络出口。
    assert.doesNotMatch(perception, /fetch\(|http:\/\/|https:\/\//);
  });

  it('main 接线：采集面在 dshHome 之后启动、请求白名单、退出收口', () => {
    assert.ok(main.indexOf('perceptionRuntime = initPerception({') > main.indexOf("join(app.getPath('userData'), 'dsh-home')"));
    assert.match(main, /perceptionRuntime = initPerception\(\{\s*dshHome,/);
    const consumer = between(main, 'function handlePerceptionRequests()', '// R6-01 · 感知采集面');
    for (const action of ['set-enabled', 'set-capture', 'set-clipboard', 'set-inject', 'set-mobile']) {
      assert.match(consumer, new RegExp(`raw\\.action === '${action}'`));
    }
    assert.doesNotMatch(consumer, /setPerceptionCloudAllowed/);
    const quit = between(main, "app.on('before-quit'", 'cleanupDone = true');
    assert.match(quit, /perceptionRuntime\?\.dispose\?\.\(\)/);
  });

  it('宿主插件：HTTP 面白名单（set-* + value 校验）+ 注入门（开关/间隔/剪贴板不入模型）', () => {
    // P1-02：入口仍锁注入面注册（prepend 顺序不变）。
    assert.match(hostPlugin, /ctx\.on\('agent\/pre-step', createPerceptionInjector\(\), \{ prepend: true \}\)/);
    assert.match(gatewayRouter, /pathname === '\/weftmate\/perception\.json' && \(req\.method === 'GET' \|\| req\.method === 'HEAD'\)/);
    assert.match(gatewayRouter, /pathname === '\/weftmate\/perception' && req\.method === 'POST'/);
    const whitelist = fnBody(gatewayPerception, 'writePerceptionRequest');
    assert.match(whitelist, /action !== 'set-enabled' && action !== 'set-capture' && action !== 'set-clipboard'/);
    assert.match(whitelist, /action !== 'set-inject' && action !== 'set-mobile'/);
    assert.match(whitelist, /value !== 'app_title' && value !== 'app_only'/);
    assert.match(whitelist, /typeof value !== 'boolean'/);
    const inject = fnBody(gatewayInject, 'createPerceptionInjector');
    assert.ok(inject.indexOf('if (!cfg?.inject?.enabled) return decision') < inject.indexOf('lastInjectAt = now'));
    assert.match(inject, /if \(now - lastInjectAt < intervalMs\) return decision/);
    assert.match(inject, /const decision = await next\(\)/);
    assert.doesNotMatch(inject, /clipboardText|sample\?\.clipboard/, '剪贴板内容永不进入模型上下文');
    assert.match(inject, /内容不注入模型/);
  });

  it('设置节：官方设置页 WeftMate 节 = 感知开关唯一控制面（set-* 确定性动作，胶囊已删）', () => {
    assert.match(client, /ctx\.slots\.inject\('settings\.section', function \(\) \{/);
    assert.match(client, /name: 'settings\.section'/);
    assert.match(client, /id: 'weftmate'/);
    assert.match(client, /label: 'WeftMate'/);
    assert.match(client, /pollPerception\(setPerception\)/);
    assert.match(client, /postSeam\('\/weftmate\/perception', action, value\)/);
    for (const action of ['set-enabled', 'set-capture', 'set-clipboard', 'set-inject', 'set-mobile']) {
      assert.match(client, new RegExp(`'${action}'`));
    }
    assert.match(client, /sample\.activeWindow/);
    assert.doesNotMatch(client, /id: 'weftmate-perception'/);
    assert.doesNotMatch(client, /id: 'weftmate-pet'/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R6-02 桌宠恢复契约：锁新基座事实源——main 伴侣状态源（PetStore→sanitize）、自动唤醒、
// 动作请求白名单、host-state pet 块、宿主插件 /weftmate/pet、客户端桌宠胶囊。
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// P1-02：/weftmate/pet 路由与请求白名单下沉 gateway/legacy。
const gatewayRouter = readFileSync(new URL('../src/runtime/gateway/legacy/http.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gatewayPet = readFileSync(new URL('../src/runtime/gateway/legacy/pet.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
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

describe('R6-02 桌宠恢复接缝契约（新基座）', () => {
  it('伴侣状态源：PetStore 读 userData pets 文件 → sanitize → 记忆驱动字段在位', () => {
    const loader = between(main, 'async function loadCompanion()', 'async function bootstrap()');
    assert.match(loader, /new PetStore\(join\(app\.getPath\('userData'\), 'weftmate-pets\.json'\)\)/);
    assert.match(loader, /petForPersona\('weftmate'\)/);
    assert.match(loader, /proactivity: petStoreMod\.proactivityForPersona\('weftmate'\)/);
    assert.match(loader, /sanitizeCompanionState\(\{/);
    // 记忆驱动接缝：proactivity/activity 随 companion 状态进入宠物窗口。
    assert.match(loader, /activity: 'idle'/);
    // 旧人格层不复用：persona 用产品身份。
    assert.match(loader, /persona: \{ id: 'weftmate', name: 'WeftMate' \}/);
  });

  it('自动唤醒只认设置里的 visible 真值；动作请求白名单 set-visible/set-free-activity', () => {
    // 阶段 0 会把 setupTray() 提前到 loadURL 前，不能再把托盘接线当作自动唤醒片段的锚点。
    const autoWake = between(main, '// R6-02 · 桌宠自愈：', 'console.log(');
    assert.match(autoWake, /desktopCompanion && settingsMod\?\.getDesktopPetWindowState\?\.\(\)\.visible/);
    assert.match(autoWake, /void wakeDesktopPet\(\)/);
    const consumer = between(main, 'function handlePetRequests()', 'writeHostState();');
    for (const action of ['set-visible', 'set-free-activity']) {
      assert.match(consumer, new RegExp(`raw\\.action === '${action}'`));
    }
    assert.match(consumer, /toggleDesktopPet\(desktopCompanion\)/);
    assert.match(consumer, /hideDesktopPet\(\)/);
    assert.match(consumer, /setDesktopPetFreeActivity\(want\)/);
    assert.doesNotMatch(consumer, /wakeDesktopPet\(sanitized\)/); // 旧 UI 唤醒路径不复用
  });

  it('host-state 携带 pet 块（名称/可见/自由活动），宿主插件 /weftmate/pet 白名单', () => {
    const stateBlock = between(main, '// R6-02 · 桌宠状态块', '},\n      };');
    assert.match(stateBlock, /name: desktopCompanion\?\.pet\?\.name \?\? null/);
    assert.match(stateBlock, /visible: desktopPetVisible\(\)/);
    assert.match(stateBlock, /freeActivity: desktopPetFreeActivity\(\)/);
    assert.match(gatewayRouter, /pathname === '\/weftmate\/pet' && req\.method === 'POST'/);
    const whitelist = fnBody(gatewayPet, 'writePetRequest');
    assert.match(whitelist, /action !== 'set-visible' && action !== 'set-free-activity'/);
    assert.match(whitelist, /typeof value !== 'boolean'/);
  });

  it('设置节桌宠块：读 status.pet、显示/自由活动走 /weftmate/pet set-*（胶囊已删）', () => {
    assert.match(client, /var pet = \(status && status\.pet\) \|\| null/);
    assert.match(client, /postSeam\('\/weftmate\/pet', action, value\)/);
    assert.match(client, /applyPet\('petVisible', 'set-visible'/);
    assert.match(client, /applyPet\('petFreeActivity', 'set-free-activity'/);
    assert.match(client, /自由活动/);
    assert.doesNotMatch(client, /id: 'weftmate-pet'/);
  });

  it('sprite 图集通道：preload 暴露 loadSpriteAtlas，main 只信任宠物窗口且白名单 xingyao', () => {
    const preload = readFileSync(new URL('../src/desktop-pet-preload.cjs', import.meta.url), 'utf8');
    assert.match(preload, /loadSpriteAtlas: \(name\) => ipcRenderer\.invoke\('wm:pet-sprite', name\)/);
    const handler = between(main, "ipcMain.handle('wm:pet-sprite'", '// 最大化状态变化');
    assert.ok(handler.indexOf('event.sender !== desktopPetWin.webContents') < handler.indexOf('await readFileAsync'));
    assert.match(handler, /await readFileAsync/);
    assert.doesNotMatch(handler, /readFileSync/);
    assert.match(handler, /if \(name !== 'xingyao'\) return null/);
    assert.match(handler, /join\(import\.meta\.dirname, 'pets', 'assets', name, 'spritesheet\.webp'\)/);
  });
});

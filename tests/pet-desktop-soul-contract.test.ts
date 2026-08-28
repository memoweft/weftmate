import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

import { PetStore } from '../src/pets/store.ts';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const petPreload = readFileSync(new URL('../src/desktop-pet-preload.cjs', import.meta.url), 'utf8');
const petHtml = readFileSync(new URL('../src/web/desktop-pet.html', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
// R4 退役：旧 UI/bridge/persona 已删；感知模板保留（R6 恢复用），采集插件不能反向控制宠物。
const perceptionPlugin = readFileSync(new URL('../runtime/plugins/weftmate-perception.template.ts', import.meta.url), 'utf8');
const roots: string[] = [];

function between(source: string, start: string, end: string): string {
  const normalized = source.replace(/\r\n/g, '\n');
  const from = normalized.indexOf(start);
  const to = normalized.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return normalized.slice(from, to);
}

function runPreload(source: string) {
  const exposed: Record<string, Record<string, (...args: unknown[]) => unknown>> = {};
  const sent: unknown[][] = [];
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const invoked: unknown[][] = [];
  const electron = {
    contextBridge: {
      exposeInMainWorld(name: string, api: Record<string, (...args: unknown[]) => unknown>) {
        exposed[name] = api;
      },
    },
    ipcRenderer: {
      send(...args: unknown[]) { sent.push(args); },
      invoke(...args: unknown[]) { invoked.push(args); return Promise.resolve({ visible: true, freeActivity: true }); },
      on(channel: string, callback: (...args: unknown[]) => unknown) { listeners.set(channel, callback); },
    },
  };
  vm.runInNewContext(source, { require: (id: string) => {
    assert.equal(id, 'electron');
    return electron;
  } });
  return { exposed, sent, invoked, listeners };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('桌面宠物与 Soul 隔离契约（R4 退役后：只锁新基座事实源）', () => {
  it('主进程锁住宠物窗口来源，宠物 preload 只暴露自身需要的窄能力', async () => {
    const windowBlock = between(main, 'async function ensureDesktopPetWindow()', 'async function wakeDesktopPet');
    assert.match(windowBlock, /preload: join\(import\.meta\.dirname, 'desktop-pet-preload\.cjs'\)/);
    for (const guard of ['nodeIntegration: false', 'contextIsolation: true', 'sandbox: true', 'webSecurity: true']) {
      assert.match(windowBlock, new RegExp(guard));
    }
    assert.match(windowBlock, /will-navigate'[\s\S]*event\.preventDefault\(\)/);
    assert.match(windowBlock, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
    assert.match(windowBlock, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);

    const sanitizer = between(main, 'function sanitizeCompanionState(value)', 'function desktopPetBounds');
    assert.match(sanitizer, /persona: \{ id: personaId, name: personaName \}/);
    assert.match(sanitizer, /appearance: \{[\s\S]*kind: 'procedural'[\s\S]*shape:[\s\S]*primary:[\s\S]*accent:[\s\S]*feature:/);
    assert.doesNotMatch(sanitizer, /systemPrompt|memoryRead|tools?|apiKey|filePath|workspace/);

    const ipc = between(main, "ipcMain.on('wm:pet-sync'", '// 最大化状态变化');
    const toggleHandler = between(ipc, "ipcMain.handle('wm:pet-toggle'", "ipcMain.handle('wm:pet-visibility'");
    assert.ok(toggleHandler.indexOf('event.sender !== win.webContents') < toggleHandler.indexOf('sanitizeCompanionState(state)'));
    assert.match(toggleHandler, /return toggleDesktopPet\(sanitized \|\| desktopCompanion\)/);
    const menuHandler = between(ipc, "ipcMain.on('wm:pet-context-menu'", "ipcMain.on('wm:pet-pointer'");
    assert.ok(menuHandler.indexOf('event.sender === desktopPetWin.webContents') < menuHandler.indexOf('showDesktopPetContextMenu()'));
    const hitTestHandler = between(ipc, "ipcMain.on('wm:pet-hit-test'", "ipcMain.on('wm:pet-interact'");
    assert.ok(hitTestHandler.indexOf('event.sender !== desktopPetWin.webContents') < hitTestHandler.indexOf("typeof state.interactive === 'boolean'"));
    assert.match(hitTestHandler, /!valid \|\| state\.interactive !== true[\s\S]*setIgnoreMouseEvents\(true, \{ forward: true \}\)[\s\S]*setIgnoreMouseEvents\(false\)/);
    assert.match(ipc, /wm:pet-hide'[\s\S]*trustedMain[\s\S]*trustedPet[\s\S]*if \(trustedMain \|\| trustedPet\) hideDesktopPet\(\)/);
    assert.match(ipc, /wm:pet-show-main'[\s\S]*event\.sender === desktopPetWin\.webContents/);

    const desktop = runPreload(petPreload);
    assert.deepEqual(Object.keys(desktop.exposed.wmDesktopPet).sort(), ['dragEnd', 'dragMove', 'dragStart', 'hide', 'interact', 'loadSpriteAtlas', 'onBehavior', 'onState', 'openContextMenu', 'openPage', 'requestResize', 'setHitTest', 'setPointerInside', 'showMain']);
    let received: unknown, behavior: unknown;
    desktop.exposed.wmDesktopPet.onState((state: unknown) => { received = state; });
    desktop.exposed.wmDesktopPet.onBehavior((state: unknown) => { behavior = state; });
    desktop.listeners.get('wm:pet-state')?.({}, { safe: true });
    desktop.listeners.get('wm:pet-behavior')?.({}, { kind: 'watch', lookX: 1, lookY: 0 });
    desktop.exposed.wmDesktopPet.showMain();
    desktop.exposed.wmDesktopPet.hide();
    desktop.exposed.wmDesktopPet.openContextMenu();
    desktop.exposed.wmDesktopPet.setHitTest(true, true);
    desktop.exposed.wmDesktopPet.setHitTest('true', 1);
    desktop.exposed.wmDesktopPet.setPointerInside(true);
    desktop.exposed.wmDesktopPet.dragStart({ x: 10, y: 20 });
    desktop.exposed.wmDesktopPet.dragMove({ x: 30, y: 40 });
    desktop.exposed.wmDesktopPet.dragEnd();
    desktop.exposed.wmDesktopPet.interact('click');
    assert.deepEqual(received, { safe: true });
    assert.deepEqual(behavior, { kind: 'watch', lookX: 1, lookY: 0 });
    // setHitTest 的窄对象在 preload VM realm 内创建，先按 IPC 可序列化形状归一化再比较。
    const desktopSent = JSON.parse(JSON.stringify(desktop.sent));
    assert.deepEqual(desktopSent, [
      ['wm:pet-show-main'], ['wm:pet-hide'], ['wm:pet-context-menu'],
      ['wm:pet-hit-test', { interactive: true, hovering: true }],
      ['wm:pet-hit-test', { interactive: false, hovering: false }], ['wm:pet-pointer', true],
      ['wm:pet-drag-start', { x: 10, y: 20 }], ['wm:pet-drag-move', { x: 30, y: 40 }], ['wm:pet-drag-end'], ['wm:pet-interact', 'click'],
    ]);

    const menu = between(main, 'function showDesktopPetContextMenu()', 'async function bootstrap()');
    assert.match(menu, /去聊天[\s\S]*宠物设置…[\s\S]*允许自由活动[\s\S]*回到屏幕右下角[\s\S]*让它休息/);
    assert.doesNotMatch(menu, /走两步/);
    assert.doesNotMatch(menu, /event\.|templateFromRenderer|https?:/);
    assert.match(menu, /\.popup\(\{ window: desktopPetWin \}\)/);
    assert.match(petHtml, /contextmenu'[\s\S]*event\.preventDefault\(\)[\s\S]*openContextMenu\(\)/);
    assert.match(petHtml, /data-behavior="wander"[\s\S]*animation: travel/);
    // M6·自然走动：步伐节奏（两步一循环 + 变速 --walk-dur）。
    assert.match(petHtml, /@keyframes travel[\s\S]*translateY\(-3px\)/);
    assert.match(petHtml, /--walk-dur/);
  });

  it('宠物显示和走动不替用户开启感知，感知插件也不能反向控制宠物', () => {
    const desktopSettings = settings.slice(settings.indexOf('export function getDesktopPetWindowState()'));
    assert.doesNotMatch(desktopSettings, /setPerception|cloudAllowed|capture/);
    const setPerception = between(settings, 'export function setPerceptionEnabled(on: boolean)', '/** 是否允许感知数据上云');
    assert.doesNotMatch(setPerception, /desktopPet/);
    // 感知采集在运行时内插件（weftmate-perception）；它不能反向控制宠物。
    assert.doesNotMatch(perceptionPlugin, /wakeDesktopPet|hideDesktopPet|toggleDesktopPet|wm:pet/, '采集插件不能反向控制宠物');
    const companion = between(main, 'function sendDesktopCompanion()', 'function desktopPetPresenceAllowsRoam()');
    assert.doesNotMatch(companion, /windowTitle|processName|rawContent|activeWindow|presenceView/);
  });

  it('宠物 Store 的绑定与主动度不与导出/记忆面耦合（PetStore 单实例往返）', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-soul-pet-export-'));
    roots.push(root);
    const pets = new PetStore(join(root, 'pets.json'));
    const pet = pets.save({
      name: '小团', description: '桌面伙伴', shape: 'wisp', feature: 'ears',
      primary: '#334455', accent: '#aabbcc',
    });
    pets.bind('xingyao', pet.id);
    pets.setProactivity('xingyao', 'companion');

    assert.equal(pets.petForPersona('xingyao').id, pet.id);
    assert.equal(pets.proactivityForPersona('xingyao'), 'companion');
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

import { PersonaStore, type PersonaManifest } from '../src/personas/store.ts';
import { PetStore } from '../src/pets/store.ts';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const mainPreload = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');
const petPreload = readFileSync(new URL('../src/desktop-pet-preload.cjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const petHtml = readFileSync(new URL('../src/web/desktop-pet.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const collector = readFileSync(new URL('../src/collector.ts', import.meta.url), 'utf8');
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

describe('桌面宠物与 Soul 隔离契约', () => {
  it('主进程锁住宠物窗口来源，两个 preload 只暴露各自需要的窄能力', async () => {
    const windowBlock = between(main, 'async function ensureDesktopPetWindow()', 'async function wakeDesktopPet');
    assert.match(windowBlock, /preload: join\(import\.meta\.dirname, 'desktop-pet-preload\.cjs'\)/);
    for (const guard of ['nodeIntegration: false', 'contextIsolation: true', 'sandbox: true', 'webSecurity: true']) {
      assert.match(windowBlock, new RegExp(guard));
    }
    assert.match(windowBlock, /will-navigate'[\s\S]*event\.preventDefault\(\)/);
    assert.match(windowBlock, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);

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
    assert.match(ipc, /wm:pet-hide'[\s\S]*trustedMain[\s\S]*trustedPet[\s\S]*if \(trustedMain \|\| trustedPet\) hideDesktopPet\(\)/);
    assert.match(ipc, /wm:pet-show-main'[\s\S]*event\.sender === desktopPetWin\.webContents/);

    const renderer = runPreload(mainPreload);
    assert.deepEqual(Object.keys(renderer.exposed.wmPet).sort(), ['composerActivity', 'onOpenPets', 'onVisibility', 'setFreeActivity', 'sync', 'toggle', 'visibility']);
    await renderer.exposed.wmPet.toggle({ pet: 'state' });
    await renderer.exposed.wmPet.visibility();
    await renderer.exposed.wmPet.setFreeActivity(false);
    renderer.exposed.wmPet.sync({ pet: 'next' });
    renderer.exposed.wmPet.composerActivity();
    assert.deepEqual(renderer.invoked, [
      ['wm:pet-toggle', { pet: 'state' }],
      ['wm:pet-visibility'],
      ['wm:pet-free-activity', false],
    ]);
    assert.deepEqual(renderer.sent, [['wm:pet-sync', { pet: 'next' }], ['wm:pet-composer-activity']]);

    const desktop = runPreload(petPreload);
    assert.deepEqual(Object.keys(desktop.exposed.wmDesktopPet).sort(), ['dragEnd', 'dragMove', 'dragStart', 'hide', 'interact', 'onBehavior', 'onState', 'openContextMenu', 'openPage', 'setPointerInside', 'showMain']);
    let received: unknown, behavior: unknown;
    desktop.exposed.wmDesktopPet.onState((state: unknown) => { received = state; });
    desktop.exposed.wmDesktopPet.onBehavior((state: unknown) => { behavior = state; });
    desktop.listeners.get('wm:pet-state')?.({}, { safe: true });
    desktop.listeners.get('wm:pet-behavior')?.({}, { kind: 'watch', lookX: 1, lookY: 0 });
    desktop.exposed.wmDesktopPet.showMain();
    desktop.exposed.wmDesktopPet.hide();
    desktop.exposed.wmDesktopPet.openContextMenu();
    desktop.exposed.wmDesktopPet.setPointerInside(true);
    desktop.exposed.wmDesktopPet.dragStart({ x: 10, y: 20 });
    desktop.exposed.wmDesktopPet.dragMove({ x: 30, y: 40 });
    desktop.exposed.wmDesktopPet.dragEnd();
    desktop.exposed.wmDesktopPet.interact('click');
    assert.deepEqual(received, { safe: true });
    assert.deepEqual(behavior, { kind: 'watch', lookX: 1, lookY: 0 });
    assert.deepEqual(desktop.sent, [
      ['wm:pet-show-main'], ['wm:pet-hide'], ['wm:pet-context-menu'], ['wm:pet-pointer', true],
      ['wm:pet-drag-start', { x: 10, y: 20 }], ['wm:pet-drag-move', { x: 30, y: 40 }], ['wm:pet-drag-end'], ['wm:pet-interact', 'click'],
    ]);

    const menu = between(main, 'function showDesktopPetContextMenu()', 'async function bootstrap()');
    assert.match(menu, /去聊天[\s\S]*宠物设置…[\s\S]*允许自由活动[\s\S]*回到屏幕右下角[\s\S]*让它休息/);
    assert.doesNotMatch(menu, /走两步/);
    assert.doesNotMatch(menu, /event\.|templateFromRenderer|https?:/);
    assert.match(menu, /\.popup\(\{ window: desktopPetWin \}\)/);
    assert.match(petHtml, /contextmenu'[\s\S]*event\.preventDefault\(\)[\s\S]*openContextMenu\(\)/);
    assert.match(petHtml, /data-behavior="wander"[\s\S]*animation: travel/);
    assert.match(petHtml, /@keyframes travel[\s\S]*translateY\(-8px\)/);
  });

  it('独立宠物页使用主进程真状态 toggle，并保留明确孵化确认和服务端真实阶段', () => {
    const personaPage = between(html, '<div id="memPersonas"', '<div id="memPets"');
    assert.doesNotMatch(personaPage, /class="pet-manage"/);
    const manager = between(html, '<div id="memPets"', '<!-- 数据 / 备份区');
    assert.match(html, /id="tabPets"[^>]*data-tab="pets"/);
    assert.match(manager, /id="petManageList"/);
    assert.doesNotMatch(manager, /<select\b/i);
    assert.match(manager, /id="petHatchConfirm"[^>]*>我确认，开始本机孵化</);
    assert.match(manager, /确认后才会启动本机 MCP/);
    assert.doesNotMatch(manager, /走两步|允许偶尔走动/);
    assert.match(manager, /id="petFreeActivity"[\s\S]*允许自由活动/);

    const memoryRender = between(html, 'function memRender()', '// ── 理解（认知）列表');
    assert.match(memoryRender, /const isPets = MEM\.tab === 'pets'/);
    assert.match(memoryRender, /\$\('memPersonas'\)\.style\.display = isPersonas \? 'block' : 'none'/);
    assert.match(memoryRender, /\$\('memPets'\)\.style\.display = isPets \? 'block' : 'none'/);
    assert.match(html, /\$\('pet'\)\.addEventListener\('click',[\s\S]*MEM\.tab = 'pets'; enterMemory\(\)/);
    assert.match(html, /window\.wmPet\?\.onOpenPets\?\.\(\(\) => \{ MEM\.tab = 'pets'; enterMemory\(\); memRender\(\); \}\)/);

    const petCode = between(html, 'const PETS = {', 'function syncPersonaName()');
    const renderManager = between(petCode, 'function renderPetManager()', 'async function bindPet');
    assert.match(renderManager, /PETS\.desktopVisible \? t\('让桌面宠物休息'\) : t\('唤醒桌面宠物'\)/);
    const toggle = between(petCode, 'async function togglePetVisibility()', 'async function setPetFreeActivity');
    assert.match(toggle, /applyDesktopPetVisibility\(await window\.wmPet\.toggle\(payload\)\)/);
    assert.ok(toggle.indexOf('await window.wmPet.toggle(payload)') < toggle.indexOf('setPetStatus'));
    assert.doesNotMatch(toggle, /PETS\.desktopVisible\s*=\s*!PETS\.desktopVisible/);
    assert.match(petCode, /document\.createElement\('button'\)/);
    assert.match(petCode, /className = 'pet-card/);
    assert.match(petCode, /fetch\('\/api\/pets\/hatch-preview'\)/);
    const start = between(petCode, 'async function startPetHatch()', 'async function cancelPetHatch()');
    assert.match(start, /fetch\('\/api\/pets\/hatch', \{ method: 'POST'/);
    assert.match(start, /previewId: PETS\.preview\.previewId/);
    assert.match(start, /consent: true/);
    const poll = between(petCode, 'async function pollPetHatch()', 'async function startPetHatch()');
    assert.match(poll, /fetch\('\/api\/pets\/hatch\?id=' \+ encodeURIComponent\(PETS\.hatchJobId\)\)/);
    assert.match(poll, /hatchStageText\(data\.stage\)/);
    assert.match(poll, /data\.stage === 'done'/);
    assert.match(poll, /await loadPets\(\)/);
    assert.doesNotMatch(start, /setTimeout|stage\s*=/);

    const inputPulse = between(html, 'let lastPetInputPulse = 0;', '// ── Persona editor end');
    assert.match(inputPulse, /composerActivity\?\.\(\)/);
    assert.doesNotMatch(inputPulse, /event\.data|event\.key|target\.value|clipboard|textContent/);
    const composerIpc = between(main, "ipcMain.on('wm:pet-composer-activity'", "ipcMain.on('wm:pet-hide'");
    assert.ok(composerIpc.indexOf('event.sender === win.webContents') < composerIpc.indexOf('noteDesktopPetComposerActivity()'));
  });

  it('宠物显示和走动不替用户开启感知，感知路由也不能反向控制宠物', () => {
    const desktopSettings = between(settings, 'export function getDesktopPetWindowState()', '// ── Agent 执行自主度');
    assert.doesNotMatch(desktopSettings, /setPerception|cloudAllowed|capture/);
    const setPerception = between(settings, 'export function setPerceptionEnabled(on: boolean)', '/** 是否允许感知数据上云');
    assert.doesNotMatch(setPerception, /desktopPet/);
    const presence = between(collector, 'export function presenceView()', '}\n');
    assert.match(presence, /running:[\s\S]*state:[\s\S]*updatedAt/);
    assert.doesNotMatch(presence, /title|owner|app|lastKey|observation/);
    assert.match(html, /桌面感知未开启；宠物照常显示和走动，不会替你打开感知。/);
    const petControls = between(html, 'async function loadPetSensingState()', 'function closePetHatch');
    assert.match(between(petControls, 'async function loadPetSensingState()', 'async function togglePetVisibility()'), /fetch\('\/api\/settings'\)/);
    assert.doesNotMatch(petControls, /settings\/perception|setPerception/);
    const perceptionRoute = between(server, "url.pathname === '/api/settings/perception'", '// ── 记忆管理页');
    assert.match(perceptionRoute, /collector\.startCollector/);
    assert.match(perceptionRoute, /collector\.stopCollector/);
    assert.doesNotMatch(perceptionRoute, /wakeDesktopPet|hideDesktopPet|toggleDesktopPet|wm:pet/);
    const companion = between(main, 'function sendDesktopCompanion()', 'function desktopPetPresenceAllowsRoam()');
    assert.match(companion, /presenceView/);
    assert.doesNotMatch(companion, /windowTitle|processName|rawContent|activeWindow/);
  });

  it('即使 Soul 已绑定宠物和主动度，导出仍严格只有五个 Persona Manifest 字段', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-soul-pet-export-'));
    roots.push(root);
    const builtins: PersonaManifest[] = [
      { schemaVersion: 1, id: 'plain', name: '普通助手', description: '中性助手', systemPrompt: '保持简洁。' },
      { schemaVersion: 1, id: 'xingyao', name: '星瑶', description: '温柔陪伴', systemPrompt: '你是星瑶。' },
    ];
    const personas = new PersonaStore(join(root, 'personas.json'), builtins, 'xingyao');
    const pets = new PetStore(join(root, 'pets.json'));
    const pet = pets.save({
      name: '小团', description: '桌面伙伴', shape: 'wisp', feature: 'ears',
      primary: '#334455', accent: '#aabbcc',
    });
    pets.bind('xingyao', pet.id);
    pets.setProactivity('xingyao', 'companion');

    assert.equal(pets.petForPersona('xingyao').id, pet.id);
    assert.equal(pets.proactivityForPersona('xingyao'), 'companion');
    const manifest = personas.exportManifest('xingyao');
    assert.deepEqual(Object.keys(manifest).sort(), ['description', 'id', 'name', 'schemaVersion', 'systemPrompt']);
    for (const privateKey of ['pet', 'petId', 'appearance', 'proactivity', 'petByPersona', 'proactivityByPersona', 'memoryReadEnabled']) {
      assert.equal(privateKey in manifest, false, `${privateKey} 不应进入 Soul 导出包`);
    }
  });
});

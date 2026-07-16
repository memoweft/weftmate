import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  clampPetBounds,
  choosePetWorkArea,
  distanceFromPointToRect,
  petRectsOverlap,
  pickPetAvoidTarget,
  pickPetDockTarget,
  pickPetRoamTarget,
  petRoamDelayMs,
} from '../src/desktop-pet-motion.ts';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

describe('桌面宠物屏幕边界与走动', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const left = { x: -1280, y: 120, width: 1280, height: 900 };

  it('把四边越界窗口完整拉回工作区，保留左侧负坐标屏幕', () => {
    assert.deepEqual(clampPetBounds({ x: -30, y: -40, width: 132, height: 132 }, [primary]), { x: 0, y: 0, width: 132, height: 132 });
    assert.deepEqual(clampPetBounds({ x: 2000, y: 1100, width: 132, height: 132 }, [primary]), { x: 1788, y: 908, width: 132, height: 132 });
    assert.deepEqual(clampPetBounds({ x: -1200, y: 200, width: 132, height: 132 }, [left, primary]), { x: -1200, y: 200, width: 132, height: 132 });
  });

  it('完全离屏或屏幕上下错位时按窗口中心选择最近工作区', () => {
    const upperRight = { x: 1920, y: -300, width: 1600, height: 900 };
    assert.equal(choosePetWorkArea({ x: 3600, y: -80, width: 132, height: 132 }, [primary, upperRight]), upperRight);
    assert.deepEqual(clampPetBounds({ x: 3600, y: -80, width: 132, height: 132 }, [primary, upperRight]), { x: 3388, y: -80, width: 132, height: 132 });
  });

  it('自由活动目标始终在当前屏幕内，并以低频随机间隔形成生活感', () => {
    const start = { x: 1700, y: 880, width: 132, height: 132 };
    const target = pickPetRoamTarget(start, primary, () => .99);
    assert.ok(target.x >= 0 && target.x + target.width <= 1920);
    assert.ok(target.y >= 0 && target.y + target.height <= 1040);
    assert.ok((petRoamDelayMs('quiet', () => 0) ?? 0) >= 2 * 60_000);
    assert.ok((petRoamDelayMs('light', () => 0) ?? 0) >= 45_000);
    assert.ok((petRoamDelayMs('companion', () => 1) ?? 0) <= 45_000);
  });

  it('鼠标避让会真正拉开距离，且不越屏或盖住主窗口', () => {
    const start = { x: 760, y: 500, width: 132, height: 132 };
    const cursor = { x: 820, y: 560 };
    const mainWindow = { x: 900, y: 250, width: 850, height: 700 };
    const target = pickPetAvoidTarget(start, cursor, primary, [mainWindow]);
    assert.ok(distanceFromPointToRect(cursor, target) > distanceFromPointToRect(cursor, start));
    assert.ok(target.x >= 0 && target.y >= 0 && target.x + target.width <= 1920 && target.y + target.height <= 1040);
    assert.equal(petRectsOverlap(target, mainWindow, 8), false);
  });

  it('输入停靠优先放在窗口外侧，多屏负坐标安全；最大化无空间时不硬盖内容', () => {
    const windowed = { x: 180, y: 90, width: 1200, height: 760 };
    const dock = pickPetDockTarget(windowed, { width: 132, height: 132 }, [primary]);
    assert.ok(dock);
    assert.equal(petRectsOverlap(dock!, windowed), false);
    assert.ok(dock!.x >= primary.x && dock!.x + dock!.width <= primary.x + primary.width);

    const secondaryWindow = { x: -1180, y: 180, width: 760, height: 620 };
    const secondaryDock = pickPetDockTarget(secondaryWindow, { width: 132, height: 132 }, [primary, left]);
    assert.ok(secondaryDock && secondaryDock.x < 0);
    assert.equal(petRectsOverlap(secondaryDock!, secondaryWindow), false);
    assert.equal(pickPetDockTarget(primary, { width: 132, height: 132 }, [primary]), null);
  });

  it('主进程把启动、人工拖动和显示器变化都接到同一套多屏夹取', () => {
    const initial = between(main, 'function desktopPetBounds(saved = {})', 'function persistDesktopPet');
    assert.match(initial, /clampPetBounds\(candidate, screen\.getAllDisplays\(\)\.map\(\(item\) => item\.workArea\)\)/);

    const clampWindow = between(main, 'function clampDesktopPetWindow(save = true)', 'function recoverDesktopPetToCorner');
    assert.match(clampWindow, /clampPetBounds\(current, screen\.getAllDisplays\(\)\.map\(\(item\) => item\.workArea\)\)/);
    assert.ok(clampWindow.indexOf('samePetBounds(current, safe)') < clampWindow.indexOf('desktopPetWin.setBounds(safe)'));
    assert.ok(clampWindow.indexOf('desktopPetWin.setBounds(safe)') < clampWindow.indexOf('persistDesktopPet'));

    const windowBlock = between(main, 'async function ensureDesktopPetWindow()', 'async function wakeDesktopPet');
    const willMove = between(windowBlock, "desktopPetWin.on('will-move'", "desktopPetWin.on('moved'");
    assert.match(willMove, /clampPetBounds\(nextBounds, screen\.getAllDisplays\(\)\.map\(\(item\) => item\.workArea\)\)/);
    assert.ok(willMove.indexOf('event.preventDefault()') < willMove.indexOf('desktopPetWin?.setBounds(safe)'));
    const moved = between(windowBlock, "desktopPetWin.on('moved'", "desktopPetWin.on('show'");
    assert.ok(moved.indexOf('clampDesktopPetWindow(false)') < moved.indexOf('setTimeout'));
    assert.match(moved, /setTimeout\(\(\) => \{[\s\S]*clampDesktopPetWindow\(true\)/);

    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      assert.match(main, new RegExp(`screen\\.on\\('${event}', handleDesktopDisplayChange\\)`));
    }
    const displayChange = between(main, 'function handleDesktopDisplayChange()', 'async function toggleDesktopPet');
    assert.ok(displayChange.indexOf('cancelDesktopPetMotion()') < displayChange.indexOf('clampDesktopPetWindow(true)'));

    const motion = between(main, 'function advanceDesktopPetMotion(now)', 'function desktopPetMainExclusions()');
    assert.match(motion, /Math\.sin\(Math\.PI \* progress\) \* motion\.arc/);
    assert.match(motion, /clampPetBounds\([\s\S]*motion\.workAreas\)/);
    const controller = between(main, 'function startDesktopPetActivityController()', 'function stopDesktopPetActivityController');
    assert.match(controller, /setInterval\(desktopPetActivityTick, 16\)/);
  });
});

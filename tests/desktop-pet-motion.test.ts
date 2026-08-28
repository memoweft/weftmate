import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  clampPetBounds,
  choosePetWorkArea,
  extendedWorkAreas,
  petRectsOverlap,
  pickPetDockTarget,
  pickPetRoamTarget,
  pickPetRoamTargetBiased,
  petRoamDelayMs,
  tuckPetBounds,
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
    assert.ok((petRoamDelayMs('light', () => 0) ?? 0) >= 60_000);
    assert.ok((petRoamDelayMs('companion', () => 1) ?? 0) <= 60_000);
  });

  it('宠物不躲鼠标（owner 拍板）：光标移动只注视，自由游走是真人感探索', () => {
    // 主进程不得再有避让逻辑（函数/目标选择器/avoid 行为都已退役）。
    assert.doesNotMatch(main, /startDesktopPetAvoid|pickPetAvoidTarget/);
    const tick = between(main, 'function desktopPetActivityTick()', 'function startDesktopPetActivityController');
    assert.match(tick, /sendDesktopPetBehavior\('watch', cursor\)/, '光标动 → 注视（watch）');
    assert.doesNotMatch(tick, /'notice', cursor/, 'notice 只留给真实主动提醒，不再由光标靠近触发');
    assert.doesNotMatch(tick, /distance < 58|mayAvoid/, '不得再有靠近即避让分支');
    // 游走到达后「看看这个」：注视一小会儿再待机。
    const complete = between(main, 'function completeDesktopPetMotion(motion)', 'function advanceDesktopPetMotion');
    assert.match(complete, /motion\.reason === 'wander'/, '游走到达走注视分支');
    assert.match(complete, /sendDesktopPetBehavior\('watch', center\)/, '到达后朝落脚点注视');
    assert.match(complete, /setTimeout\(\(\) => sendDesktopPetBehavior\('idle'\)/, '注视后回到待机');
  });

  it('边缘半隐藏（owner 拍板，角色矩形基准）：角色真正触边挂出，离边远则不动', () => {
    const size = { width: 132, height: 132 };
    // 左/上缘贴边 → 角色 55% 挂出（窗口 x = -14 - 96*.55 = -66.8 → -67；y = -8 - 104*.55 = -65.2 → -65）。
    const leftTop = tuckPetBounds({ x: 0, y: 0, ...size }, primary);
    assert.equal(leftTop.x, -67);
    assert.equal(leftTop.y, -65);
    // 右/下缘贴边 → 角色 45% 留在屏内（窗口 x = 1920 - 14 - 43.2 = 1862.8 → 1863；y = 1040 - 8 - 46.8 = 985.2 → 985）。
    const rightBottom = tuckPetBounds({ x: 1920 - 132, y: 1040 - 132, ...size }, primary);
    assert.equal(rightBottom.x, 1863);
    assert.equal(rightBottom.y, 985);
    // 屏幕中间 → 原样返回。
    const mid = { x: 800, y: 400, ...size };
    assert.deepEqual(tuckPetBounds(mid, primary), mid);
    // 放宽后的工作区可用于游走夹取（允许半隐藏容差）。
    const extended = extendedWorkAreas([primary], { width: 79, height: 79 });
    assert.deepEqual(extended[0], { x: -79, y: -79, width: 1920 + 158, height: 1040 + 158 });
    assert.deepEqual(clampPetBounds({ x: -70, y: -70, ...size }, extended), { x: -70, y: -70, ...size }, '软夹取不把半隐藏位置拽回屏内');
  });

  it('Shimeji 式游走偏好（owner 拍板）：60% 底部地板 / 25% 左右边缘 / 15% 全域，且始终在屏内', () => {
    const size = { width: 132, height: 132 };
    const seq = (values: number[]) => {
      let i = 0;
      return () => values[i++ % values.length];
    };
    // 掷 0.5 → 底部地板条带。
    const floor = pickPetRoamTargetBiased({ x: 900, y: 400, ...size }, primary, seq([0.5, 0.5, 0.5]));
    assert.ok(floor.y >= 1040 - Math.round(1040 * .26), '地板目标应在底部条带：' + JSON.stringify(floor));
    assert.ok(floor.y + floor.height <= 1040 && floor.x >= 0 && floor.x + floor.width <= 1920, '不越屏');
    // 掷 0.7 → 左右边缘竖条（x 落在两侧 30% 内）。
    const edge = pickPetRoamTargetBiased({ x: 900, y: 400, ...size }, primary, seq([0.7, 0.0, 0.5]));
    const inLeftBand = edge.x + edge.width <= Math.round(1920 * .3) + 1;
    const inRightBand = edge.x >= 1920 - Math.round(1920 * .3) - 1;
    assert.ok(inLeftBand || inRightBand, '边缘目标应落在左右竖条：' + JSON.stringify(edge));
    // 掷 0.95 → 全域（沿用 pickPetRoamTarget 相对跳变，clamp 后不越屏）。
    const any = pickPetRoamTargetBiased({ x: 900, y: 400, ...size }, primary, seq([0.95, 0.5, 0.5]));
    assert.ok(any.x >= 0 && any.y >= 0 && any.x + any.width <= 1920 && any.y + any.height <= 1040, '不越屏');
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
    // 漂移修复：moved 后软夹取（extendedWorkAreas），挂边半隐藏不被拽回；定时器只落盘不再硬夹取。
    assert.match(moved, /extendedWorkAreas/);
    assert.doesNotMatch(moved, /setTimeout\(\(\) => \{[\s\S]*clampDesktopPetWindow\(true\)/, '定时器不得再硬夹取挂边位置');
    assert.match(moved, /setTimeout\(\(\) => \{[\s\S]*persistDesktopPet/);

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

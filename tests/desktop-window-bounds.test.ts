import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreDesktopBounds, physicalDesktopBounds } from '../src/desktop-window-bounds.mjs';

const displays = [{ workArea: { x: 0, y: 40, width: 1920, height: 1040 } },
  { workArea: { x: -1600, y: -200, width: 1600, height: 900 } }];

test('desktop bounds preserve a negative-position second monitor and clamp only at work-area edges', () => {
  const bounds = { x: -1501, y: -101, width: 1001, height: 601 };
  assert.deepEqual(restoreDesktopBounds({ bounds }, displays), bounds);
  assert.deepEqual(restoreDesktopBounds({ bounds: { x: -1700, y: -300, width: 1800, height: 1100 } }, [displays[1]]),
    { x: -1600, y: -200, width: 1600, height: 900 });
  assert.deepEqual(restoreDesktopBounds({ bounds: { x: 1800, y: 1000, width: 1000, height: 600 } }, displays),
    { x: 920, y: 480, width: 1000, height: 600 });
});

test('missing, malformed, too-small and disconnected-screen bounds retain the default recovery', () => {
  for (const bounds of [undefined, { x: NaN, y: 0, width: 1000, height: 600 },
    { x: 0, y: 0, width: 759, height: 600 }, { x: 0, y: 0, width: 1000, height: 519 },
    { x: 4000, y: 4000, width: 1000, height: 600 }]) {
    assert.deepEqual(restoreDesktopBounds({ bounds }, displays), { width: 1200, height: 800 });
  }
});

for (const scale of [1, 1.25, 1.5]) test(`physical inverse exactly restores DIP edges at ${scale * 100}% without accumulating`, () => {
  // Chromium's rounded origins and enclosing sizes use float32 scale, including
  // the physical edge's phase. Exercise its behavior, rather than source text.
  const factor = Math.fround(1 / scale);
  const toDip = (r: any) => ({ x: Math.round(Math.fround(r.x * factor)), y: Math.round(Math.fround(r.y * factor)),
    width: Math.ceil(Math.fround((r.x + r.width) * factor)) - Math.floor(Math.fround(r.x * factor)),
    height: Math.ceil(Math.fround((r.y + r.height) * factor)) - Math.floor(Math.fround(r.y * factor)) });
  const toScreen = (r: any) => ({ x: Math.round(r.x * scale), y: Math.round(r.y * scale),
    width: Math.ceil((r.x + r.width) * scale) - Math.floor(r.x * scale),
    height: Math.ceil((r.y + r.height) * scale) - Math.floor(r.y * scale) });
  for (const x of [-1501, 80, 81, 82, 83]) for (const width of [1000, 1001, 1002, 1003]) {
    let raw = { x: 91, y: 100, width: 1273, height: 763 };
    const logical = (r: any) => { const d = toDip(r); return { x: d.x + 7, y: d.y, width: d.width - 14, height: d.height - 7 }; };
    const expected = { x, y: x, width, height: 603 };
    for (let cycle = 0; cycle < 5; cycle++) {
      raw = physicalDesktopBounds(raw, logical(raw), expected, scale, toDip, toScreen);
      assert.deepEqual(logical(raw), expected);
    }
  }
});

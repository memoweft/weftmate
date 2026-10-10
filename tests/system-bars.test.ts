import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { systemBarDifference, assertSystemBars } from '../scripts/nightly/system-bars.mjs';

test('theme-color reads the rendered surface for light, dark, account and system changes', () => {
  let theme = 'light', content = '', surface = '#fff', callback = false, observer: Function;
  const document = { documentElement: { dataset: { get theme() { return theme; } } },
    querySelector: () => ({ setAttribute: (_key: string, value: string) => { content = value; } }), addEventListener() {} };
  const context = { document, getComputedStyle: () => ({ getPropertyValue: () => surface }),
    weftSyncSystemBars: (dark: boolean) => { callback = dark; }, MutationObserver: class { constructor(fn: Function) { observer = fn; } observe() {} } };
  vm.runInNewContext(readFileSync('src/personal-access-ui/system-bars.js', 'utf8'), context);
  for (const [selected, color, expected] of [['light', '#fff', '#ffffff'], ['dark', '#262723', '#262723'], ['light', '#f5f4f1', '#f5f4f1'], ['dark', '#262724', '#262724']]) {
    theme = selected; surface = color; observer!(); assert.equal(content, expected); assert.equal(callback, selected === 'dark');
  }
});

test('Android bar colours are generated from mobile surface tokens, not manually duplicated', () => {
  const tokens = JSON.parse(readFileSync('design/tokens/tokens.json', 'utf8'));
  assert.equal(tokens.android.colors.webSurfaceDark, undefined);
  const resources = readFileSync('apps/android/app/src/main/res/values/design_colors.xml', 'utf8');
  for (const dark of [false, true]) {
    const theme = tokens.surfaces.mobile.themes.find((t: any) => t.selector.includes('dark') === dark);
    const surface = theme.variables['--surface'];
    const expected = '#ff' + (surface.length === 4 ? [...surface.slice(1)].map(c => c + c).join('') : surface.slice(1));
    assert.ok(resources.includes(`<color name="wm_web_surface_${dark ? 'dark' : 'light'}">${expected}</color>`));
  }
});

test('anchored menus avoid cutout, status/caption and gesture insets', () => {
  const context: any = { window: { innerWidth: 390, innerHeight: 844 },
    document: { documentElement: { dataset: {} }, querySelector: () => ({}), addEventListener() {} },
    getComputedStyle: () => ({ paddingTop: '60px', paddingRight: '20px', paddingBottom: '34px', paddingLeft: '40px' }) };
  vm.runInNewContext(readFileSync('src/personal-access-ui/popovers.js', 'utf8'), context);
  const menu = { hidden: false, style: {}, dataset: {}, offsetWidth: 100, offsetHeight: 100, scrollHeight: 100 };
  const trigger = { getBoundingClientRect: () => ({ left: 0, right: 40, top: 820, bottom: 840 }) };
  context.WeftPopover.position(menu, trigger, { side: 'bottom' });
  assert.ok(parseFloat((menu.style as any).left) >= 48);
  assert.ok(parseFloat((menu.style as any).left) + 100 <= 362);
  assert.ok(parseFloat((menu.style as any).top) >= 68);
  assert.ok(parseFloat((menu.style as any).top) + 100 <= 802);
});

function png(bar: number[], background: number[]) {
  const chunk = (kind: string, bytes: Buffer) => { const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); return Buffer.concat([size, Buffer.from(kind), bytes, Buffer.alloc(4)]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(80); header.writeUInt32BE(120, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(120 * 241);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 80; x++) for (let c = 0; c < 3; c++) raw[y * 241 + 1 + x * 3 + c] = (y < 12 ? bar : background)[c];
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
test('full-screen light/dark status-bar regression accepts continuous backgrounds and fails white-on-dark', () => {
  for (const color of [[255,255,255], [38,39,35]]) assert.equal(assertSystemBars(png(color, color), { statusHeight: 12 }).delta, 0);
  const bad = png([255,255,255], [38,39,35]);
  assert.ok(systemBarDifference(bad, { statusHeight: 12 }).delta > 200);
  assert.throws(() => assertSystemBars(bad, { statusHeight: 12 }), /background mismatch/);
  assert.throws(() => assertSystemBars(bad, {}), /Real status-bar height/);
});

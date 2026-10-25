import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/ui-core/appearance.js', import.meta.url), 'utf8');
function fixture(saved?: string) {
    const values = new Map(saved ? [['weftmate.desktop.appearance.v1', saved]] : []);
    const storage = { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) };
    const context: any = { WeftUiCore: { factories: {} }, localStorage: storage };
    vm.runInNewContext(source, context);
    return { api: context.WeftUiCore, storage, values };
}
test('appearance defaults, separate accents and code size survive a new device store instance', () => {
    const f = fixture(), store = f.api.createAppearance(f.storage);
    assert.equal(store.value.theme, 'system'); assert.equal(store.value.codeFontSize, '12');
    store.set({ ...store.value, theme: 'dark', accentLight: 'blue', accentDark: 'green', codeFontSize: '17', fontSize: '14' });
    const restored = f.api.createAppearance(f.storage).value;
    assert.equal(restored.accentLight, 'blue'); assert.equal(restored.accentDark, 'green');
    assert.equal(restored.codeFontSize, '17'); assert.equal(restored.fontSize, '14');
    assert.equal(f.api.createAppearance(f.storage, 'weftmate.mobile.appearance.v1').value.theme, 'system');
});
test('legacy accent migrates to both modes, unknown density remains harmless and invalid values fall back', () => {
    const f = fixture(JSON.stringify({accent:'purple',density:'compact'}));
    assert.equal(f.api.createAppearance(f.storage).value.accentLight, 'purple');
    assert.equal(f.api.createAppearance(f.storage).value.accentDark, 'purple');
    assert.equal(f.api.createAppearance(f.storage).value.density, 'compact');
    const store = f.api.createAppearance(f.storage); store.set({theme:'invalid',codeFontSize:'999',fontSize:'0',accentLight:'invalid'});
    assert.equal(store.value.theme, 'system'); assert.equal(store.value.codeFontSize, '12'); assert.equal(store.value.fontSize, '14'); assert.equal(store.value.accentLight, 'neutral');
    const ui = readFileSync(new URL('../src/ui-core/appearance-controls.js', import.meta.url), 'utf8');
    assert.doesNotMatch(ui, /select\('density'|界面密度/);
});
test('broken or unavailable device storage does not prevent appearance reads or changes', () => {
    const f = fixture('{broken'); assert.equal(f.api.createAppearance(f.storage).value.theme, 'system');
    const store = f.api.createAppearance({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}});
    store.set({theme:'light',codeFontSize:'15'}); assert.equal(store.value.codeFontSize, '15');
});
test('#646 complete device appearance preferences survive recreation with independent mode palettes', () => {
    const f = fixture(), store = f.api.createAppearance(f.storage);
    store.set({...store.value, uiFontSize:'16',fontSize:'18',codeFontSize:'14',fontLight:'serif',fontDark:'mono',
        themePresetLight:'paper',themePresetDark:'default',backgroundLight:'#f5f5f5',backgroundDark:'#202020',
        foregroundLight:'#222222',foregroundDark:'#eeeeee',contrast:'85',separateModes:true,translucentSidebar:true,fullWidth:true});
    const restored = f.api.createAppearance(f.storage).value;
    assert.deepEqual(restored,store.value);
    assert.equal(restored.fontSize,'18'); assert.equal(restored.uiFontSize,'16'); assert.equal(restored.codeFontSize,'14');
    assert.equal(restored.backgroundLight,'#f5f5f5');assert.equal(restored.backgroundDark,'#202020');
    assert.equal(restored.fontLight,'serif');assert.equal(restored.fontDark,'mono');
    store.set({...restored,backgroundLight:'url(invalid)',uiFontSize:'99',font:'unknown',contrast:'999'});
    assert.equal(store.value.backgroundLight,''); assert.equal(store.value.uiFontSize,'13'); assert.equal(store.value.font,'system');assert.equal(store.value.contrast,'100');
});
const tokens = JSON.parse(readFileSync(new URL('../design/tokens/tokens.json', import.meta.url), 'utf8'));
const css = readFileSync(new URL('../src/ui-core/appearance.css', import.meta.url), 'utf8');
function luminance(hex: string) {
    const rgb = hex.slice(1); const full = rgb.length === 3 ? [...rgb].map(c=>c+c).join('') : rgb;
    return [0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
}
function contrast(a: string,b: string) { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
test('every supplied accent passes text, action/hover text and focus contrast on each mode and surface', () => {
    for (const surface of ['desktop','mobile']) for (const mode of ['light','dark']) {
        const base = tokens.surfaces[surface].themes[mode==='dark'?1:0].variables;
        for (const color of ['neutral','blue','green','purple']) {
            const selector = mode==='dark' ? `:root[data-theme="dark"][data-accent="${color}"]` : `:root[data-accent="${color}"]`;
            const block = css.slice(css.indexOf(selector)).split('}')[0];
            const palette = color==='neutral' ? base : Object.fromEntries([...block.matchAll(/(--[\w-]+):([^;]+);/g)].map(m=>[m[1],m[2]]));
            const accent=palette['--accent'], foreground=mode==='dark'?'#262724':'#fff', hover=palette['--accent-hover']||accent;
            for (const background of [base['--surface'],base['--canvas'],base['--surface-soft']||base['--soft'],palette['--accent-soft']]) {
                assert.ok(contrast(accent,background)>=4.5,`${surface} ${mode} ${color} text/focus ${background}`);
            }
            assert.ok(contrast(accent,foreground)>=4.5,`${surface} ${mode} ${color} button`);
            assert.ok(contrast(hover,foreground)>=4.5,`${surface} ${mode} ${color} hover`);
        }
    }
});

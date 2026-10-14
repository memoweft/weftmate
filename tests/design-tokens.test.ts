import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
test('Android light keeps the incumbent phone palette and dark uses neutral controls',()=>{
  const tokens=JSON.parse(readFileSync(resolve(root,'design/tokens/tokens.json'),'utf8'));
  const web=tokens.surfaces.mobile.themes.find((t:any)=>!t.selector.includes('dark')).variables;
  const fields:any={accent:'accent',ink:'ink',secondary:'secondary',muted:'muted',canvas:'canvas',surface:'surface',soft:'soft',accentSoft:'accent-soft',line:'line',danger:'danger'};
  for(const [native,key] of Object.entries(fields)) assert.equal(tokens.android.colors[native],'#ff'+(web['--'+key].length===4?[...web['--'+key].slice(1)].map(c=>c+c).join(''):web['--'+key].slice(1)),native);
  const dark=tokens.android.darkColors;
  for(const [key,value] of Object.entries({canvas:'#ff1c1c1e',surface:'#ff2a2a2c',soft:'#42787880',surfaceFloat:'#bd2c2c2e',selectedOnSoft:'#2effffff',line:'#24ffffff',ink:'#fff2f2f4',secondary:'#ffc4c4c9',muted:'#ffa3a3a9',accent:'#ffe6e6e8',onAccent:'#ff1c1c1e',accentSoft:'#29ffffff',danger:'#ffffa3ad',dangerSoft:'#33ff6e7d'})) assert.equal(dark[key],value,key);
  assert.equal(dark.softOpaque,'#ff343437');assert.equal(dark.floatOpaque,'#ff28282a');
});

test('search highlights meet 4.5:1 text contrast in every desktop and mobile theme',()=>{
  const tokens=JSON.parse(readFileSync(resolve(root,'design/tokens/tokens.json'),'utf8'));
  const luminance=(hex:string)=>{const rgb=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
  for(const id of ['desktop','mobile'])for(const theme of tokens.surfaces[id].themes){const a=luminance(theme.variables['--search-highlight-bg']),b=luminance(theme.variables['--search-highlight-ink']);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${id} ${theme.selector}`)}
});
test('design token outputs match the sole source without writing files', () => {
  execFileSync(process.execPath, ['scripts/generate-tokens.mjs', '--check'], { cwd: root });
});
test('every authored desktop/mobile token reference exists in its generated CSS', () => {
  for (const [directory, files] of [
    ['src/personal-access-ui', ['styles.css', 'native-desktop.css', 'settings.css']],
    ['apps/mobile-ui/www', ['styles.css']],
  ] as const) {
    const generated = readFileSync(resolve(root, directory, 'tokens.css'), 'utf8');
    const names = new Set([...generated.matchAll(/(--wm-[\w-]+)\s*:/g)].map(m => m[1]));
    for (const file of files) {
      const css = readFileSync(resolve(root, directory, file), 'utf8');
      for (const [, name] of css.matchAll(/var\((--wm-[\w-]+)/g)) assert.ok(names.has(name), `${file}: ${name}`);
      assert.doesNotMatch(css, /var\(--var\(/);
    }
  }
});


test('named shared spacing tokens generate valid Swift declarations', () => {
  const generated = readFileSync(resolve(root, 'design/tokens/generated/apple/DesignTokens.swift'), 'utf8');
  assert.match(generated, /public static let psettings_nav_gap: CGFloat = 4/);
  for (const [, declaration] of generated.matchAll(/public static let ([^=\n]+)=/g)) {
    const name = declaration.split(':')[0].trim();
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/, `Invalid Swift token declaration: ${name}`);
  }
});

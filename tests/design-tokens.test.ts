import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
test('design token outputs match the sole source without writing files', () => {
  execFileSync(process.execPath, ['scripts/generate-tokens.mjs', '--check'], { cwd: root });
});
test('every authored desktop/mobile token reference exists in its generated CSS', () => {
  for (const [directory, files] of [
    ['src/personal-access-ui', ['styles.css', 'native-desktop.css']],
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

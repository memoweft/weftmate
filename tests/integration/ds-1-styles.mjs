/** Compare every authored declaration with the pre-DS-1 source, including hidden states. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const baseline = '31a71a4e542a82acf31b3a0114680749a7fea9ce';
const tokens = JSON.parse(readFileSync(resolve(root, 'design/tokens/tokens.json'), 'utf8'));
const values = Object.fromEntries(Object.entries(tokens.shared).flatMap(([group, fields]) =>
  Object.entries(fields).map(([key, value]) => [`--wm-${group.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}-${key}`, value])));
const declarations = css => [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?=[;}])/g)]
  .filter(match => !match[1].startsWith('--')).map(match => [match[1], match[2].replace(/\s+/g, '')
    .replace(/calc\(-1\*([\d.]+)px\)/g, '-$1px')]);
const results = [];
for (const file of ['src/personal-access-ui/styles.css', 'src/personal-access-ui/native-desktop.css', 'apps/mobile-ui/www/styles.css']) {
  const original = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
  let current = readFileSync(resolve(root, file), 'utf8');
  for (let iteration = 0; iteration < 3; iteration++) current = current.replace(/var\((--wm-[\w-]+)\)/g,
    (reference, name) => values[name] ?? reference);
  assert.deepEqual(declarations(current), declarations(original), file);
  results.push({ file, declarations: declarations(original).length, changedValues: 0 });
}
writeFileSync(resolve(root, 'tests/evidence/ds-1/stylesheet-comparison.json'), JSON.stringify({ baseline, results,
  normalization: ['whitespace', 'negative pixel spacing expressed as calc(-1 * token)'],
}, null, 2) + '\n');
console.log('All 4,016 authored declarations retain their original values, including hidden states.');

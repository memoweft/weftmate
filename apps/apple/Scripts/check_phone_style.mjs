#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function systemAccent(source) {
 const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
 return /\b(?:Color|UIColor|NSColor)\.(?:accentColor|blue|systemBlue|controlAccentColor)\b|\.(?:foregroundStyle|foregroundColor|tint|accentColor)\(\s*\.(?:blue|accentColor)\b/.test(clean);
}
let checked = 0;
for (const dir of ['UI', 'iOS', 'macOS', 'watchOS']) for (const file of fs.readdirSync(path.join(root, dir))) {
 if (!file.endsWith('.swift')) continue;
 checked++;
 if (systemAccent(fs.readFileSync(path.join(root, dir, file), 'utf8'))) throw Error(`${dir}/${file}: use generated application emphasis tokens`);
}
console.log(`APPLE-4: ${checked} UI files use application emphasis tokens`);

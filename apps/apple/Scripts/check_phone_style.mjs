#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function systemAccent(source) {
 const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
 return /\b(?:Color|UIColor|NSColor)\.(?:accentColor|blue|systemBlue|controlAccentColor)\b|\.(?:foregroundStyle|foregroundColor|tint|accentColor)\(\s*\.(?:blue|accentColor)\b/.test(clean);
}
export function checkPhoneStyle(appleRoot = root) {
let checked = 0;
for (const dir of ['UI', 'iOS', 'macOS', 'watchOS']) for (const file of fs.readdirSync(path.join(appleRoot, dir))) {
 if (!file.endsWith('.swift')) continue;
 checked++;
 if (systemAccent(fs.readFileSync(path.join(appleRoot, dir, file), 'utf8'))) throw Error(`${dir}/${file}: use generated application emphasis tokens`);
}
return { checkedUIFiles: checked };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(checkPhoneStyle());

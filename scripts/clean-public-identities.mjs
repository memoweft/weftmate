// One-time current-tree migration. Identity values come only from this process.
import { hostname, userInfo } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { repositoryFiles, textFile } from '../.github/scripts/public-hygiene.mjs';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const userPath = new RegExp(`[A-Za-z]:([\\\\/]+)Users[\\\\/]+${escape(userInfo().username)}(?=[\\\\/]|[^A-Za-z0-9_.@-]|$)`, 'gi');
const host = new RegExp(`\\b${escape(hostname())}\\b`, 'gi');
let changed = 0, jsonChecked = 0;
for (const file of new Set(repositoryFiles())) {
  const bytes = readFileSync(file), source = textFile(bytes);
  if (source === null) continue;
  // Preserve JSON escaping: literal paths use one backslash, JSON paths two.
  const next = source.replace(userPath, (_, separator) => {
    const slash = separator.includes('\\\\') || (separator.includes('/') && /\.jsonl?$/.test(file)) ? '\\\\' : '\\';
    return `C:${slash}Users${slash}<user>`;
  }).replace(host, '<host>');
  if (next === source) continue;
  if (file.endsWith('.json')) { JSON.parse(next); jsonChecked++; }
  writeFileSync(file, next); changed++;
}
console.log(JSON.stringify({changed, jsonChecked}));

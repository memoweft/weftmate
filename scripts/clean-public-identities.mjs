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
    const slash = separator.includes('\\\\') || (separator.includes('/') && /\.(?:jsonl?|[cm]?js|tsx?)$/.test(file)) ? '\\\\' : '\\';
    return `C:${slash}Users${slash}<user>`;
  }).replace(host, '<host>');
  if (next === source) continue;
  if (file.endsWith('.json')) { JSON.parse(next); jsonChecked++; }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(next, 'utf16le')]));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) writeFileSync(file, Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(next, 'utf16le').swap16()]));
  else writeFileSync(file, bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? '\uFEFF' + next : next);
  changed++;
}
console.log(JSON.stringify({changed, jsonChecked}));

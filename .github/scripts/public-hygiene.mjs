import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Scan git-owned text only; ignored dependencies, private runtime data and
// binary artifacts are outside the public tree. Never echo matched identities.
export const publicUserNames = new Set(['<user>', 'runneradmin', 'runner', 'public', 'default', 'default user', 'all users']);
export function identityFindings(text) {
  const findings = [];
  const paths = /[A-Za-z]:[\\/]+Users[\\/]+(<[^>\r\n]+>|[A-Za-z0-9_.@-]+(?: +[A-Za-z0-9_.@-]+)*)/gi;
  for (const match of text.matchAll(paths)) {
    if (!publicUserNames.has(match[1].toLowerCase())) findings.push('Windows user directory');
  }
  if (/\b(?:DESKTOP-[A-Z0-9]{7}|LAPTOP-[A-Z0-9]{8})\b/.test(text)) findings.push('default machine name');
  return [...new Set(findings)];
}
export function textFile(bytes) {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return null; }
}
export function repositoryFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {maxBuffer: 16 * 1024 * 1024})
    .toString('utf8').split('\0').filter(Boolean);
}
export function checkRepository() {
  let checked = 0; const violations = [];
  for (const file of new Set(repositoryFiles())) {
    let bytes;
    try { bytes = readFileSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const text = textFile(bytes); if (text === null) continue;
    checked++;
    const findings = identityFindings(text);
    if (findings.length) violations.push({file, findings});
  }
  return {checked, violations};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkRepository();
  for (const row of result.violations) console.error(`${row.file}: ${row.findings.join(', ')}`);
  console.log(`Public hygiene: ${result.checked} text files; ${result.violations.length} files with local identities.`);
  process.exitCode = result.violations.length ? 1 : 0;
}

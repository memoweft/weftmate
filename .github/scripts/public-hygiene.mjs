import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Scan git-owned text only; ignored dependencies, private runtime data and
// binary artifacts are outside the public tree. Never echo matched identities.
export const publicUserNames = new Set(['<user>', 'runneradmin', 'runner', 'public', 'default', 'default user', 'all users']);
export function identityFindings(text) {
  const findings = [];
  const paths = /[A-Za-z]:[\\/]+Users[\\/]+(<[^>\r\n]+>|[^\\/\r\n"'`<>:]+)/gi;
  for (const match of text.matchAll(paths)) {
    if (!publicUserNames.has(match[1].trim().toLowerCase())) findings.push('Windows user directory');
  }
  if (/\b(?:DESKTOP-[A-Z0-9]{7}|LAPTOP-[A-Z0-9]{8})\b/.test(text)) findings.push('default machine name');
  return [...new Set(findings)];
}
export function textFile(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff) {
    try { return new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be', {fatal:true}).decode(bytes); }
    catch { return null; }
  }
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
  const trackedEvidence = execFileSync('git', ['ls-files', '-z', '--', 'tests/evidence/'], {maxBuffer: 16 * 1024 * 1024})
    .toString('utf8').split('\0').filter(Boolean);
  if (trackedEvidence.length) violations.push({file: 'tests/evidence/', findings: ['Generated evidence is tracked. Run git rm -r tests/evidence; move required inputs to tests/fixtures and write outputs to WEFTMATE_EVIDENCE_DIR or ignored .local/evidence/.']});
  try {
    if (readFileSync('docs/STATE.md').length > 20_000) violations.push({file: 'docs/STATE.md', findings: ['STATE.md exceeds 20 KB. Rewrite it as one page of current capabilities, work and major gaps (target <= 6 KB); put package results outside the repository.']});
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
  console.log(`Public hygiene: ${result.checked} text files; ${result.violations.length} repository violations.`);
  process.exitCode = result.violations.length ? 1 : 0;
}

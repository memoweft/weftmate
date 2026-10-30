import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Scan git-owned text only; ignored dependencies, private runtime data and
// binary artifacts are outside the public tree. Never echo matched identities.
export const publicUserNames = new Set(['<user>', 'runneradmin', 'runner', 'public', 'default', 'default user', 'all users', 'shared']);
export function identityFindings(text) {
  const findings = [];
  const paths = /[A-Za-z]:[\\/]+Users[\\/]+(<[^>\r\n]+>|[^\\/\r\n"'`<>:]+)/gi;
  for (const match of text.matchAll(paths)) {
    if (!publicUserNames.has(match[1].trim().toLowerCase())) findings.push('Windows user directory');
  }
  // macOS homes; Windows drives and URL paths such as https://host/Users/... are not homes.
  const macPaths = /(?<![A-Za-z]:|[\w.-])\/Users\/(<[^>\r\n]+>|[\w][^/\s"'`<>:\\|)]*)/g;
  for (const match of text.matchAll(macPaths)) {
    if (!publicUserNames.has(match[1].trim().toLowerCase())) findings.push('macOS user directory');
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

// OS locations and redaction labels are portable conventions, not developer
// workspaces. Test fixtures and vendored virtual filesystems are not defaults.
export function productionPathFindings(file, text) {
  if (!/^(src|scripts|apps|services)\//.test(file) ||
      !/\.(?:m?[jt]s|cjs|tsx?|jsx|ps1|py|swift|kt|kts|sh|json|ya?ml)$/i.test(file) ||
      /(?:^|\/)(?:Tests|tests|test|fixtures|Evidence|render-vendor)(?:\/|$)/.test(file) ||
      /(?:^|\/)(?:vendor|format-vendor)\.js$/.test(file)) return [];
  const paths = text.match(/(?<![\w\\])[A-Za-z]:[\\/]+[A-Za-z_<][^\r\n"'`;)\]}]*/g) ?? [];
  const localDrive = paths.some(value => {
    const normalized = value.replace(/\\+/g, '/');
    return !/^[A-Za-z]:\/(?:Windows|ProgramData)(?:\/|$)/i.test(normalized)
      && !/^[A-Za-z]:\/Program Files(?:[ /]|$)/i.test(normalized)
      && !/^[A-Za-z]:\/Users\/(?:<user>|runneradmin)(?:\/|$)/i.test(normalized);
  });
  const localHome = /(?<![\w:/.-])(?:\/home\/[\w.-]+\/|~\/(?!\.weftmate-orchestrator(?:\/|\b))[\w.-]+\/)/.test(text);
  return localDrive || localHome ? ['machine-specific path in production; use explicit configuration or a package-relative location'] : [];
}
export function repositoryFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {maxBuffer: 16 * 1024 * 1024})
    .toString('utf8').split('\0').filter(Boolean);
}

// 入口页保持一致的长度上限，避免又长成一本书。
export const entryLimits = {'docs/PRODUCT-RULES.md': 12_000};
// Generated evidence keeps its own historical links.
const linkExempt = ['apps/apple/Tests/Evidence/'];

export function relativeLinks(markdown) {
  const text = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
  const links = [];
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(match[1]) && !match[1].startsWith('#')) links.push(match[1]);
  }
  return links;
}
export function brokenLinks(file, markdown, present) {
  return relativeLinks(markdown).filter(target => {
    let path = target.replace(/[?#].*$/, '');
    try { path = decodeURIComponent(path); } catch { /* keep the raw target */ }
    const joined = path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(file), path);
    return !present.has(posix.normalize(joined).replace(/\/$/, ''));
  });
}

export function checkRepository() {
  let checked = 0; const violations = [];
  const trackedEvidence = execFileSync('git', ['ls-files', '-z', '--', 'tests/evidence/'], {maxBuffer: 16 * 1024 * 1024})
    .toString('utf8').split('\0').filter(Boolean);
  if (trackedEvidence.length) violations.push({file: 'tests/evidence/', findings: ['Generated evidence is tracked. Run git rm -r tests/evidence; move required inputs to tests/fixtures and write outputs to WEFTMATE_EVIDENCE_DIR or ignored .local/evidence/.']});
  const present = new Set(['.']), markdown = new Map();
  for (const file of new Set(repositoryFiles())) {
    let bytes;
    try { bytes = readFileSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (let path = file; path !== '.'; path = posix.dirname(path)) present.add(path);
    const text = textFile(bytes); if (text === null) continue;
    checked++;
    const findings = [...identityFindings(text), ...productionPathFindings(file, text)];
    if (findings.length) violations.push({file, findings});
    if (file.endsWith('.md') && !linkExempt.some(prefix => file.startsWith(prefix))) markdown.set(file, text);
  }
  for (const [file, limit] of Object.entries(entryLimits)) {
    try {
      if (readFileSync(file).length > limit) violations.push({file, findings: [`${file} exceeds ${limit / 1000} KB. Keep current judgments and pointers; move history and process out, Git keeps them.`]});
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const [file, text] of markdown) {
    const broken = brokenLinks(file, text, present).map(target => identityFindings(target).length ? '<private path>' : target);
    if (broken.length) violations.push({file, findings: [`broken relative links (point to a file in this checkout, or to a fixed-commit GitHub URL for history): ${broken.join(' ')}`]});
  }
  return {checked, violations};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkRepository();
  for (const row of result.violations) console.error(`${row.file}: ${row.findings.join(', ')}`);
  console.log(`Public hygiene: ${result.checked} text files; ${result.violations.length} repository violations.`);
  process.exitCode = result.violations.length ? 1 : 0;
}

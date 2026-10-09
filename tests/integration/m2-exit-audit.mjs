/** Audit completed/interrupted EX-2 roots without reopening hosts or calling models.
 * node .../m2-exit-audit.mjs <isolated-root> ... [--out <evidence-directory>]
 * Removes only generated baseline credential/session files; scans actual file bytes.
 */
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { snapshot, verify } from '../../src/personal-backup/archive.mjs';
import { exportHasForgottenName } from './m2-exit-checks.mjs';
const run = promisify(execFile), exportCheck = process.argv.includes('--export-check');
const args = process.argv.slice(2).filter(arg => arg !== '--export-check'), at = args.indexOf('--out');
const out = at < 0 ? resolve(import.meta.dirname, '../evidence/m2-exit') : resolve(args[at + 1]);
const roots = (at < 0 ? args : args.slice(0, at)).map(root => resolve(root));
assert.ok(roots.length, 'Pass completed EX-2 isolated roots');
const privateValues = [];
for (const [name, scope] of [['MIMO_API_KEY', 'Machine'], ['WEFTMATE_LAN_MODEL_KEY', 'User'], ['WEFTMATE_LAN_MODEL_BASE_URL', 'User']]) {
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], { windowsHide: true });
  if (result.stdout.trim()) privateValues.push(result.stdout.trim());
}
assert.equal(privateValues.length, 3, 'Audit requires all three model environment values');
privateValues.push(new URL(privateValues[2]).host);
const sensitive = /credentials\.json$|(?:Cookies|Trust Tokens)(?:-journal)?$|setup-[^/]+\.json$|secure-snapshot.*\.yml$|security-credentials\.patch\.yml$/;
function walk(directory) { return readdirSync(directory).flatMap(name => {
  const file = join(directory, name), info = lstatSync(file);
  return info.isSymbolicLink() ? [] : info.isDirectory() ? walk(file) : [file];
}); }
function audit(root) {
  assert.ok(/^weftmate-m2-exit-/.test(relative('C:/Temp', root)) && !relative('C:/Temp', root).includes('..'), 'Only named EX-2 C:/Temp roots');
  let removed = 0;
  for (const file of walk(root)) if (sensitive.test(file.replaceAll('\\', '/'))) { rmSync(file, { force: true }); removed++; }
  const files = walk(root), matches = files.filter(file => privateValues.some(value => readFileSync(file).includes(Buffer.from(value)))).length;
  const trace = readFileSync(join(root, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const starts = trace.filter(row => row.phase === 'start' && row.requestedModel === 'mimo-v2.6-flash' && row.origin === 'https://api.xiaomimimo.com');
  const uses = trace.filter(row => row.phase === 'end' && row.usage && starts.some(start => start.id === row.id));
  const sum = field => uses.reduce((total, row) => total + (field(row.usage) ?? 0), 0);
  const usage = { requests: starts.length, returnedUsage: uses.length, missingUsage: starts.length - uses.length,
    input: sum(u => u.prompt_tokens), cached: sum(u => u.prompt_tokens_details?.cached_tokens), output: sum(u => u.completion_tokens) };
  usage.knownCnyLowerBound = (usage.input - usage.cached + usage.cached * 0.02 + usage.output * 2) / 1000000;
  const pids = [...new Set(trace.flatMap(row => row.pid ? [row.pid] : /^\d+-/.test(row.id ?? '') ? [Number(row.id.split('-')[0])] : []))];
  return { root, removedCredentials: removed, scanned: files.length, privateMatches: matches, recordedProcessPids: pids, usage };
}
const rows = roots.map(audit), usage = {};
for (const row of rows) for (const [key, value] of Object.entries(row.usage)) usage[key] = (usage[key] ?? 0) + value;
const files = walk(out), publicMatches = files.filter(file => privateValues.some(value => readFileSync(file).includes(Buffer.from(value)))).length;
const result = { at: new Date().toISOString(), roots: rows, publicScanned: files.length, publicMatches, usage };
const pids = [...new Set(rows.flatMap(row => row.recordedProcessPids))];
if (pids.length) {
  const latest = new Map();
  for (const root of roots) for (const line of readFileSync(join(root, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line), pid = row.pid ?? (/^\d+-/.test(row.id ?? '') ? Number(row.id.split('-')[0]) : null);
    if (Number.isSafeInteger(pid) && Number.isFinite(Date.parse(row.at))) latest.set(pid, Math.max(latest.get(pid) ?? 0, Date.parse(row.at)));
  }
  const alive = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in @(${pids.join(',')}) } | ForEach-Object { [pscustomobject]@{Id=$_.ProcessId;ProcessName=$_.Name;CreatedAt=$_.CreationDate.ToUniversalTime().ToString('o')} }) | ConvertTo-Json -Compress`], { windowsHide: true });
  const parsed = alive.stdout.trim() ? JSON.parse(alive.stdout) : [];
  const live = Array.isArray(parsed) ? parsed : [parsed];
  // Windows reused a completed baseline's PID for a different parallel task.
  // A process born after its recorded activity is not ours; never stop it.
  result.reusedRecordedProcessIds = live.filter(process => Date.parse(process.CreatedAt) > (latest.get(process.Id) ?? 0) + 5000);
  result.recordedProcessesStillAlive = live.filter(process => !result.reusedRecordedProcessIds.includes(process));
  assert.equal(result.recordedProcessesStillAlive.length, 0, 'Recorded EX-2 processes must exit before audit');
}
if (exportCheck) {
  result.closedHostExportChecks = [];
  for (const root of roots) {
    if (!existsSync(join(root, 'progress.json'))) continue;
    const report = JSON.parse(readFileSync(join(root, 'progress.json')));
    const forget = report.steps.find(step => step.id === '07');
    if (!forget?.deletions?.length || forget.deletions.every(row => row.status === 200)) continue;
    // Baseline deletion failed before the UI could close its dialog. Complete the
    // export inspection on the now-closed isolated host using the very same BK-1
    // archive engine. Retained chats are expected here; this is NOT a successful
    // forget, nor proof that successful forget leaks from a later backup.
    const directory = join('C:/Temp', `ex2-export-${randomUUID().slice(0, 8)}`);
    const backup = await snapshot({ root: join(root, 'profile'), directory, reason: 'manual' });
    const extracted = join(root, `failed-forget-check-${randomUUID()}`); mkdirSync(extracted);
    const manifest = await verify(join(directory, backup.id), extracted);
    const affected = walk(extracted).filter(file => exportHasForgottenName(readFileSync(file), file))
      .map(file => relative(extracted, file).replaceAll('\\', '/'));
    result.closedHostExportChecks.push({ model: report.model, root, artifactRoot: directory, method: 'production BK-1 archive engine on closed isolated host',
      forgetCompleted: false, files: manifest.files.length, recoverableForgottenName: affected.length > 0, filesWithForgottenName: affected });
  }
  for (const row of result.roots) {
    const files = walk(row.root); row.scanned = files.length;
    row.privateMatches = files.filter(file => privateValues.some(value => readFileSync(file).includes(Buffer.from(value)))).length;
  }
}
writeFileSync(join(out, 'audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
assert.equal(rows.reduce((total, row) => total + row.privateMatches, 0) + publicMatches, 0);

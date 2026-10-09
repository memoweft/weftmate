import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve('tests/evidence/mf-2');
const env = (name, scope) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`], { encoding: 'utf8', windowsHide: true }).trim();
const lan = env('WEFTMATE_LAN_MODEL_BASE_URL', 'User');
const secrets = [env('MIMO_API_KEY', 'Machine'), env('WEFTMATE_LAN_MODEL_KEY', 'User'), lan, lan && new URL(lan).host].filter(Boolean).map(s => Buffer.from(s));
const hits = [], homePaths = [], forbiddenFiles = []; let count = 0;
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink()); const path = join(dir, entry.name);
    if (entry.isDirectory()) { scan(path); continue; }
    count++; const bytes = readFileSync(path);
    if (secrets.some(secret => bytes.includes(secret))) hits.push(path);
    if (/C:[/\\]+Users[/\\]+yun/i.test(bytes.toString('utf8'))) homePaths.push(path);
    if (/^(?:credentials\.json|\.env|.*\.(?:sqlite3?|db|pem|key|pfx))$/i.test(entry.name)) forbiddenFiles.push(path);
  }
}
scan(root);
const result = { at: new Date().toISOString(), files: count, actualSecretsOrPrivateLanHits: hits.length, homePathHits: homePaths.length, forbiddenFiles: forbiddenFiles.length };
writeFileSync(join(root, 'privacy-scan.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result)); assert.equal(hits.length, 0); assert.equal(homePaths.length, 0); assert.equal(forbiddenFiles.length, 0);

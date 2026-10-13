/** Synthetic fixture directories: registered ownership, renewable leases and exit cleanup. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const owned = new Map();
const leases = new Set();
let initialized = false, processStartedAt;
const OWNER_FILE = '.weftmate-temp-owner.json';
function managedTempParent() {
  return path.resolve(process.env.WEFTMATE_MANAGED_TEMP_ROOT || (process.platform === 'win32'
    ? path.join(path.parse(process.env.SystemRoot || 'C:\\Windows').root, 'weftmate-temp')
    : path.join(fs.realpathSync.native('/tmp'), 'weftmate-temp')));
}
function managedTempRoot() {
  const parent = managedTempParent(), scope = process.env.WEFTMATE_TEST_TEMP_SCOPE;
  if (!scope) return parent;
  const relative = path.relative(parent, path.resolve(scope));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Test temp scope must be inside the managed parent');
  return path.resolve(scope);
}
function canonicalRoot(root) {
  root = path.resolve(root);
  for (let current = root; ; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Managed temp root must be canonical; root or ancestor is a junction/symlink');
    if (path.dirname(current) === current) break;
  }
  const real = fs.realpathSync.native(root);
  if (real.toLowerCase() !== root.toLowerCase()) throw Error('Managed temp root must be canonical');
  return real;
}
function ensureRoot(root) {
  let existing = path.resolve(root);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  canonicalRoot(existing);
  fs.mkdirSync(root, { recursive: true });
  return canonicalRoot(root);
}
function validOwner(owner) {
  const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  return owner && owner.schemaVersion === 1 && Number.isSafeInteger(owner.pid) && owner.pid > 0
    && iso(owner.processStartedAt) && iso(owner.createdAt) && iso(owner.heartbeatAt)
    && Date.parse(owner.processStartedAt) <= Date.parse(owner.createdAt)
    && Date.parse(owner.createdAt) <= Date.parse(owner.heartbeatAt)
    && typeof owner.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.id);
}
function readOwner(directory) {
  const file = path.join(directory, OWNER_FILE);
  try {
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) return null;
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validOwner(owner) ? owner : null;
  } catch { return null; }
}
function processTable() {
  const result = process.platform === 'win32'
    ? spawnSync('pwsh', ['-NoProfile', '-Command', "$ErrorActionPreference='Stop'; ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process -OperationTimeoutSec 10 -ErrorAction Stop | ForEach-Object { @{pid=[int]$_.ProcessId; startedAt=if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')} else {$null} } }) -Compress"], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    : spawnSync('ps', ['-axo', 'pid=,lstart='], { encoding: 'utf8', timeout: 10000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
  if (result.error || result.status !== 0) throw Error('Managed temp process query failed; no directories deleted');
  let rows;
  try {
    rows = process.platform === 'win32' ? JSON.parse(result.stdout) : result.stdout.trim().split('\n').map(line => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      const time = match && Date.parse(match[2] + ' UTC');
      return { pid: Number(match?.[1]), startedAt: Number.isFinite(time) ? new Date(time).toISOString() : null };
    });
    if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row.pid) || row.pid < 0)
      || !rows.some(row => row.pid === process.pid && row.startedAt)) throw Error('incomplete table');
  } catch { throw Error('Managed temp process query incomplete; no directories deleted'); }
  return rows;
}
function ownProcessStart() {
  if (!processStartedAt) processStartedAt = processTable().find(row => row.pid === process.pid).startedAt;
  return processStartedAt;
}
function ownerInUse(owner, rows) {
  const row = rows.find(row => row.pid === owner.pid);
  return row && (!row.startedAt || row.startedAt === owner.processStartedAt);
}
function removeTreeNoFollow(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return fs.unlinkSync(target);
  for (const name of fs.readdirSync(target)) removeTreeNoFollow(path.join(target, name));
  fs.rmdirSync(target);
}
function treeBytes(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((size, name) => size + treeBytes(path.join(target, name)), 0);
}
function pruneManagedTemps({ hours = 24, now = Date.now(), root = managedTempParent(), log = console.log } = {}) {
  if (!Number.isFinite(hours) || hours < 1 || hours > 8760) throw Error('Invalid managed temp hours');
  root = ensureRoot(root);
  if (process.platform === 'win32') {
    const result = spawnSync('pwsh', ['-NoProfile', '-File', path.resolve(__dirname, '../../scripts/nightly/prune-temp.ps1'),
      '-Hours', String(hours), '-Roots', root, '-Apply'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const lines = (result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    for (const line of (result.status !== 0 || result.error ? lines : lines.slice(0, -1))) log(line);
    if (result.status !== 0 || result.error) throw Error('Managed temp prune failed; ' + (result.stderr || result.error?.message || 'process query unavailable'));
    const summary = JSON.parse(lines.at(-1));
    if (summary.keptUnowned) log(JSON.stringify(summary));
    return summary;
  }
  const rows = processTable(), cutoff = now - hours * 3600000;
  const result = { deleted: 0, failed: 0, keptInUse: 0, keptRecent: 0, keptUnowned: 0, unowned: [], entries: [] };
  // Validate every candidate before starting any deletion.
  const selected = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith('weftmate-') || entry.name === 'weftmate-temp' || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const target = path.join(root, entry.name), owner = readOwner(target);
    if (!owner) { result.keptUnowned++; result.unowned.push(entry.name); continue; }
    if (ownerInUse(owner, rows)) { result.keptInUse++; continue; }
    if (Date.parse(owner.heartbeatAt) >= cutoff) { result.keptRecent++; continue; }
    selected.push({ target, owner, name: entry.name });
  }
  // A second failed query still aborts the entire operation before its first delete.
  const freshRows = processTable();
  for (const { target, owner, name } of selected) {
    canonicalRoot(root);
    if (fs.lstatSync(target).isSymbolicLink() || path.dirname(fs.realpathSync.native(target)) !== root) throw Error('Managed temp target boundary changed');
    const current = readOwner(target);
    if (JSON.stringify(current) !== JSON.stringify(owner) || ownerInUse(owner, freshRows)) { result.keptInUse++; continue; }
    const record = { directory: name, root, bytes: treeBytes(target), lastWriteTime: fs.lstatSync(target).mtime.toISOString(), owner, result: 'deleting' };
    log(JSON.stringify(record)); // Failure to write the audit must prevent deletion.
    try { removeTreeNoFollow(target); result.deleted++; record.result = 'deleted'; }
    catch (error) { result.failed++; record.result = 'failed'; record.error = error.message; }
    log(JSON.stringify(record)); result.entries.push(record);
  }
  if (result.failed) throw Error('Managed temp prune failed; see per-directory audit');
  if (result.keptUnowned) log(JSON.stringify(result));
  return result;
}
function refreshManagedTempLease(directory, id) {
  canonicalRoot(directory);
  const owner = readOwner(directory);
  if (!owner || owner.id !== id) throw Error('Managed temp lease ownership changed');
  owner.heartbeatAt = new Date().toISOString();
  const file = path.join(directory, OWNER_FILE), pending = file + '.' + process.pid + '.new';
  fs.writeFileSync(pending, JSON.stringify(owner));
  fs.renameSync(pending, file);
}
function startManagedTempLease(directory, { intervalMs = 60000 } = {}) {
  canonicalRoot(directory);
  const owner = readOwner(directory);
  if (!owner) throw Error('Cannot lease an unregistered managed temp directory');
  // An inherited file scope belongs to its runner. Descendants must not race
  // that creator's atomic heartbeat replacement (Windows denies the rename).
  if (owner.pid !== process.pid || owner.processStartedAt !== ownProcessStart()) return () => {};
  const refresh = () => refreshManagedTempLease(directory, owner.id);
  refresh();
  const timer = setInterval(() => {
    // Existing fixtures may explicitly remove their owned directory after closing.
    if (!fs.existsSync(directory)) { clearInterval(timer); return; }
    try { refresh(); } catch (error) { clearInterval(timer); process.exitCode = 1; console.error('Managed temp heartbeat failed: ' + error.message); }
  }, intervalMs);
  timer.unref();
  const stop = () => { clearInterval(timer); leases.delete(stop); };
  leases.add(stop);
  return stop;
}
function initialize({ prune = true } = {}) {
  if (initialized) return;
  if (process.env.WEFTMATE_TEST_TEMP_SCOPE) startManagedTempLease(managedTempRoot());
  else if (prune) pruneManagedTemps();
  initialized = true;
  process.once('exit', cleanupManagedTemps);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(signal, () => {
      if (process.listenerCount(signal) > 1) return;
      cleanupManagedTemps(); process.exit(code);
    });
  }
}
function managedMkdtempSync(prefix = 'weftmate-test-', options) {
  initialize(options);
  const startedAt = ownProcessStart(); // No unregistered directory if querying our identity fails.
  const root = managedTempRoot(); ensureRoot(root);
  let name = path.basename(String(prefix).replaceAll('\\', '/'));
  if (!name.startsWith('weftmate-')) name = 'weftmate-' + name;
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(root, name)));
  const owner = { schemaVersion: 1, pid: process.pid, processStartedAt: startedAt,
    createdAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), id: require('node:crypto').randomUUID() };
  fs.writeFileSync(path.join(directory, OWNER_FILE), JSON.stringify(owner));
  owned.set(directory, { id: owner.id, stop: startManagedTempLease(directory), root });
  return directory;
}
async function managedMkdtemp(prefix, options) { return managedMkdtempSync(prefix, options); }
function detachTempLinks(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name), stat = fs.lstatSync(child);
    if (stat.isSymbolicLink()) fs.unlinkSync(child);
    else if (stat.isDirectory()) detachTempLinks(child);
  }
}
function disposeManagedTemp(directory, { log = console.log } = {}) {
  const registration = owned.get(directory);
  if (!registration) throw Error('Cannot remove a temp directory not owned by this process');
  if (fs.existsSync(directory)) {
    const root = canonicalRoot(registration.root), owner = readOwner(directory);
    if (fs.lstatSync(directory).isSymbolicLink() || path.dirname(fs.realpathSync.native(directory)) !== root || owner?.id !== registration.id)
      throw Error('Cannot remove a temp directory whose ownership or boundary changed');
    const record = { directory: path.basename(directory), root, bytes: treeBytes(directory),
      lastWriteTime: fs.lstatSync(directory).mtime.toISOString(), owner, mode: 'owned-dispose', result: 'deleting' };
    log(JSON.stringify(record));
    try {
      // Windows junction fixtures can leave dangling directory links. Detach
      // them before recursive removal; never traverse an external target.
      detachTempLinks(directory);
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      record.result = 'deleted'; log(JSON.stringify(record));
    } catch (error) { record.result = 'failed'; record.error = error.message; log(JSON.stringify(record)); throw error; }
  }
  registration.stop(); owned.delete(directory);
}
function cleanupManagedTemps() {
  const failed = [];
  for (const directory of owned.keys()) {
    try { disposeManagedTemp(directory); } catch { failed.push(directory); }
  }
  for (const stop of leases) stop();
  return { remaining: failed.length, directories: failed };
}
module.exports = { managedTempParent, managedTempRoot, managedMkdtempSync, managedMkdtemp, disposeManagedTemp, cleanupManagedTemps, pruneManagedTemps, startManagedTempLease };

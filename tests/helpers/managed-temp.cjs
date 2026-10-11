/** Synthetic fixture directories: one anonymous parent, ownership and exit cleanup. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const owned = new Set();
let initialized = false;
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
function ensureRoot(root) {
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync.native(root).toLowerCase() !== root.toLowerCase())
    throw Error('Managed temp root must be canonical and cannot be a junction');
}
function pruneManagedTemps({ hours = 24, now = Date.now(), root = managedTempParent() } = {}) {
  ensureRoot(root);
  const cutoff = now - hours * 3600000;
  const candidates = fs.readdirSync(root, { withFileTypes: true }).filter(entry => {
    if (!entry.name.startsWith('weftmate-') || !entry.isDirectory() || entry.isSymbolicLink()) return false;
    const stat = fs.lstatSync(path.join(root, entry.name));
    return stat.birthtimeMs < cutoff && stat.mtimeMs < cutoff;
  });
  if (!candidates.length) return { deleted: 0, keptInUse: 0 };
  if (process.platform === 'win32') {
    // Share the scheduled pruner's path boundaries, worktree and process checks.
    const result = spawnSync('pwsh', ['-NoProfile', '-File', path.resolve(__dirname, '../../scripts/nightly/prune-temp.ps1'),
      '-Hours', String(hours), '-Roots', root, '-Apply'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    if (result.status !== 0) return { deleted: 0, unavailable: true };
    try { return JSON.parse(result.stdout.trim()); } catch { return { deleted: 0, unavailable: true }; }
  }
  const listing = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8', timeout: 10000 });
  if (listing.status !== 0) return { deleted: 0, unavailable: true };
  let deleted = 0, keptInUse = 0;
  for (const entry of candidates) {
    const target = path.join(root, entry.name);
    let liveOwner = false;
    try { const owner = JSON.parse(fs.readFileSync(path.join(target, OWNER_FILE), 'utf8')); process.kill(owner.pid, 0); liveOwner = true; } catch (error) {
      if (error.code === 'EPERM') liveOwner = true;
    }
    if (liveOwner || listing.stdout.includes(target)) { keptInUse++; continue; }
    fs.rmSync(target, { recursive: true, force: true }); deleted++;
  }
  return { deleted, keptInUse };
}
function initialize() {
  if (initialized) return;
  initialized = true;
  if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) pruneManagedTemps();
  process.once('exit', cleanupManagedTemps);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(signal, () => {
      // A runner with its own signal handler must first stop and await its children.
      if (process.listenerCount(signal) > 1) return;
      cleanupManagedTemps(); process.exit(code);
    });
  }
}
function managedMkdtempSync(prefix = 'weftmate-test-') {
  initialize();
  const root = managedTempRoot(); ensureRoot(root);
  let name = path.basename(String(prefix).replaceAll('\\', '/'));
  if (!name.startsWith('weftmate-')) name = `weftmate-${name}`;
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(root, name)));
  owned.add(directory);
  fs.writeFileSync(path.join(directory, OWNER_FILE), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  return directory;
}
async function managedMkdtemp(prefix) { return managedMkdtempSync(prefix); }
function disposeManagedTemp(directory) {
  if (!owned.has(directory)) throw Error('Cannot remove a temp directory not owned by this process');
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  owned.delete(directory);
}
function cleanupManagedTemps() {
  const failed = [];
  for (const directory of owned) {
    try { disposeManagedTemp(directory); } catch { failed.push(directory); }
  }
  return { remaining: failed.length, directories: failed };
}
module.exports = { managedTempParent, managedTempRoot, managedMkdtempSync, managedMkdtemp, disposeManagedTemp, cleanupManagedTemps, pruneManagedTemps };

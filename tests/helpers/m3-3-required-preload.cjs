// Opt-in macOS test process only: GPU off and no login-keychain access.
const { registerHooks, syncBuiltinESMExports } = require('node:module');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const vault = pathToFileURL(path.join(root, 'tests/helpers/m3-3-safe-storage.mjs')).href;
const record = path.join(root, '.local/m3-3/required-electron-launches.jsonl');
fs.mkdirSync(path.dirname(record), { recursive: true, mode: 0o700 });
process.env.M3_3_TEST_VAULT_KEY ||= randomBytes(32).toString('base64');
registerHooks({ load(target, context, next) {
  if (target === pathToFileURL(path.join(root, 'src/config-store.ts')).href ||
      target === pathToFileURL(path.join(root, 'src/personal-desktop.mjs')).href) {
    const source = fs.readFileSync(new URL(target), 'utf8')
      .replace('app, safeStorage }', 'app }').replace('safeStorage, dialog', 'dialog');
    return { format: target.endsWith('.ts') ? 'module-typescript' : 'module',
      source: `import { fixtureSafeStorage as safeStorage } from ${JSON.stringify(vault)};\n${source}`, shortCircuit: true };
  }
  return next(target, context);
} });
const spawn = childProcess.spawn;
childProcess.spawn = function (command, args, options) {
  if (/\/Electron\.app\/Contents\/MacOS\/Electron$/.test(String(command)) && options?.env?.ELECTRON_RUN_AS_NODE !== '1') {
    args = [...(args || []), '--disable-gpu', '--disable-gpu-compositing', '--use-mock-keychain'];
    const child = spawn.call(this, command, args, options);
    child.once('spawn', () => fs.appendFileSync(record, JSON.stringify({ pid: child.pid,
      at: new Date().toISOString(), headless: args.some(arg => /headless/.test(arg)) }) + '\n'));
    return child;
  }
  return spawn.call(this, command, args, options);
};
syncBuiltinESMExports();

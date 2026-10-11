// The existing Linux job calls node --test before the root npm ci. Keep its
// independent cloud dependency installation here, within the S1a file scope.
import { access, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const lock = `${root}.test-dependencies.lock`;
const installed = async () => {
  try {
    await access(`${root}node_modules/oidc-provider/package.json`);
    await access(`${root}node_modules/jose/package.json`);
    return true;
  } catch {
    return false;
  }
};
const locked = async () => {
  try {
    await access(lock);
    return true;
  } catch {
    return false;
  }
};
if (!(await installed()) || (await locked())) {
  let acquired = false;
  while (!acquired) {
    try {
      await mkdir(lock);
      acquired = true;
      await writeFile(`${lock}/pid`, String(process.pid));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(`${lock}/pid`, 'utf8').catch(() => ''));
      if (pid) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === 'ESRCH') await rm(lock, { recursive: true, force: true });
        }
      }
      await setTimeout(100);
    }
  }
  if (acquired) {
    // The lock is outside node_modules, which npm ci replaces.
    try {
      if (!(await installed())) {
        // Windows batch wrappers cannot be spawned directly by Node 24.
        // Only this fixed npm command goes through cmd; no fixture/user input
        // is interpolated into its command text, and the helper stays hidden.
        const windows = process.platform === 'win32';
        const child = spawn(
          windows ? (process.env.ComSpec || 'cmd.exe') : 'npm',
          windows ? ['/d', '/s', '/c', 'npm.cmd ci --ignore-scripts --no-audit --no-fund']
            : ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
          { cwd: root, stdio: 'pipe', windowsHide: true },
        );
        let output = '';
        child.stdout.on('data', (c) => {
          output += c;
        });
        child.stderr.on('data', (c) => {
          output += c;
        });
        const [code] = await once(child, 'exit');
        if (code !== 0) throw new Error(`Cloud npm ci failed: ${output}`);
      }
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

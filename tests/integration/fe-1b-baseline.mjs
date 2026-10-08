import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const baselineCommit = 'efce1451055271a66c5ba502ba153e55e79522b7';
export const repository = resolve(import.meta.dirname, '../..');
export function exportBaseline() {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-fe1b-baseline-'));
  const prefix = 'apps/mobile-ui/www/';
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineCommit, prefix], { cwd: repository, encoding: 'utf8' }).trim().split(/\r?\n/);
  for (const path of paths) {
    const destination = join(root, path.slice(prefix.length));
    mkdirSync(resolve(destination, '..'), { recursive: true });
    writeFileSync(destination, execFileSync('git', ['show', `${baselineCommit}:${path}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024 }));
  }
  return root;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) console.log(exportBaseline());

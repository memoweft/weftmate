import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(createRequire(import.meta.url)('electron'), [resolve(import.meta.dirname, 'ds-1-compare.cjs')],
  { cwd: resolve(import.meta.dirname, '../..'), env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

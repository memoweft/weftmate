import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { runManagedTestProcess } from './helpers/managed-test-process.mjs';

test('routine cloud CSR discovery executes the fixed sample without selecting the exhaustive random sweep', {timeout:90_000}, async () => {
  const cloud = fileURLToPath(new URL('../services/cloud/',import.meta.url));
  // Use the routine cloud job's actual discovery glob; execute its CSR subset
  // so unrelated cloud suites need not be loaded into this selection check.
  const files = [];
  for await (const file of glob('test/*.test.mjs',{cwd:cloud}))
    if (basename(file).includes('csr')) files.push(resolve(cloud,file));
  assert.ok(files.length > 0);
  const preload = fileURLToPath(new URL('./fixtures/csr-routine-only.mjs',import.meta.url));
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = await runManagedTestProcess(process.execPath,
    ['--import',new URL('./fixtures/csr-routine-only.mjs',import.meta.url).href,'--test','--test-name-pattern=P-256 CSRs preserve public key',...files],
    {env,timeoutMs:60_000,commandRoots:[...files,preload]});
  assert.equal(result.timedOut,false);
  assert.equal(result.status,0,'routine discovery must not reach the exhaustive random EC generator');
  assert.match(result.stdout,/32 deterministic P-256 CSRs preserve public key/);
  assert.doesNotMatch(result.stdout,/10,000 random P-256/);
});

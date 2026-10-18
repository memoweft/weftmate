import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const python = process.env.WEFTMATE_TEST_MEMOWEFT_PYTHON || process.env.WEFTMATE_MEMOWEFT_PYTHON;

test('Core selection needs explicit inputs and never guesses a local source directory', async () => {
  const { memoWeftTestEnvironment, requireMemoWeftPath } = await import('./helpers/memoweft-environment.mjs');
  assert.equal(memoWeftTestEnvironment({}).available, false);
  assert.equal(memoWeftTestEnvironment({}).python, '');
  assert.equal(memoWeftTestEnvironment({}).pythonPath, '');
  assert.throws(() => requireMemoWeftPath('source', {}), /WEFTMATE_TEST_MEMOWEFT_SOURCE/);
  assert.throws(() => requireMemoWeftPath('python', {}), /WEFTMATE_TEST_MEMOWEFT_PYTHON/);
});

test('DSH contract source discovery also requires explicit configuration', async () => {
  const { resolveCheckout, loadPin } = await import('./contract/support/checkout.ts');
  const previous = process.env.WEFTMATE_DSH_CHECKOUT;
  delete process.env.WEFTMATE_DSH_CHECKOUT;
  try { await assert.rejects(resolveCheckout(await loadPin()), /WEFTMATE_DSH_CHECKOUT/); }
  finally {
    if (previous === undefined) delete process.env.WEFTMATE_DSH_CHECKOUT;
    else process.env.WEFTMATE_DSH_CHECKOUT = previous;
  }
});

test('explicit Core selection preserves both environment spellings and disables Python bytecode writes',
  { skip: !python && 'Set WEFTMATE_TEST_MEMOWEFT_PYTHON to the isolated interpreter for the bytecode check' }, async () => {
  const { memoWeftTestEnvironment } = await import('./helpers/memoweft-environment.mjs');
  assert.ok(python, 'Run this check with the isolated Python interpreter explicitly configured');
  const root = mkdtempSync(join(tmpdir(), 'weftmate-no-bytecode-'));
  try {
    mkdirSync(join(root, 'memoweft/integrations/dsh_bridge'), { recursive: true });
    writeFileSync(join(root, 'memoweft/integrations/dsh_bridge/__main__.py'), '');
    writeFileSync(join(root, 'synthetic_module.py'), 'value = 42\n');
    for (const env of [
      { WEFTMATE_TEST_MEMOWEFT_PYTHON: python, WEFTMATE_TEST_MEMOWEFT_SOURCE: root },
      { WEFTMATE_MEMOWEFT_PYTHON: python, WEFTMATE_MEMOWEFT_PYTHONPATH: root },
    ]) assert.equal(memoWeftTestEnvironment(env).available, true);
    const result = spawnSync(python, ['-c', 'import synthetic_module; assert synthetic_module.value == 42'],
      { env: { ...process.env, PYTHONPATH: root }, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(root, '__pycache__')), false);
    assert.equal(process.env.PYTHONDONTWRITEBYTECODE, '1');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

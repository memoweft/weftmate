import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Every Python child of these test/script entry points inherits this, including
// subprocesses started by the bridge. Source checkouts remain read-only.
process.env.PYTHONDONTWRITEBYTECODE = '1';

export function memoWeftTestEnvironment(env = process.env) {
  const python = env.WEFTMATE_MEMOWEFT_PYTHON || env.WEFTMATE_TEST_MEMOWEFT_PYTHON || '';
  const pythonPath = env.WEFTMATE_MEMOWEFT_PYTHONPATH || env.WEFTMATE_TEST_MEMOWEFT_SOURCE || '';
  return { python, pythonPath,
    available: Boolean(python && pythonPath && existsSync(python) &&
      existsSync(join(pythonPath, 'memoweft/integrations/dsh_bridge/__main__.py'))),
    skipReason: 'No explicit Core environment: set WEFTMATE_TEST_MEMOWEFT_PYTHON and WEFTMATE_TEST_MEMOWEFT_SOURCE (or WEFTMATE_MEMOWEFT_PYTHON/PYTHONPATH) to an isolated Core copy',
  };
}

export function requireMemoWeftPath(kind, env = process.env) {
  const selected = memoWeftTestEnvironment(env);
  const value = kind === 'python' ? selected.python : selected.pythonPath;
  if (!value) throw new Error(selected.skipReason);
  return value;
}

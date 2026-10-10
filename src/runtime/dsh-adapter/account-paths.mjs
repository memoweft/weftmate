import path from 'node:path';
import { lstat, realpath, readdir, rm } from 'node:fs/promises';

export const dataError = (code, category) => Object.assign(new Error(code), { code, status: 409, category });
const inside = (root, target) => { const relative = path.relative(root, target); return relative === '' || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };

/** Both lexical and resolved boundaries are checked. Never follow a junction. */
export async function assertAccountPath(accountRoot, target) {
  const root = path.resolve(accountRoot), candidate = path.resolve(target);
  if (!inside(root, candidate)) throw dataError('DATA_PATH_OUTSIDE_ACCOUNT');
  const rootInfo = await lstat(root).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!rootInfo) return candidate;
  if (rootInfo.isSymbolicLink()) throw dataError('DATA_PATH_OUTSIDE_ACCOUNT');
  const resolvedRoot = await realpath(root);
  let current = root;
  for (const component of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let info;
    try { info = await lstat(current); } catch (error) { if (error.code === 'ENOENT') return candidate; throw error; }
    if (info.isSymbolicLink() || !inside(resolvedRoot, await realpath(current))) throw dataError('DATA_PATH_OUTSIDE_ACCOUNT');
  }
  return candidate;
}

export async function accountFiles(accountRoot, target = accountRoot, signal) {
  const rows = [], pending = [target];
  while (pending.length) {
    signal?.throwIfAborted();
    const file = pending.pop();
    await assertAccountPath(accountRoot, file);
    const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) continue;
    if (info.isSymbolicLink()) throw dataError('DATA_PATH_OUTSIDE_ACCOUNT');
    if (info.isDirectory()) for (const name of await readdir(file)) pending.push(path.join(file, name));
    else if (info.isFile()) rows.push({ path: file, size: info.size, modifiedAt: info.mtimeMs });
  }
  return rows;
}

export async function removeAccountPath(accountRoot, target) {
  // Preflight every child before recursive removal so an escape never partly deletes.
  await accountFiles(accountRoot, target);
  await assertAccountPath(accountRoot, target);
  await rm(target, { recursive: true, force: true });
}

import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { desktopConfigPath, validateDesktopConfig } from './desktop-config.mjs';
import { validatePersonalHostProfile } from './host-mode.mjs';
export async function uninstallDesktopData({ appData, deleteData = false }) {
  const file = desktopConfigPath(appData);
  const config = await readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!deleteData || !config) return;
  validateDesktopConfig(config);
  const info = await lstat(config.dataDirectory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('UNINSTALL_DATA_DIRECTORY_INVALID');
  const data = validatePersonalHostProfile(config.dataDirectory);
  const control = await realpath(dirname(file));
  // Refuse a root/ancestor: deleting it would destroy unrelated configuration or the program.
  const rel = relative(data, control);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)) || dirname(data) === data) throw new Error('UNINSTALL_DATA_DIRECTORY_UNSAFE');
  await rm(data, { recursive: true });
  await rm(file, { force: true });
}

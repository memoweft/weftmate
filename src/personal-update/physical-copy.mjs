/** Copy installed ASAR bytes, bypassing Electron's virtual ASAR filesystem. */
import { createRequire } from 'node:module';
import { join } from 'node:path';
const fs = createRequire(import.meta.url)('original-fs').promises;
export async function copyPhysicalTree(source, destination, excludedRootFiles = []) {
  const files = [];
  async function walk(from, to) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      if (from === source && excludedRootFiles.includes(entry.name)) continue;
      const src = join(from, entry.name), dst = join(to, entry.name);
      if (entry.isSymbolicLink()) throw new Error('APP_RECOVERY_PROGRAM_LINK_UNEXPECTED');
      if (entry.isDirectory()) await walk(src, dst);
      else if (entry.isFile()) files.push([src, dst]);
    }
  }
  await walk(source, destination);
  for (let offset = 0; offset < files.length; offset += 16)
    await Promise.all(files.slice(offset, offset + 16).map(([from, to]) => fs.copyFile(from, to)));
}
export const copyPhysicalFile = (from, to) => fs.copyFile(from, to);
export async function removePhysicalTree(root) {
  const files = [], directories = [];
  async function walk(dir) {
    directories.push(dir);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(path);
      else files.push(path);
    }
  }
  await walk(root);
  for (let offset = 0; offset < files.length; offset += 16) await Promise.all(files.slice(offset, offset + 16).map(file => fs.unlink(file)));
  for (const dir of directories.reverse()) await fs.rmdir(dir);
}

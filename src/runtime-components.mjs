import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Keep Windows paths within the same budget as the former resources tree.
// The full content hash remains in the descriptor and completion marker.
export const runtimeComponentRelative = (name, version) => join(name === 'dsh-runtime' ? 'dsh' : 'memory', version.slice(0, 16));

export function productDshRuntimeDirectory({ packaged, resourcesPath, appPath }) {
  return packaged ? packagedRuntimeDirectory(resourcesPath, 'dsh-runtime') : join(appPath, 'vendor', 'dsh-runtime');
}

export function packagedRuntimeDirectory(resources, name) {
  const descriptor = join(resources, 'runtime-components.json');
  if (existsSync(descriptor)) {
    const manifest = JSON.parse(readFileSync(descriptor, 'utf8'));
    const version = manifest.components?.[name];
    if (manifest.schemaVersion !== 1 || !['dsh-runtime', 'memory-runtime'].includes(name) || !/^[a-f0-9]{64}$/.test(version))
      throw Error('Invalid packaged runtime component');
    return join(dirname(resources) + '.components', runtimeComponentRelative(name, version));
  }
  return join(resources, name);
}

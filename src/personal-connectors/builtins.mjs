import { join } from 'node:path';

/** ST-7b registers a stable id, user-facing fields, and an in-process config
 * factory. Secrets are supplied to the factory in memory, never in the catalog. */
export function builtinConnectors() {
  return [{ id: 'local-clock', name: '本机时间', description: '让助手读取这台电脑的时间，不联网。', fields: [],
    configure: () => ({ transport: 'stdio', command: process.execPath,
      args: [join(import.meta.dirname, 'clock-server.mjs')], environment: { ELECTRON_RUN_AS_NODE: '1' } }) }];
}

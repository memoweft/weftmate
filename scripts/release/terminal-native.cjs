const { existsSync } = require('node:fs');
const { join } = require('node:path');

/** node-pty 1.1 ships Node-API builds: no Electron ABI-specific rebuild on Windows. */
exports.verifyTerminalNative = context => {
  if (context.electronPlatformName !== 'win32') return;
  const root = join(context.packager.projectDir, 'node_modules/node-pty');
  const native = join(root, 'prebuilds', `win32-${context.arch === 3 ? 'arm64' : 'x64'}`);
  for (const name of ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']) {
    if (!existsSync(join(native, name))) throw new Error(`Terminal native module missing: ${name}`);
  }
};

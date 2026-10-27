import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const output = new URL('src/personal-access-ui/vendor/terminal/', root);
await mkdir(output, { recursive: true });
for (const [source, target] of [
  ['@xterm/xterm/lib/xterm.js', 'xterm.js'], ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
  ['@xterm/xterm/LICENSE', 'xterm.LICENSE'], ['@xterm/addon-fit/LICENSE', 'addon-fit.LICENSE'],
]) await copyFile(new URL(`node_modules/${source}`, root), new URL(target, output));
console.log(`Terminal assets copied to ${fileURLToPath(output).split('src')[1]}`);

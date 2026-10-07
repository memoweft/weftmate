import { build } from 'esbuild';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
await build({ entryPoints: [root + 'apps/mobile-ui/src/cloud-vendor.js'], bundle: true,
  minify: true, format: 'iife', globalName: 'WeftCloudVendor',
  outfile: root + 'src/personal-access-ui/cloud-vendor.js', legalComments: 'inline' });
for (const name of ['cloud-login.js', 'cloud-vendor.js'])
  await copyFile(root + 'src/personal-access-ui/' + name, root + 'apps/mobile-ui/www/' + name);
await writeFile(root + 'apps/mobile-ui/www/licenses/cloud.txt',
  'jose 6.2.12\n' + await readFile(root + 'node_modules/jose/LICENSE.md', 'utf8') +
  '\nqrcode 1.5.4\n' + await readFile(root + 'apps/mobile-ui/node_modules/qrcode/license', 'utf8') +
  '\ndijkstrajs 1.0.3\n' + await readFile(root + 'apps/mobile-ui/node_modules/dijkstrajs/LICENSE.md', 'utf8'));

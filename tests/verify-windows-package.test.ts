import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import asar from '@electron/asar';
import { verifyWindowsPackage } from '../scripts/verify-windows-package.mjs';

test('package scanner distinguishes upstream paths and refuses synthetic build identity across archives and loose resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-package-policy-'));
  const identity = { home: ['C:', 'Users', 'Fictional Builder'].join('/'), username: 'Fictional Builder', hostname: 'SYNTHETIC-BUILDER-HOST', roots: [] };
  try {
    const unpacked = join(root, 'win-unpacked'), resources = join(unpacked, 'resources');
    const source = join(root, 'source'), runtime = join(resources, 'dsh-runtime');
    const dependency = join(runtime, 'node_modules/node-pty/src/example.test.ts');
    const own = join(runtime, 'config.json'), installer = join(root, 'synthetic.exe');
    await mkdir(join(source, 'src'), { recursive: true });
    await mkdir(join(runtime, 'node_modules/node-pty/src'), { recursive: true });
    await writeFile(installer, 'synthetic installer');
    await writeFile(join(runtime, 'VENDOR-MANIFEST.json'), JSON.stringify({ webRuntimeEntry: 'node_modules/node-pty/src/example.test.ts', carriedButNotMounted: [], closure: [] }));
    await writeFile(join(source, 'src/main.mjs'), 'export const synthetic = true;');
    const upstream = ['C:', 'Users', 'Upstream Example', 'Desktop', 'test script.bat'].join('\\');
    await mkdir(join(source, 'node_modules/upstream'), { recursive: true });
    await writeFile(join(source, 'node_modules/upstream/example.js'), upstream);
    await writeFile(dependency, upstream);
    const pack = () => asar.createPackage(source, join(resources, 'app.asar'));
    await pack();
    const verify = () => verifyWindowsPackage({ unpacked, installer, identity });
    assert.equal((await verify()).boundaries.buildMachineIdentityHits, 0);
    for (const file of [dependency, own]) {
      await writeFile(file, identity.home + '/private');
      await assert.rejects(verify(), /build-machine-identity/);
      await writeFile(file, file === dependency ? upstream : '{}');
    }
    await writeFile(own, upstream);
    await assert.rejects(verify(), /development-path/);
    await writeFile(own, '{}');
    // Identity in a large upstream source map and UTF-16 config must still fail.
    const map = join(runtime, 'node_modules/node-pty/large.map');
    await writeFile(map, ' '.repeat(5_000_001) + identity.hostname);
    await assert.rejects(verify(), /build-machine-identity/);
    await rm(map);
    await writeFile(own, Buffer.from('\ufeff' + identity.home, 'utf16le'));
    await assert.rejects(verify(), /build-machine-identity/);
    await writeFile(own, '{}');
    const binary = join(runtime, 'node_modules/node-pty/native.node');
    await writeFile(binary, Buffer.concat([Buffer.from([0, 255, 0]), Buffer.from(identity.home)]));
    await assert.rejects(verify(), /build-machine-identity/);
    await rm(binary);
    await writeFile(join(source, 'node_modules/upstream/example.js'), identity.home);
    await pack();
    await assert.rejects(verify(), /app.asar contains build-machine-identity/);
    await writeFile(join(source, 'node_modules/upstream/example.js'), upstream);
    await writeFile(join(source, 'src/main.mjs'), identity.username);
    await pack();
    await assert.rejects(verify(), /app.asar contains build-machine-identity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

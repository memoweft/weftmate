import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import asar from '@electron/asar';
import { verifyWindowsPackage } from '../scripts/verify-windows-package.mjs';
import {memoryRuntimeFixture} from './helpers/memory-runtime-fixture.mjs';
import {verifyMemoryRuntime} from '../scripts/memory-runtime/verify.mjs';

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
    await memoryRuntimeFixture(join(resources,'memory-runtime'));
    const memoryMetadata = { memoryRuntimeMode: 'base', memoryRuntimeManifestSha256:
      (await verifyMemoryRuntime(join(resources,'memory-runtime'), {mode:'base'})).manifestSha256 };
    await writeFile(join(source,'package.json'),JSON.stringify(memoryMetadata));
    const upstream = ['C:', 'Users', 'Upstream Example', 'Desktop', 'test script.bat'].join('\\');
    await mkdir(join(source, 'node_modules/upstream'), { recursive: true });
    await writeFile(join(source, 'node_modules/upstream/example.js'), upstream);
    await writeFile(dependency, upstream);
    const pack = () => asar.createPackage(source, join(resources, 'app.asar'));
    await pack();
    const verify = () => verifyWindowsPackage({ unpacked, installer, identity });
    assert.equal((await verify()).boundaries.buildMachineIdentityHits, 0);
    await writeFile(join(source,'package.json'),JSON.stringify({...memoryMetadata,memoryRuntimeManifestSha256:'0'.repeat(64)}));
    await pack(); await assert.rejects(verify(),/manifest does not match/);
    await writeFile(join(source,'package.json'),JSON.stringify(memoryMetadata)); await pack();
    // A package with its resource filter accidentally omitting memory fails.
    await rm(join(resources,'memory-runtime/python/python.exe'));
    await assert.rejects(verify(),/memory runtime/);
    await memoryRuntimeFixture(join(resources,'memory-runtime'));
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

test('Mac trial reuse keeps archive and loose-resource checks without requiring Windows memory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-mac-package-policy-'));
  const identity={home:['C:','Users','Fictional Builder'].join('/'),username:'Fictional Builder',hostname:'SYNTHETIC-BUILDER-HOST',roots:[]};
  try{
    const unpacked=join(root,'WeftMate.app'),resources=join(unpacked,'Contents/Resources'),installer=join(unpacked,'Contents/MacOS/WeftMate');
    const source=join(root,'source'),runtime=join(resources,'dsh-runtime');
    await mkdir(join(source,'src'),{recursive:true});await mkdir(runtime,{recursive:true});await mkdir(join(installer,'..'),{recursive:true});
    await writeFile(installer,'synthetic Mac executable');await writeFile(join(source,'src/main.mjs'),'export const synthetic=true;');
    await writeFile(join(source,'package.json'),JSON.stringify({macTrial:true}));
    await writeFile(join(runtime,'main.mjs'),'export const synthetic=true;');
    const manifest=join(runtime,'VENDOR-MANIFEST.json');
    await writeFile(manifest,JSON.stringify({webRuntimeEntry:'main.mjs',carriedButNotMounted:[],closure:[]}));
    const pack=()=>asar.createPackage(source,join(resources,'app.asar'));await pack();
    // Match build-mac-trial's explicit target and actual .app resource layout.
    const verify=()=>verifyWindowsPackage({unpacked,resourcesDirectory:resources,installer,identity,platform:'darwin'});
    const result=await verify();assert.equal(result.memoryRuntime,null);assert.ok(result.appArchive.scannedTextFiles>0);assert.ok(result.vendor.scannedTextFiles>0);
    // macTrial metadata alone must never exempt the default Windows target.
    await assert.rejects(verifyWindowsPackage({unpacked,resourcesDirectory:resources,installer,identity}),/memory runtime mode/);
    await writeFile(join(runtime,'main.mjs'),identity.home+'/private');await assert.rejects(verify(),/build-machine-identity/);
    await writeFile(join(runtime,'main.mjs'),'export const synthetic=true;');
    await writeFile(join(source,'src/main.mjs'),identity.hostname);await pack();await assert.rejects(verify(),/app.asar contains build-machine-identity/);
    await writeFile(join(source,'src/main.mjs'),'export const synthetic=true;');await pack();
    await rm(join(runtime,'main.mjs'));await assert.rejects(verify(),/runtime entry is missing/);
  }finally{await rm(root,{recursive:true,force:true});}
});

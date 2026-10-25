import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import asar from '@electron/asar';
import { verifyWindowsPackage } from '../scripts/verify-windows-package.mjs';
import {memoryRuntimeFixture,sealMemoryRuntimeFixture} from './helpers/memory-runtime-fixture.mjs';
import {verifyMemoryRuntime} from '../scripts/memory-runtime/verify.mjs';
import {csrDependencyFixture} from './helpers/csr-dependency-fixture.mjs';
import {csrPatches} from '../src/personal-relay/csr-integrity.mjs';
import {prepareWindowsRuntimeComponents} from '../scripts/windows-runtime-components.mjs';
import {packagedRuntimeDirectory} from '../src/runtime-components.mjs';

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
    await csrDependencyFixture(source);
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
    await writeFile(join(source, 'src/main.mjs'), 'export const synthetic = true;');
    await writeFile(join(resources, 'memory-runtime/site-packages/upstream-example.py'), upstream);
    await sealMemoryRuntimeFixture(join(resources, 'memory-runtime'));
    const separatedMemory = await verifyMemoryRuntime(join(resources, 'memory-runtime'), {mode:'base'});
    await writeFile(join(source, 'package.json'), JSON.stringify({...memoryMetadata,memoryRuntimeManifestSha256:separatedMemory.manifestSha256}));
    await pack();
    await prepareWindowsRuntimeComponents({ appOutDir: unpacked, packager: { projectDir: root, config: { appId: 'test.components' } } });
    const separated = await verify();
    assert.equal(separated.memoryRuntime.manifestSha256, separatedMemory.manifestSha256);
    const movedConfig = join(packagedRuntimeDirectory(resources, 'dsh-runtime'), 'config.json');
    await writeFile(movedConfig, identity.hostname);
    await assert.rejects(verify(), /build-machine-identity/);
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
    await csrDependencyFixture(source);
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

test('package verification refuses exact unpatched CSR dependencies inside app.asar', async t => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-csr-package-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const unpacked = join(root,'win-unpacked'), resources = join(unpacked,'resources');
  const source = join(root,'source'), runtime = join(resources,'dsh-runtime'), installer = join(root,'synthetic.exe');
  await mkdir(join(source,'src'),{recursive:true}); await mkdir(runtime,{recursive:true});
  await writeFile(installer,'synthetic installer'); await writeFile(join(source,'src/main.mjs'),'export const synthetic=true;');
  await writeFile(join(runtime,'main.mjs'),'export const synthetic=true;');
  await writeFile(join(runtime,'VENDOR-MANIFEST.json'),JSON.stringify({webRuntimeEntry:'main.mjs',carriedButNotMounted:[],closure:[]}));
  await memoryRuntimeFixture(join(resources,'memory-runtime'));
  const memory = await verifyMemoryRuntime(join(resources,'memory-runtime'),{mode:'base'});
  await writeFile(join(source,'package.json'),JSON.stringify({memoryRuntimeMode:'base',memoryRuntimeManifestSha256:memory.manifestSha256}));
  const pack = () => asar.createPackage(source,join(resources,'app.asar'));
  const verify = () => verifyWindowsPackage({unpacked,installer,identity:{roots:[]}});
  await csrDependencyFixture(source); await pack(); await verify();
  // Reviewer reproduction: exact upstream bytes pass the old package checker.
  await csrDependencyFixture(source,{patched:false}); await pack();
  await assert.rejects(verify(), /CSR.*patched SHA256 mismatch/i);
  // Check both actual dependency files independently, not only the first failure.
  for (const patch of csrPatches) {
    await csrDependencyFixture(source,{patched:false});
    const file = join(source,'node_modules',patch.package,patch.file), upstream = await readFile(file);
    await csrDependencyFixture(source); await writeFile(file,upstream); await pack();
    await assert.rejects(verify(),{code:'CSR_PATCH_INVALID',message:/patched SHA256 mismatch/});
  }
  await csrDependencyFixture(source);
  const parser = join(source,'node_modules/@root/asn1/parser.js');
  await writeFile(parser,Buffer.concat([await readFile(parser),Buffer.from('\n// drift\n')])); await pack();
  await assert.rejects(verify(),/patched SHA256 mismatch/);
  await csrDependencyFixture(source); await rm(parser); await pack();
  await assert.rejects(verify(),/files missing or unreadable/);
  await csrDependencyFixture(source);
  const nested = join(source,'node_modules/@root/acme/node_modules/@root/csr'); await mkdir(nested,{recursive:true});
  await writeFile(join(nested,'package.json'),await readFile(join(source,'node_modules/@root/csr/package.json'))); await pack();
  await assert.rejects(verify(),/unexpected nested @root\/csr/);
  await rm(join(source,'node_modules/@root/acme/node_modules'),{recursive:true,force:true});
  await asar.createPackageWithOptions(source,join(resources,'app.asar'),{unpack:'**/parser.js'}); await verify();
  // If builder unpacks a dependency, inspect those shipped bytes as well.
  await writeFile(join(resources,'app.asar.unpacked/node_modules/@root/asn1/parser.js'),'unpatched');
  await assert.rejects(verify(),/patched SHA256 mismatch/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { csrDependencyFixture } from './helpers/csr-dependency-fixture.mjs';
import { applyRootCsrPatch } from '../scripts/patch-root-csr.mjs';
import { csrHash, csrPatches } from '../src/personal-relay/csr-integrity.mjs';
import packageInfo from '../package.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const beforePack = require(`../${packageInfo.build.beforePack}`);
async function fixture(t, patched = false) {
  await mkdir('.local', {recursive:true});
  // Within this checkout so omitted, unchanged transitive packages resolve to
  // the real installed closure; the two patched files are isolated copies.
  const root = await mkdtemp(resolve('.local/csr-integrity-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  await csrDependencyFixture(root, {patched});
  const requireFrom = pathToFileURL(join(root,'package.json')).href;
  return {root, requireFrom, context:{electronPlatformName:'linux',packager:{projectDir:root}}};
}

test('shared beforePack repairs exact upstream files with npmRebuild false and no postinstall, and is idempotent', async t => {
  const {root, context} = await fixture(t);
  context.packager.config = packageInfo.build;
  assert.equal(context.packager.config.npmRebuild,false);
  for (const p of csrPatches) assert.equal(csrHash(await readFile(join(root,'node_modules',p.package,p.file))),p.sha256);
  await beforePack(context); await beforePack(context);
  for (const p of csrPatches) assert.equal(csrHash(await readFile(join(root,'node_modules',p.package,p.file))),p.patchedSha256);
});

test('build refuses unknown source or upgraded dependencies before writing any patch', async t => {
  const {root,context,requireFrom} = await fixture(t);
  const parser = join(root,'node_modules/@root/asn1/parser.js');
  const csr = join(root,'node_modules/@root/csr/csr.js');
  const original = await readFile(parser);
  await writeFile(csr, Buffer.concat([await readFile(csr),Buffer.from('\n// drift\n')]));
  await assert.rejects(beforePack(context),{code:'CSR_PATCH_INVALID',message:/re-evaluate the patch and hashes/});
  assert.ok(original.equals(await readFile(parser)), 'no partial repair when another input drifts');
  await csrDependencyFixture(root,{patched:false});
  const metadataFile = join(root,'node_modules/@root/csr/package.json');
  const metadata = JSON.parse(await readFile(metadataFile,'utf8'));
  await writeFile(metadataFile,JSON.stringify({...metadata,version:'999.0.0'}));
  await assert.rejects(applyRootCsrPatch({requireFrom}),{code:'CSR_PATCH_INVALID',message:/version mismatch/});
  assert.ok(original.equals(await readFile(parser)));
});

test('runtime first use refuses unpatched dependencies without changing them, then accepts a repaired installation', async t => {
  const {root,requireFrom} = await fixture(t);
  const directory = join(root,'src/personal-relay'); await mkdir(directory,{recursive:true});
  for (const file of ['csr.mjs','csr-integrity.mjs','csr-patch.json'])
    await copyFile(new URL(`../src/personal-relay/${file}`,import.meta.url),join(directory,file));
  const {createCsr} = await import(pathToFileURL(join(directory,'csr.mjs')).href);
  const jwk = generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});
  await assert.rejects(createCsr({jwk,domains:['example.com']}),{code:'CSR_PATCH_INVALID',message:/patched SHA256 mismatch/});
  for (const p of csrPatches) assert.equal(csrHash(await readFile(join(root,'node_modules',p.package,p.file))),p.sha256);
  await applyRootCsrPatch({requireFrom});
  assert.match(await createCsr({jwk,domains:['example.com']}),/BEGIN CERTIFICATE REQUEST/);
  // A successful check is intentionally once per process, not per renewal.
  await rm(join(root,'node_modules/@root/asn1/parser.js'));
  assert.match(await createCsr({jwk,domains:['example.com']}),/BEGIN CERTIFICATE REQUEST/);
});

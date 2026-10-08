import { readFile, mkdir, copyFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicKey } from 'node:crypto';
import { personalAccessUiResources } from '../../src/personal-access-ui/index.mjs';
import { keyId, sha256, signManifest, signingKeyFromEnvironment, verifyManifest, safeAssetPath } from '../../src/personal-update/manifest.mjs';
import { atomicJson } from '../../src/personal-update/store.mjs';
import { publishMobileUi } from '../../src/personal-access/mobile-ui-release.mjs';

/** A full immutable version and a changed-file tree; clients also diff against their own hashes. */
export async function packageRelease({ layer, version, outputDir, sourceDir, channel = 'stable',
  minAppVersion = '0.1.0', minHostVersion = '0.1.0', minNativeVersion = '0.0.0',
  minNativeVersionCode = 22, bridgeVersion = 1, previousManifest = null, privateKey = null,
  resources = null }) {
  privateKey ||= await signingKeyFromEnvironment();
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const trustedKeys = { [keyId(publicKey)]: publicKey };
  if (layer === 'mobile-ui') {
    const manifest = await publishMobileUi({ sourceDir: resolve(sourceDir || 'apps/mobile-ui/www'), outputDir: resolve(outputDir),
      uiVersion: version, minNativeVersionCode, minHostVersion, minNativeVersion, channel, privateKey });
    verifyManifest(manifest, trustedKeys, { layer, channel });
    if (previousManifest) verifyManifest(previousManifest, trustedKeys, { layer, channel });
    const changed = manifest.files.filter(file => !previousManifest?.files.some(old => old.path === file.path && old.sha256 === file.sha256 && old.size === file.size));
    const hash = manifest.assetBase.split('/')[5];
    for (const file of changed) {
      const target = join(outputDir, 'delta', layer, version, file.path); await mkdir(dirname(target), { recursive: true });
      await copyFile(join(outputDir, 'bundles', hash, file.path), target);
    }
    await atomicJson(join(outputDir, 'delta-mobile-ui.json'), { fromVersion: previousManifest?.version || null, version,
      changedFiles: changed, changedBytes: changed.reduce((sum, file) => sum + file.size, 0) });
    await atomicJson(join(outputDir, 'manifest-mobile-ui.json'), manifest);
    return manifest;
  }
  if (!['app', 'ui'].includes(layer)) throw new Error('invalid release layer');
  const inputs = layer === 'ui' ? (resources || personalAccessUiResources) : new Map();
  if (layer === 'app') {
    if (!sourceDir) throw new Error('app requires a reviewed installer directory');
    for (const name of await readdir(sourceDir)) {
      if (/\.(exe|blockmap|yml|zip|dmg|AppImage)$/.test(name)) inputs.set(name, join(sourceDir, name));
    }
    if (![...inputs.keys()].some(name => /\.(exe|dmg|zip|AppImage)$/.test(name))) throw new Error('app installer missing');
    if ([...inputs.keys()].some(name => name.endsWith('.exe') && !inputs.has(name + '.blockmap'))) throw new Error('app blockmap missing; build with electron-builder differentialPackage');
  }
  const files = [];
  for (const [name, source] of inputs) {
    if (!safeAssetPath(name) || !(await lstat(source)).isFile() || (await lstat(source)).isSymbolicLink()) throw new Error('invalid release resource');
    const bytes = await readFile(source); files.push({ path: name, size: bytes.length, sha256: sha256(bytes) });
  }
  files.sort((a, b) => a.path < b.path ? -1 : 1);
  const manifest = signManifest({ schemaVersion: 1, layer, version, channel, minAppVersion, minHostVersion,
    ...(layer === 'ui' ? { bridgeVersion } : {}), files, publishedAt: new Date().toISOString(),
    assetBase: `./files/${layer}/${version}/` }, privateKey);
  verifyManifest(manifest, trustedKeys, { layer, channel });
  if (previousManifest) verifyManifest(previousManifest, trustedKeys, { layer, channel });
  const changed = files.filter(file => !previousManifest?.files.some(old => old.path === file.path && old.sha256 === file.sha256 && old.size === file.size));
  const versionDir = join(outputDir, 'files', layer, version);
  const oldManifest = await readFile(join(versionDir, 'manifest.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (oldManifest) throw new Error('version already published; increment version');
  for (const file of files) {
    const target = join(versionDir, file.path); await mkdir(dirname(target), { recursive: true }); await copyFile(inputs.get(file.path), target);
    if (sha256(await readFile(target)) !== file.sha256) throw new Error('hash source changed while publishing');
  }
  for (const file of changed) {
    const target = join(outputDir, 'delta', layer, version, file.path);
    await mkdir(dirname(target), { recursive: true }); await copyFile(join(versionDir, file.path), target);
  }
  await writeFile(join(versionDir, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' });
  // electron-updater resolves latest.yml and its versioned installer/blockmap at the feed root.
  if (layer === 'app') for (const file of files) await copyFile(join(versionDir, file.path), join(outputDir, file.path));
  await atomicJson(join(outputDir, `delta-${layer}.json`), { fromVersion: previousManifest?.version || null,
    version, changedFiles: changed, removedFiles: (previousManifest?.files || []).filter(old => !files.some(file => old.path === file.path)),
    changedBytes: changed.reduce((sum, file) => sum + file.size, 0) });
  await atomicJson(join(outputDir, `manifest-${layer}.json`), manifest);
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = {};
  const names = { '--layer': 'layer', '--version': 'version', '--output-dir': 'outputDir', '--source-dir': 'sourceDir',
    '--channel': 'channel', '--min-app-version': 'minAppVersion', '--min-host-version': 'minHostVersion',
    '--min-native-version': 'minNativeVersion', '--min-native-version-code': 'minNativeVersionCode', '--previous': 'previous' };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = names[process.argv[i]], value = process.argv[i + 1];
    if (!key || !value || value.startsWith('--') || options[key] !== undefined) throw new Error('invalid release arguments');
    options[key] = value;
  }
  if (!options.layer || !options.version || !options.outputDir) throw new Error('--layer, --version and --output-dir are required');
  options.outputDir = resolve(options.outputDir);
  if (options.minNativeVersionCode) options.minNativeVersionCode = Number(options.minNativeVersionCode);
  if (options.previous) options.previousManifest = JSON.parse(await readFile(options.previous, 'utf8'));
  if (options.layer === 'mobile-ui') { const { checkMobileUi } = await import('../../apps/mobile-ui/src/check.mjs'); await checkMobileUi(); }
  const result = await packageRelease(options);
  console.log(`Verified ${result.layer} ${result.version} (${result.channel}), ${result.files.length} files`);
}

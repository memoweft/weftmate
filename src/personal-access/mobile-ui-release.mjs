import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rename, rm, lstat, open } from 'node:fs/promises';
import path from 'node:path';

const HASH = /^[a-f0-9]{64}$/;
const ASSET_PATH = /^(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9_.\/-]{1,180}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const MAX_ASSETS = 250;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const TYPES = new Map([['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.json', 'application/json; charset=utf-8'], ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2']]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => { throw new Error(`mobile UI release: ${message}`); };

function validateAssets(assets) {
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > MAX_ASSETS) fail('invalid asset list');
  let total = 0;
  const paths = new Set();
  for (const asset of assets) {
    if (!plain(asset) || Object.keys(asset).sort().join(',') !== 'path,sha256,size' ||
        typeof asset.path !== 'string' || !ASSET_PATH.test(asset.path) ||
        asset.path.split('/').some((part) => part.startsWith('.')) ||
        !TYPES.has(path.extname(asset.path).toLowerCase()) ||
        typeof asset.sha256 !== 'string' || !HASH.test(asset.sha256) ||
        !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ASSET_BYTES ||
        paths.has(asset.path)) fail('invalid asset');
    paths.add(asset.path);
    total += asset.size;
  }
  if (!paths.has('index.html') || total > MAX_BUNDLE_BYTES) fail('incomplete bundle');
  return [...assets].sort((a, b) => a.path.localeCompare(b.path));
}

export function validateMobileManifest(value) {
  if (!plain(value) || Object.keys(value).sort().join(',') !==
      'assetBase,assets,bridgeVersion,entry,minNativeVersionCode,publishedAt,releaseNotes,schemaVersion,uiVersion' ||
      value.schemaVersion !== 1 || value.bridgeVersion !== 1 ||
      !Number.isSafeInteger(value.minNativeVersionCode) || value.minNativeVersionCode < 1 ||
      value.minNativeVersionCode > 1_000_000 ||
      typeof value.uiVersion !== 'string' || !VERSION.test(value.uiVersion) ||
      value.entry !== 'index.html' || typeof value.releaseNotes !== 'string' ||
      value.releaseNotes.length > 300 || typeof value.publishedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.publishedAt))) fail('invalid manifest');
  const hash = /^\/personal\/v1\/app\/assets\/([a-f0-9]{64})\/$/.exec(value.assetBase)?.[1];
  if (!hash) fail('invalid asset base');
  const assets = validateAssets(value.assets);
  if (sha(JSON.stringify(assets)) !== hash) fail('asset index hash mismatch');
  return { manifest: value, hash, assets };
}

async function filesUnder(root, directory = root, prefix = '') {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) fail('linked source is refused');
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (!ASSET_PATH.test(relative) || relative.split('/').some((part) => part.startsWith('.'))) {
      fail('unsafe source path');
    }
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) found.push(...await filesUnder(root, absolute, relative));
    else if (item.isFile()) found.push({ relative, absolute });
    else fail('unsupported source entry');
  }
  return found;
}

async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx');
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    if (process.platform !== 'win32') {
      const directory = await open(path.dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
  }
}

async function verifyBundle(outputDir, hash, assets) {
  const bundle = path.join(outputDir, 'bundles', hash);
  const index = JSON.parse(await readFile(path.join(bundle, 'asset-index.json'), 'utf8'));
  if (index.hash !== hash || JSON.stringify(validateAssets(index.assets)) !== JSON.stringify(assets)) {
    fail('bundle index mismatch');
  }
  for (const asset of assets) {
    const file = path.join(bundle, ...asset.path.split('/'));
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.size ||
        sha(await readFile(file)) !== asset.sha256) fail('bundle asset mismatch');
  }
}

/** Build immutable bytes before publishing one tiny atomic current pointer. */
export async function publishMobileUi({ sourceDir, outputDir, uiVersion = '0.2.0',
  minNativeVersionCode = 2, releaseNotes = '' }) {
  if (typeof sourceDir !== 'string' || typeof outputDir !== 'string' ||
      !path.isAbsolute(sourceDir) || !path.isAbsolute(outputDir) ||
      typeof uiVersion !== 'string' || !VERSION.test(uiVersion) ||
      !Number.isSafeInteger(minNativeVersionCode) || minNativeVersionCode < 1 || minNativeVersionCode > 1_000_000 ||
      typeof releaseNotes !== 'string' || releaseNotes.length > 300) fail('invalid publish options');
  const inputs = await filesUnder(sourceDir);
  const contents = new Map();
  for (const item of inputs) {
    if (!TYPES.has(path.extname(item.relative).toLowerCase())) fail('unsupported public asset type');
    const bytes = await readFile(item.absolute);
    if (bytes.length < 1 || bytes.length > MAX_ASSET_BYTES) fail('asset size is invalid');
    contents.set(item.relative, bytes);
  }
  const assets = validateAssets([...contents].map(([assetPath, bytes]) =>
    ({ path: assetPath, sha256: sha(bytes), size: bytes.length })));
  const hash = sha(JSON.stringify(assets));
  const manifest = { schemaVersion: 1, uiVersion, bridgeVersion: 1, minNativeVersionCode,
    assetBase: `/personal/v1/app/assets/${hash}/`, entry: 'index.html', assets,
    releaseNotes, publishedAt: new Date().toISOString() };
  validateMobileManifest(manifest);
  await mkdir(path.join(outputDir, 'bundles'), { recursive: true });
  await mkdir(path.join(outputDir, 'releases'), { recursive: true });
  const bundle = path.join(outputDir, 'bundles', hash);
  const staging = path.join(outputDir, `.${hash}.${randomUUID()}.staging`);
  if (path.dirname(path.resolve(staging)) !== path.resolve(outputDir)) fail('staging path escaped release root');
  try {
    await mkdir(staging);
    for (const [name, bytes] of contents) {
      const destination = path.join(staging, ...name.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
    }
    await writeFile(path.join(staging, 'asset-index.json'), `${JSON.stringify({ hash, assets })}\n`, { flag: 'wx' });
    try { await rename(staging, bundle); }
    catch (error) {
      if ((await lstat(bundle).catch(() => null))?.isDirectory() !== true) throw error;
      await verifyBundle(outputDir, hash, assets);
    }
  } finally { await rm(staging, { recursive: true, force: true }).catch(() => {}); }
  const releaseId = `${uiVersion}-${hash}`;
  const releaseFile = path.join(outputDir, 'releases', `${releaseId}.json`);
  if ((await lstat(releaseFile).catch(() => null)) === null) await writeFile(releaseFile, `${JSON.stringify(manifest)}\n`, { flag: 'wx' });
  else {
    const existing = JSON.parse(await readFile(releaseFile, 'utf8'));
    validateMobileManifest(existing);
    if (existing.uiVersion !== uiVersion || existing.assetBase !== manifest.assetBase ||
        existing.minNativeVersionCode !== minNativeVersionCode || existing.releaseNotes !== releaseNotes) {
      fail('release identity conflict');
    }
  }
  await atomicJson(path.join(outputDir, 'current.json'), manifest);
  return manifest;
}

export async function activateMobileUiRelease({ outputDir, releaseId }) {
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir) ||
      typeof releaseId !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{64}$/.test(releaseId)) {
    fail('invalid release identity');
  }
  const manifest = JSON.parse(await readFile(path.join(outputDir, 'releases', `${releaseId}.json`), 'utf8'));
  const { hash, assets } = validateMobileManifest(manifest);
  await verifyBundle(outputDir, hash, assets);
  await atomicJson(path.join(outputDir, 'current.json'), manifest);
  return manifest;
}

export function createMobileUiPublisher({ root }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('explicit absolute release directory is required');
  const clients = new Set();
  async function current() {
    try { return validateMobileManifest(JSON.parse(await readFile(path.join(root, 'current.json'), 'utf8'))).manifest; }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  }
  async function asset(hash, name) {
    if (!HASH.test(hash) || !ASSET_PATH.test(name) || name.split('/').some((part) => part === '..' || part === '.')) return null;
    const bundle = path.join(root, 'bundles', hash);
    const index = JSON.parse(await readFile(path.join(bundle, 'asset-index.json'), 'utf8'));
    const assets = validateAssets(index.assets);
    if (index.hash !== hash || sha(JSON.stringify(assets)) !== hash) fail('bundle index mismatch');
    const entry = assets.find((row) => row.path === name);
    if (!entry) return null;
    const file = path.join(bundle, ...name.split('/'));
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.size) fail('bundle asset changed');
    const bytes = await readFile(file);
    if (sha(bytes) !== entry.sha256) fail('bundle asset changed');
    return { bytes, contentType: TYPES.get(path.extname(name).toLowerCase()), etag: `"${entry.sha256}"` };
  }
  async function updates(response, authorize = () => {}) {
    authorize();
    const initial = await current();
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
    response.write(': connected\n\n');
    let last = initial ? `${initial.uiVersion}|${initial.assetBase}` : null;
    let ticks = 0;
    const timer = setInterval(async () => {
      try {
        authorize();
        const latest = await current();
        const key = latest ? `${latest.uiVersion}|${latest.assetBase}` : null;
        if (key && last !== key) {
          last = key;
          if (!response.write(`event: ui-update\ndata: ${JSON.stringify({ uiVersion: latest.uiVersion,
            assetBase: latest.assetBase })}\n\n`)) response.end();
        } else if (++ticks % 8 === 0 && !response.write(': keepalive\n\n')) response.end();
      } catch (error) {
        if (error?.code === 'UNAUTHORIZED' || error?.code === 'FORBIDDEN') response.end();
        // A broken current pointer keeps the last installed version.
      }
    }, 2000);
    clients.add({ response, timer });
    response.once('close', () => {
      clearInterval(timer);
      for (const entry of clients) if (entry.response === response) clients.delete(entry);
    });
  }
  return { current, asset, updates, close() { for (const entry of clients) {
    clearInterval(entry.timer); entry.response.end();
  } clients.clear(); } };
}

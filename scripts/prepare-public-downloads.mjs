import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { qrcodegen } from './vendor/qrcodegen.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_FILES = ['index.html', 'styles.css', 'app.js'];
const PLATFORMS = ['android', 'macos', 'windows', 'ios', 'watchos'];
const NAMES = { android: 'Android', macos: 'Mac', windows: 'Windows', ios: 'iPhone', watchos: 'Apple Watch' };
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+(?:\.\d+){1,3}$/;
const BUILD = /^\d+(?:\.\d+){0,2}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WEB_ENTRY = 'https://home.weftmate.com:8443/personal/v1/ui';
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const MAX_PREVIOUS_INSTALLERS = 32;
const MAX_PREVIOUS_TOTAL_BYTES = 2 * MAX_INSTALLER_BYTES;
const PREVIOUS_FILE = /^([a-f0-9]{64})-([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail(message) { throw new Error(`Public downloads: ${message}`); }

function validNotes(value) {
  return typeof value === 'string' && value.length <= 500 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function siteUrlOf(value) {
  if (typeof value !== 'string') fail('siteUrl must be an HTTPS downloads URL');
  let url;
  try { url = new URL(value); } catch { fail('siteUrl is invalid'); }
  if (url.origin !== 'https://www.weftmate.com' || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/downloads/' || url.href !== value) {
    fail('siteUrl must be the official HTTPS downloads URL');
  }
  return url.href;
}

async function regularFile(file, maxBytes) {
  const entry = await lstat(file).catch(() => null);
  if (!entry?.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > maxBytes) {
    fail(`missing or invalid file: ${path.basename(file)}`);
  }
  return entry;
}

async function sha256File(file, expectedBytes) {
  const before = await regularFile(file, MAX_INSTALLER_BYTES);
  if (before.size !== expectedBytes) fail(`byte count differs: ${path.basename(file)}`);
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size) fail(`file changed while opening: ${path.basename(file)}`);
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) digest.update(chunk);
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      fail(`file changed while hashing: ${path.basename(file)}`);
    }
    return digest.digest('hex');
  } finally { await handle.close(); }
}

async function previousInstallers(directory) {
  if (directory === null) return [];
  const root = await lstat(directory).catch(() => null);
  if (!root?.isDirectory() || root.isSymbolicLink()) fail('previous release directory must be a real directory');
  const filesDirectory = path.join(directory, 'files');
  const filesEntry = await lstat(filesDirectory).catch(() => null);
  if (!filesEntry?.isDirectory() || filesEntry.isSymbolicLink()) {
    fail('previous release files directory must be a real directory');
  }
  const names = await readdir(filesDirectory);
  if (names.length === 0) fail('previous release files directory is empty');
  if (names.length > MAX_PREVIOUS_INSTALLERS) fail(`previous release has more than ${MAX_PREVIOUS_INSTALLERS} installers`);
  let totalBytes = 0;
  const seen = new Set();
  const installers = [];
  for (const name of names) {
    const match = PREVIOUS_FILE.exec(name);
    const extension = path.extname(name).toLowerCase();
    if (!match || name.includes('..') || !['.apk', '.dmg'].includes(extension)) {
      fail(`invalid previous installer filename: ${name}`);
    }
    const file = path.join(filesDirectory, name);
    const entry = await lstat(file).catch(() => null);
    if (!entry?.isFile() || entry.isSymbolicLink()) fail(`previous installer is not a regular file: ${name}`);
    if (entry.size < 1 || entry.size > MAX_INSTALLER_BYTES) fail(`previous installer exceeds the per-file limit: ${name}`);
    totalBytes += entry.size;
    if (totalBytes > MAX_PREVIOUS_TOTAL_BYTES) fail('previous installers exceed the total-byte limit');
    const sha256 = await sha256File(file, entry.size);
    if (sha256 !== match[1]) fail(`previous installer filename SHA-256 differs from its bytes: ${name}`);
    const digestKey = `${sha256}:${extension}`;
    if (seen.has(digestKey)) fail(`duplicate previous installer digest with multiple filenames: ${sha256}`);
    seen.add(digestKey);
    installers.push({ file, fileName: name.slice(65), extension, bytes: entry.size, sha256 });
  }
  return installers;
}

function checkedPlatform(row, allowWebUrl) {
  if (!row || typeof row.id !== 'string' || !PLATFORMS.includes(row.id)) fail('unknown platform');
  if (!validNotes(row.notes)) fail(`invalid notes for ${row.id}`);
  if (row.status === 'available') {
    if (!['android', 'macos'].includes(row.id) ||
        !exact(row, ['id', 'status', 'source', 'expectedBytes', 'expectedSha256',
          'version', 'build', 'architecture', 'notes']) ||
        typeof row.source !== 'string' || !path.isAbsolute(row.source) ||
        !Number.isSafeInteger(row.expectedBytes) || row.expectedBytes < 1 ||
        row.expectedBytes > MAX_INSTALLER_BYTES ||
        typeof row.expectedSha256 !== 'string' || !SHA256.test(row.expectedSha256) ||
        typeof row.version !== 'string' || !VERSION.test(row.version) ||
        typeof row.build !== 'string' || !BUILD.test(row.build) ||
        row.architecture !== (row.id === 'android' ? 'universal' : 'x86_64')) {
      fail(`invalid available release: ${row.id}`);
    }
    const extension = row.id === 'android' ? '.apk' : '.dmg';
    const fileName = path.basename(row.source);
    if (!SAFE_FILE.test(fileName) || !fileName.toLowerCase().endsWith(extension) ||
        fileName.includes('..')) fail(`unsafe source filename: ${row.id}`);
    return { ...row, fileName };
  }
  if (row.status === 'web') {
    if (row.id !== 'windows' || !exact(row, ['id', 'status', 'webUrl', 'notes']) ||
        row.webUrl !== WEB_ENTRY || allowWebUrl !== WEB_ENTRY) fail('Windows web URL is not explicitly allowed');
    return row;
  }
  if (row.status !== 'unavailable' || !['ios', 'watchos'].includes(row.id) ||
      !exact(row, ['id', 'status', 'notes'])) fail(`invalid unavailable platform: ${row.id}`);
  return row;
}

function qrSvg(payload, id) {
  const qr = qrcodegen.QrCode.encodeText(payload, qrcodegen.QrCode.Ecc.MEDIUM);
  const width = qr.size + 8;
  const modules = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) modules.push(`M${x + 4},${y + 4}h1v1h-1z`);
  }
  const escapedPayload = payload.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}" role="img" aria-label="${id} download QR code" shape-rendering="crispEdges">` +
    `<title>WeftMate ${id} download page</title><desc>${escapedPayload}</desc>` +
    `<path fill="#fff" d="M0,0h${width}v${width}H0z"/><path fill="#111" d="${modules.join('')}"/></svg>\n`;
}

export async function preparePublicDownloads({ configPath, output, siteSource = path.resolve(HERE, '../site/downloads'),
  allowWebUrl = null, previousReleaseDir = null }) {
  if (![configPath, output, siteSource].every((value) => typeof value === 'string' && path.isAbsolute(value)) ||
      (previousReleaseDir !== null && (typeof previousReleaseDir !== 'string' || !path.isAbsolute(previousReleaseDir)))) {
    fail('config, output and site source must be absolute paths');
  }
  const configFile = await regularFile(configPath, 64 * 1024);
  if (configFile.size < 2) fail('empty config');
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch { fail('invalid config JSON'); }
  if (!exact(config, ['schemaVersion', 'siteUrl', 'platforms']) || config.schemaVersion !== 1 ||
      !Array.isArray(config.platforms) || config.platforms.length !== PLATFORMS.length) fail('invalid config shape');
  const siteUrl = siteUrlOf(config.siteUrl);
  const rows = config.platforms.map((row) => checkedPlatform(row, allowWebUrl));
  if (new Set(rows.map((row) => row.id)).size !== PLATFORMS.length ||
      PLATFORMS.some((id) => !rows.some((row) => row.id === id))) fail('platform list must contain each supported platform once');
  const retainedInstallers = await previousInstallers(previousReleaseDir);
  const retainedByDigest = new Map(retainedInstallers.map((item) => [`${item.sha256}:${item.extension}`, item]));
  const sourceDir = await lstat(siteSource).catch(() => null);
  if (!sourceDir?.isDirectory() || sourceDir.isSymbolicLink()) fail('site source directory is unavailable');
  for (const file of SITE_FILES) await regularFile(path.join(siteSource, file), 1024 * 1024);
  const verified = new Map();
  for (const row of rows.filter((item) => item.status === 'available')) {
    const actual = await sha256File(row.source, row.expectedBytes);
    if (actual !== row.expectedSha256) fail(`SHA-256 differs: ${row.id}`);
    verified.set(row.id, row);
  }
  const finalOutput = path.resolve(output);
  if (await lstat(finalOutput).catch(() => null)) fail('output directory already exists');
  const parent = path.dirname(finalOutput);
  const parentEntry = await lstat(parent).catch(() => null);
  if (!parentEntry?.isDirectory() || parentEntry.isSymbolicLink()) fail('output parent must already exist');
  const staging = await mkdtemp(path.join(parent, `.${path.basename(finalOutput)}-staging-`));
  if (path.dirname(path.resolve(staging)) !== parent) fail('staging directory escaped output parent');
  try {
    await mkdir(path.join(staging, 'files'));
    await mkdir(path.join(staging, 'qr'));
    for (const file of SITE_FILES) await copyFile(path.join(siteSource, file), path.join(staging, file));
    for (const installer of retainedInstallers) {
      const destination = path.join(staging, 'files', `${installer.sha256}-${installer.fileName}`);
      await copyFile(installer.file, destination);
      if (await sha256File(destination, installer.bytes) !== installer.sha256) {
        fail(`retained installer copy differs: ${installer.fileName}`);
      }
    }
    const platforms = [];
    for (const id of PLATFORMS) {
      const row = rows.find((item) => item.id === id);
      const landingUrl = new URL(`?platform=${id}`, siteUrl).href;
      const qrUrl = `qr/${id}.svg`;
      await writeFile(path.join(staging, qrUrl), qrSvg(landingUrl, id), { flag: 'wx' });
      const entry = { id, name: NAMES[id], status: row.status, notes: row.notes, landingUrl, qrUrl };
      if (row.status === 'available') {
        const extension = id === 'android' ? '.apk' : '.dmg';
        const retained = retainedByDigest.get(`${row.expectedSha256}:${extension}`);
        if (retained && retained.bytes !== row.expectedBytes) fail(`retained installer byte count differs: ${id}`);
        const file = retained
          ? `files/${retained.sha256}-${retained.fileName}`
          : `files/${row.expectedSha256}-${row.fileName}`;
        if (!retained) {
          await copyFile(row.source, path.join(staging, file));
          if (await sha256File(path.join(staging, file), row.expectedBytes) !== row.expectedSha256) {
            fail(`copied installer differs: ${id}`);
          }
        }
        Object.assign(entry, { version: row.version, build: row.build,
          architecture: row.architecture, bytes: row.expectedBytes,
          sha256: row.expectedSha256, downloadUrl: file });
      } else if (row.status === 'web') entry.webUrl = row.webUrl;
      platforms.push(entry);
    }
    const manifest = { schemaVersion: 1, siteUrl, generatedAt: new Date().toISOString(), platforms };
    await writeFile(path.join(staging, 'releases.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await rename(staging, finalOutput);
    return manifest;
  } catch (error) {
    if (path.dirname(path.resolve(staging)) === parent) await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function argumentsFrom(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--config', '--output', '--site-source', '--allow-web-url', '--previous-release-dir'].includes(argv[i]) ||
        typeof argv[i + 1] !== 'string' || Object.hasOwn(values, argv[i])) fail('invalid arguments');
    if (argv[i] === '--previous-release-dir' && argv[i + 1].length === 0) fail('previous release directory must not be empty');
    values[argv[i]] = argv[i + 1];
  }
  if (!values['--config'] || !values['--output']) fail('--config and --output are required');
  return { configPath: path.resolve(values['--config']), output: path.resolve(values['--output']),
    ...(values['--site-source'] ? { siteSource: path.resolve(values['--site-source']) } : {}),
    ...(values['--previous-release-dir'] ? { previousReleaseDir: path.resolve(values['--previous-release-dir']) } : {}),
    allowWebUrl: values['--allow-web-url'] ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  preparePublicDownloads(argumentsFrom(process.argv.slice(2))).then((manifest) => {
    process.stdout.write(JSON.stringify({ output: path.resolve(argumentsFrom(process.argv.slice(2)).output),
      siteUrl: manifest.siteUrl, available: manifest.platforms.filter((item) => item.status === 'available')
        .map((item) => ({ id: item.id, bytes: item.bytes, sha256: item.sha256 })) }) + '\n');
  }, (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

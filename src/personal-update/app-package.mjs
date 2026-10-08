import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { downloadBytes } from './store.mjs';
import { verifyManifest } from './manifest.mjs';

export async function readAppUpdateManifest(feed, appVersion, channel = 'stable') {
  const trustedKeys = JSON.parse(await readFile(new URL('./trusted-keys.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse((await downloadBytes(new URL('manifest-app.json', feed.endsWith('/') ? feed : feed + '/').href, 1024 * 1024)).toString('utf8'));
  return verifyManifest(manifest, trustedKeys, { layer: 'app', channel, versions: { app: appVersion, host: appVersion } });
}
export async function verifyDownloadedApp(manifest, file) {
  const expected = manifest.files.find(row => row.path === basename(file));
  if (!expected) throw new Error('signature installer is not in manifest');
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(file)) { size += chunk.length; hash.update(chunk); }
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error('hash installer invalid');
}

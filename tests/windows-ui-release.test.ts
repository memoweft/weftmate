import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { previousWindowsUiManifest } from '../scripts/release/windows.mjs';

test('Windows release reads the previous UI separately from the app manifest', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fix-update2-previous-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ui = { layer: 'ui', version: '0.2.0-preview.13' };
  const file = join(root, 'manifest-ui.json'); await writeFile(file, JSON.stringify(ui));
  const offline = async () => { throw Error('unexpected network request'); };
  assert.deepEqual(await previousWindowsUiManifest({ 'previous-ui': file }, 'preview', offline), ui);
  assert.deepEqual(await previousWindowsUiManifest({ previous: join(root, 'manifest-app.json') }, 'preview', offline), ui);
  assert.equal(await previousWindowsUiManifest({ 'test-identity': 'fixupdate2qa' }, 'preview', offline), null);
  await rm(file);
  const urls: string[] = [];
  assert.deepEqual(await previousWindowsUiManifest({}, 'preview', async (url: URL) => { urls.push(String(url)); return new Response(JSON.stringify(ui)); }), ui);
  assert.match(urls[0], /\/preview\/manifest-ui\.json$/);
  assert.equal(await previousWindowsUiManifest({}, 'stable', async () => new Response('', { status: 404 })), null);
  await assert.rejects(previousWindowsUiManifest({}, 'preview', async () => new Response('', { status: 503 })), /download failed/);
});

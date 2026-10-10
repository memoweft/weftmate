// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Isolated same-owner Android sync fixture. No DSH, model, or desktop execution. */
import { existsSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { ensurePrivateDirectory, ensurePrivateFile } from '../../src/private-host-storage.mjs';

const DEFAULT_ROOT = 'D:\\AIProjects\\WeftMate\\Runtime\\UnifiedAssistant\\android-sync-fixture-20260926';
const MARKER = 'weftmate-android-sync-fixture-v1';
const USERNAME = 'android-acceptance';
const PASSWORD = 'synthetic android password 123';
const rootArg = process.argv.find((arg) => arg.startsWith('--profile='));
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
if (process.argv.slice(2).some((arg) => !arg.startsWith('--profile=') && !arg.startsWith('--port=')) ||
    process.argv.filter((arg) => arg.startsWith('--profile=')).length > 1 ||
    process.argv.filter((arg) => arg.startsWith('--port=')).length > 1) {
  throw new Error('usage: node tests/integration/personal-sync-host.mjs [--profile=<isolated absolute path>] [--port=18187]');
}
const profile = path.resolve(rootArg?.slice('--profile='.length) ?? DEFAULT_ROOT);
const port = Number(portArg?.slice('--port='.length) ?? '18187');
if (!path.isAbsolute(profile) || !Number.isInteger(port) || port < 0 || port > 65535 ||
    !path.basename(profile).startsWith('android-sync-fixture-')) throw new Error('isolated profile or port is invalid');
const markerPath = path.join(profile, 'sync-fixture.marker');
if (existsSync(profile) && !existsSync(markerPath)) throw new Error('existing unmarked profile is refused');
await ensurePrivateDirectory(profile);
if (!existsSync(markerPath)) {
  const marker = await open(markerPath, 'wx', 0o600);
  try { await marker.writeFile(MARKER, 'utf8'); await marker.sync(); } finally { await marker.close(); }
}
await ensurePrivateFile(markerPath);
if ((await readFile(markerPath, 'utf8')) !== MARKER) throw new Error('profile marker mismatch');

const unavailable = () => { const error = new Error('fixture has no DSH'); error.code = 'RUNTIME_UNAVAILABLE'; throw error; };
const backend = {
  getStatus: async () => ({ runtime: 'unavailable', referenceScan: 'pending',
    capabilities: { chat: { available: false, reasonCode: 'RUNTIME_UNAVAILABLE' },
      desktopOpenApp: { available: false, appIds: [] }, naturalLanguageDesktop: { available: false } } }),
  listModels: async () => [], preflight: unavailable, createSession: unavailable,
  sendMessage: unavailable, cancelSession: unavailable, readEvents: unavailable, describeSession: unavailable,
};
const service = await createPersonalAccessService({ root: path.join(profile, 'personal-access'), port, backend,
  uiHandler: servePersonalAccessUi });
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  input.close();
  await service.close();
  console.log('[sync-fixture] stopped');
};
const input = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
input.on('line', (line) => { if (line.trim().toLowerCase() === 'q') void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
try {
  const { origin } = await service.start();
  const state = await (await fetch(`${origin}/personal/v1/auth/state`)).json();
  if (state.configured !== true) {
    const grant = await service.issueSetupGrant();
    const response = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: USERNAME, password: PASSWORD, deviceName: 'PC fixture' }) });
    if (response.status !== 201) throw new Error('synthetic fixture account setup failed');
  }
  console.log(`[sync-fixture] ready origin=${origin} profile=${profile} username=${USERNAME}`);
  console.log('[sync-fixture] enter q to close cleanly');
} catch (error) {
  await shutdown();
  throw error;
}

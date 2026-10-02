/** Explicit isolated Windows catalog registration: nine directories, zero inference requests. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listFormalLocalModels } from '../../src/local-model-config.mjs';

if (process.env.WEFTMATE_REAL_LOCAL_CATALOG_E2E !== '1' || process.platform !== 'win32') {
  throw new Error('Set WEFTMATE_REAL_LOCAL_CATALOG_E2E=1 on Windows for this no-inference integration test.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const priorMiniPlus = process.env.WEFTMATE_CATALOG_PRIOR_MINIPLUS === '1';
const root = mkdtempSync(join(tmpdir(), 'weftmate-local-catalog-e2e-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
let output = '';
let child;
function start() {
  const running = spawn(process.execPath, [join(repository, 'scripts', 'run-personal-host.mjs'),
    '--user-data-dir', profile, '--access-port', '0'], { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] });
  for (const stream of [running.stdout, running.stderr]) stream.on('data', (part) => { output += String(part); });
  return running;
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.stdin.write('q\n');
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('isolated host close timeout')), 15_000))]);
  assert.equal(child.exitCode, 0);
}
async function waitFor(pattern, startAt = 0, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = pattern.exec(output.slice(startAt));
    if (match) return match;
    if (child.exitCode !== null) throw new Error(`isolated host exited ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('isolated host readiness timeout');
}
async function manage() {
  const position = output.length;
  child.stdin.write('{"action":"model.configure-local-catalog"}\n');
  return waitFor(/localCatalog count=9 added=(\d+) reused=(\d+) reloads=(\d+) verification=catalog_only inferenceVerified=false/, position, 90_000);
}
try {
  const formal = await listFormalLocalModels();
  assert.equal(formal.length, 9);
  child = start();
  const origin = (await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/))[1];
  if (priorMiniPlus) {
    const position = output.length;
    child.stdin.write('{"action":"model.configure-local","modelId":"occamy-miniplus-v21"}\n');
    await waitFor(/modelId=occamy-miniplus-v21 profileId=personal-local-occamy-miniplus-v21 verification=catalog_only inferenceVerified=false/, position);
  }
  const first = await manage();
  assert.deepEqual(first.slice(1, 4).map(Number), priorMiniPlus ? [8, 1, 1] : [9, 0, 1]);
  const expectedBoots = priorMiniPlus ? 3 : 2;
  assert.equal([...output.matchAll(/dsh web: http:\/\/127\.0\.0\.1:\d+/g)].length, expectedBoots,
    'the catalog itself adds exactly one reload');
  const account = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'SyntheticCatalog', password: 'synthetic catalog password 123', deviceName: 'Fixture' }) });
  assert.equal(account.status, 201);
  const authReceipt = await account.json();
  const cookie = account.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const models = (await (await fetch(`${origin}/personal/v1/models`, { headers: { cookie } })).json()).models;
  assert.equal(models.length, 9);
  assert.equal(models.filter((item) => item.configured && item.source === 'host' && item.sourceKind === 'local').length, 9);
  assert.deepEqual(models.map((item) => item.model).sort(), formal.map((item) => item.modelId).sort());
  const status = await (await fetch(`${origin}/personal/v1/status`, { headers: { cookie } })).json();
  const dottedProfile = 'personal-local-qwen3.8-27b-u';
  const created = await fetch(`${origin}/personal/v1/commands`, { method: 'POST',
    headers: { cookie, origin, 'x-weftmate-csrf': authReceipt.csrfToken, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'catalog-dotted-create', kind: 'session.create',
      targetDeviceId: status.hostId, modelProfileId: dottedProfile }) });
  assert.equal(created.status, 202);
  const commandId = (await created.json()).command.commandId;
  let createdCommand;
  for (let attempt = 0; attempt < 80; attempt++) {
    createdCommand = (await (await fetch(`${origin}/personal/v1/commands/${commandId}`, { headers: { cookie } })).json()).command;
    if (!['pending', 'dispatching'].includes(createdCommand.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(createdCommand.state, 'accepted_by_dsh');
  const ownerSessions = (await (await fetch(`${origin}/personal/v1/sessions`, { headers: { cookie } })).json()).sessions;
  assert.equal(ownerSessions.find((item) => item.sessionId === createdCommand.sessionId)?.sendAvailable, true);
  const settings = JSON.parse(readFileSync(join(profile, 'weftmate-settings.json'), 'utf8'));
  assert.equal(settings.models.activeId, 'personal-local-occamy-miniplus-v21');
  assert.equal(settings.sessionBindings?.[createdCommand.sessionId]?.profileId, dottedProfile);
  assert.equal(Object.keys(settings.sessionBindings ?? {}).length, 1);
  let dshOrigin;
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) dshOrigin = match[1];
  const dshSessions = (await (await fetch(`${dshOrigin}/weftmate/api/v1/sessions`)).json()).items;
  assert.equal(dshSessions.find((item) => item.sessionId === createdCommand.sessionId)?.agentPreset,
    'personal-shared-chat');
  const sharedPreset = readFileSync(join(profile, 'dsh-home', '.agent-presets',
    'personal-shared-chat', 'agent.cordis.yml'), 'utf8');
  assert.match(sharedPreset, /includeRuntimeContext: false/);
  assert.match(sharedPreset, /weftmate-personal-shared-chat-preset\.mjs/);
  assert.doesNotMatch(sharedPreset, /personal_open_notepad|weftmod|pwsh|weftmate-memory/);
  const accessStatus = (await (await fetch(`${origin}/personal/v1/status`, { headers: { cookie } })).json());
  assert.equal(accessStatus.backend.modules.memory, 'disabled');
  const [{ createOfficialDshSettingsClient }, { routeForProfile }] = await Promise.all([
    import(pathToFileURL(join(repository, 'src', 'dsh-settings-migration.ts')).href),
    import(pathToFileURL(join(repository, 'src', 'harness-model-routes.ts')).href),
  ]);
  const official = await createOfficialDshSettingsClient({ origin: dshOrigin }).describeSettings();
  for (const item of formal) {
    const route = routeForProfile(`personal-local-${item.modelId}`).provider;
    const model = official.userProviders[route]?.models?.[0];
    assert.equal(model?.id, item.modelId);
    assert.equal(model?.contextWindow, item.contextWindow);
    assert.equal(model?.maxTokens, item.outputReserve);
  }
  const selected = await fetch(`${dshOrigin}/weftmate/api/v1/sessions/${createdCommand.sessionId}/models`);
  assert.equal((await selected.json()).current?.model, 'qwen3.8-27b-u');
  const second = await manage();
  assert.deepEqual(second.slice(1, 4).map(Number), [0, 9, 0]);
  assert.equal([...output.matchAll(/dsh web: http:\/\/127\.0\.0\.1:\d+/g)].length, expectedBoots);
  await stop();
  output = '';
  child = start();
  const cold = (await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/))[1];
  const coldModels = (await (await fetch(`${cold}/personal/v1/models`, { headers: { cookie } })).json()).models;
  assert.equal(coldModels.length, 9);
  assert.equal(coldModels.every((item) => item.configured), true);
  assert.equal(JSON.parse(readFileSync(join(profile, 'weftmate-settings.json'), 'utf8')).models.activeId,
    'personal-local-occamy-miniplus-v21');
  console.log('[personal-local-catalog] nine formal routes, one reload, idempotent retry and cold restart verified; no inference');
} finally {
  await stop().catch(() => { child?.kill(); });
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}

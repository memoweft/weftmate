/** Explicit Windows integration test. Reads the existing 8081 catalog; sends no inference request. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.WEFTMATE_REAL_LOCAL_MODEL_E2E !== '1' || process.platform !== 'win32') {
  throw new Error('Set WEFTMATE_REAL_LOCAL_MODEL_E2E=1 on the Windows host to run this isolated test.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'weftmate-local-model-e2e-'));
const profile = join(root, 'profile');
let output = '';
function startHost() {
  const running = spawn(process.execPath, [join(repository, 'scripts', 'run-personal-host.mjs'),
    '--user-data-dir', profile, '--access-port', '0'], { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] });
  for (const stream of [running.stdout, running.stderr]) stream.on('data', (chunk) => { output += String(chunk); });
  return running;
}
let child = startHost();

async function stopHost() {
  if (child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once('close', resolve));
  child.stdin.write('q\n');
  await Promise.race([stopped, new Promise((_, reject) => setTimeout(() => reject(new Error('host close timed out')), 15_000))]);
  assert.equal(child.exitCode, 0);
}

async function waitFor(pattern, start = 0, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = pattern.exec(output.slice(start));
    if (match) return match;
    if (child.exitCode !== null) throw new Error(`isolated host exited ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('isolated host did not report readiness');
}

async function manage(command, pattern) {
  const start = output.length;
  child.stdin.write(`${JSON.stringify(command)}\n`);
  return waitFor(pattern, start);
}

let passed = false;
try {
  const started = await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/);
  const accessOrigin = started[1];
  await manage({ action: 'model.configure-local', modelId: 'occamy-miniplus-v21' },
    /modelId=occamy-miniplus-v21 profileId=personal-local-occamy-miniplus-v21 verification=catalog_only inferenceVerified=false/);
  const setup = await manage({ action: 'account.setup' }, /setupLinkFile=([^\s]+) expiresAt=/);
  const setupUrl = new URL(JSON.parse(readFileSync(setup[1], 'utf8')).url);
  const grant = decodeURIComponent(setupUrl.hash.slice('#setup='.length));
  const createdAccount = await fetch(`${accessOrigin}/personal/v1/auth/setup`, { method: 'POST',
    headers: { origin: accessOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant, username: 'SyntheticOwner',
      password: 'synthetic long passphrase 12345', deviceName: 'SyntheticPhone' }) });
  assert.equal(createdAccount.status, 201);
  const owner = await createdAccount.json();
  const cookie = createdAccount.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const auth = { cookie };
  const status = await (await fetch(`${accessOrigin}/personal/v1/status`, { headers: auth })).json();
  assert.equal(status.backend.capabilities.chat.available, true);
  assert.equal(status.backend.capabilities.chat.inferenceVerified, false);
  const catalog = await (await fetch(`${accessOrigin}/personal/v1/models`, { headers: auth })).json();
  assert.ok(catalog.models.some((item) => item.id === 'personal-local-occamy-miniplus-v21' && item.configured));
  const submitted = await fetch(`${accessOrigin}/personal/v1/commands`, { method: 'POST',
    headers: { ...auth, origin: accessOrigin, 'x-weftmate-csrf': owner.csrfToken,
      'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'synthetic-create-1', kind: 'session.create',
      targetDeviceId: status.hostId, modelProfileId: 'personal-local-occamy-miniplus-v21' }) });
  assert.equal(submitted.status, 202);
  const commandId = (await submitted.json()).command.commandId;
  let command;
  for (let attempt = 0; attempt < 100; attempt++) {
    command = (await (await fetch(`${accessOrigin}/personal/v1/commands/${commandId}`, { headers: auth })).json()).command;
    if (!['pending', 'dispatching'].includes(command.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(command.state, 'accepted_by_dsh');
  const sessions = await (await fetch(`${accessOrigin}/personal/v1/sessions`, { headers: auth })).json();
  assert.equal(sessions.sessions.find((item) => item.sessionId === command.sessionId)?.sendAvailable, true);
  let dshOrigin;
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) dshOrigin = match[1];
  assert.ok(dshOrigin);
  const selected = await fetch(`${dshOrigin}/weftmate/api/v1/sessions/${command.sessionId}/models`);
  assert.equal(selected.status, 200);
  const model = await selected.json();
  assert.equal(model.current?.model, 'occamy-miniplus-v21');
  assert.match(model.current?.provider ?? '', /^weftmate-/);
  const [{ createOfficialDshSettingsClient }, { routeForProfile }] = await Promise.all([
    import(pathToFileURL(join(repository, 'src', 'dsh-settings-migration.ts')).href),
    import(pathToFileURL(join(repository, 'src', 'harness-model-routes.ts')).href),
  ]);
  const routeId = routeForProfile('personal-local-occamy-miniplus-v21').provider;
  const official = await createOfficialDshSettingsClient({ origin: dshOrigin }).describeSettings();
  const projected = official.userProviders[routeId]?.models?.[0];
  assert.equal(projected?.contextWindow, 262144);
  assert.equal(projected?.maxTokens, 16384);
  const markerPath = join(profile, 'dsh-home', 'weftmate-stage2-official-routes-migration.json');
  assert.ok(JSON.parse(readFileSync(markerPath, 'utf8')).routes.includes(routeId));
  // Reproduce the interrupted live create: product binding remains MiniPlus,
  // while the native empty session has not selected its model yet.
  const rpcId = randomUUID();
  const resetSelection = await (await fetch(`${dshOrigin}/api/session.selectModel`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'session.selectModel',
      payload: { sessionId: command.sessionId, provider: 'deepseek-official', model: 'deepseek-v4-flash' } }),
  })).json();
  assert.equal(resetSelection.rpcId, rpcId);
  assert.equal(resetSelection.result?.ok, true);
  const historyRpcId = randomUUID();
  const emptyHistory = await (await fetch(`${dshOrigin}/api/session.history`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: historyRpcId, method: 'session.history',
      payload: { sessionId: command.sessionId, maxMessages: 20 } }),
  })).json();
  assert.equal(emptyHistory.rpcId, historyRpcId);
  assert.equal(emptyHistory.result?.ok, true);
  assert.equal(emptyHistory.result.value.hasMore, false);
  assert.ok(emptyHistory.result.value.events.every(({ event }) =>
    !['user/message', 'assistant/message', 'turn/start', 'turn/end'].includes(event.type)));
  await new Promise((resolve) => setTimeout(resolve, 1_000)); // rc.5 persists an empty session asynchronously.
  await stopHost();
  output = '';
  child = startHost();
  const restarted = await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/);
  const restartedAccessOrigin = restarted[1];
  let restartedDshOrigin;
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) restartedDshOrigin = match[1];
  assert.ok(restartedDshOrigin);
  const coldModels = await fetch(`${restartedDshOrigin}/weftmate/api/v1/sessions/${command.sessionId}/models`);
  assert.equal(coldModels.status, 200);
  const coldSelection = (await coldModels.json()).current;
  assert.equal(coldSelection?.provider, 'deepseek-official');
  assert.equal(coldSelection?.model, 'deepseek-v4-flash');
  const coldSettings = await createOfficialDshSettingsClient({ origin: restartedDshOrigin }).describeSettings();
  assert.equal(coldSettings.userProviders[routeId]?.models?.[0]?.maxTokens, 16384);
  const coldSessions = await (await fetch(`${restartedAccessOrigin}/personal/v1/sessions`, { headers: auth })).json();
  assert.equal(coldSessions.sessions.find((item) => item.sessionId === command.sessionId)?.sendAvailable, true);
  // Simulate only the prior WeftMate fixed-limit projection inside this
  // disposable profile. The managed command must repair that exact owned row
  // while the restored session is cold; it must not require Gateway resume.
  const coldClient = createOfficialDshSettingsClient({ origin: restartedDshOrigin });
  const staleRoute = { ...coldSettings.userProviders[routeId], models: [{
    ...coldSettings.userProviders[routeId].models[0], maxTokens: 32768,
  }] };
  await coldClient.mutateSettings([{ op: 'set', path: ['providers', routeId], value: staleRoute }], coldSettings.revision);
  await manage({ action: 'model.configure-local', modelId: 'occamy-miniplus-v21' },
    /modelId=occamy-miniplus-v21 profileId=personal-local-occamy-miniplus-v21 verification=catalog_only inferenceVerified=false/);
  let repairedDshOrigin;
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) repairedDshOrigin = match[1];
  assert.ok(repairedDshOrigin);
  const repairedSettings = await createOfficialDshSettingsClient({ origin: repairedDshOrigin }).describeSettings();
  assert.equal(repairedSettings.userProviders[routeId]?.models?.[0]?.maxTokens, 16384);
  const afterRepair = await (await fetch(`${restartedAccessOrigin}/personal/v1/sessions`, { headers: auth })).json();
  assert.equal(afterRepair.sessions.find((item) => item.sessionId === command.sessionId)?.sendAvailable, true);
  passed = true;
  process.stdout.write(`${JSON.stringify({ verified: 'catalog_only_create',
    commandState: command.state, sendAvailable: true, coldRestartVerified: true, staleLimitsRepaired: true,
    model: model.current.model, contextWindow: projected.contextWindow,
    maxTokens: projected.maxTokens, inferenceSent: false })}\n`);
} finally {
  if (child.exitCode === null) await stopHost();
  if (passed && process.env.WEFTMATE_KEEP_E2E_PROFILE !== '1' &&
      child.exitCode !== null && dirname(realpathSync(root)) === realpathSync(tmpdir())) {
    rmSync(root, { recursive: true, force: true });
  } else process.stderr.write(`Isolated fixture retained: ${profile}\n`);
}

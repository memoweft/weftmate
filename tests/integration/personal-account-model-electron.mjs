/** Opt-in isolated Electron + pinned DSH account model route, without inference. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeForProfile } from '../../src/harness-model-routes.ts';
import { officialCredentialRef } from '../../src/dsh-settings-migration.ts';

if (process.platform !== 'win32' || process.env.WEFTMATE_SYNTHETIC_ACCOUNT_MODEL_E2E !== '1') {
  throw new Error('Set WEFTMATE_SYNTHETIC_ACCOUNT_MODEL_E2E=1 on Windows.');
}
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-account-model-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
const secret = randomBytes(24).toString('hex');
const modelId = 'synthetic-account-model';
let discovery = 0, inference = 0;
const inferenceModels = [];
const upstream = createServer((request, response) => {
  if (request.url === '/v1/models' && request.method === 'GET') {
    discovery++;
    if (request.headers.authorization !== `Bearer ${secret}`) { response.writeHead(401).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [modelId, `${modelId}-v2`]
      .map((id) => ({ id, object: 'model' })) }));
    return;
  }
  if (request.url === '/v1/chat/completions' && request.method === 'POST') {
    inference++;
    if (request.headers.authorization !== `Bearer ${secret}`) { response.writeHead(401).end(); return; }
    let raw = '';
    request.on('data', (chunk) => { raw += String(chunk); });
    request.on('end', () => {
      inferenceModels.push(JSON.parse(raw).model);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {"id":"fixture","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
assert.ok(address && typeof address !== 'string');
let child, output = '';
function start() {
  const running = spawn(process.execPath, [join(repository, 'scripts', 'run-personal-host.mjs'),
    '--user-data-dir', profile, '--access-port', '0'],
  { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] });
  for (const stream of [running.stdout, running.stderr]) stream.on('data', (part) => { output += String(part); });
  return running;
}
async function waitFor(pattern, from = 0, limitMs = 90_000) {
  const end = Date.now() + limitMs;
  while (Date.now() < end) {
    const match = pattern.exec(output.slice(from));
    if (match) return match;
    if (child.exitCode !== null) throw new Error(`isolated host exited ${child.exitCode}; ` +
      output.slice(-1200).replaceAll(secret, '[redacted]'));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('isolated host readiness timeout');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.stdin.write('q\n');
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('host stop timeout')), 20_000))]);
  assert.equal(child.exitCode, 0);
}
async function api(origin, auth, method, route, body) {
  const response = await fetch(`${origin}${route}`, { method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
async function defaultSelection(origin) {
  const rpcId = randomUUID();
  const response = await fetch(`${origin}/api/host.describe`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'host.describe', payload: {} }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.rpcId, rpcId);
  assert.equal(result.result?.ok, true);
  return { provider: result.result.value.provider, model: result.result.value.model };
}
async function settled(origin, auth, requestId) {
  for (let attempt = 0; attempt < 450; attempt++) {
    const value = await api(origin, auth, 'GET', `/personal/v1/account/models/by-request/${requestId}`);
    if (!['pending', 'applying'].includes(value.body.operation?.status)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('account model registration did not settle');
}
try {
  child = start();
  let accessOrigin = (await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/))[1];
  let runtimeOrigin;
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) runtimeOrigin = match[1];
  assert.ok(runtimeOrigin);
  const before = await defaultSelection(runtimeOrigin);
  const productSettingsFile = join(profile, 'weftmate-settings.json');
  const productDefaultBefore = existsSync(productSettingsFile)
    ? JSON.parse(readFileSync(productSettingsFile, 'utf8')).models.activeId : null;
  const login = { username: 'AccountModelA', password: `synthetic-${randomUUID()}-password` };
  const registered = await fetch(`${accessOrigin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin: accessOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ ...login, deviceName: 'Fixture A' }) });
  assert.equal(registered.status, 201);
  const account = await registered.json();
  const auth = { origin: accessOrigin, cookie: registered.headers.get('set-cookie').split(';')[0],
    'x-weftmate-csrf': account.csrfToken };
  const created = await api(accessOrigin, auth, 'POST', '/personal/v1/account/models', {
    requestId: 'real-dsh-route-create', name: 'Synthetic Account',
    baseUrl: `http://127.0.0.1:${address.port}/v1/chat/completions`, modelId, apiKey: secret });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const installed = await settled(accessOrigin, auth, 'real-dsh-route-create');
  assert.equal(installed.body.operation.status, 'succeeded', JSON.stringify(installed.body));
  assert.equal(installed.body.model.baseUrl, `http://127.0.0.1:${address.port}/v1`);
  assert.equal(installed.body.model.configured, true);
  assert.equal(JSON.stringify(installed.body).includes(secret), false);
  assert.ok(discovery >= 0);
  const current = (await api(accessOrigin, auth, 'GET', '/personal/v1/models')).body.models;
  assert.equal(current.filter((item) => item.id === installed.body.model.profileId).length, 1);
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) runtimeOrigin = match[1];
  assert.deepEqual(await defaultSelection(runtimeOrigin), before);
  assert.equal(JSON.parse(readFileSync(productSettingsFile, 'utf8')).models.activeId, productDefaultBefore);
  const status = (await api(accessOrigin, auth, 'GET', '/personal/v1/status')).body;
  const session = await api(accessOrigin, auth, 'POST', '/personal/v1/commands', {
    requestId: 'private-session', kind: 'session.create', targetDeviceId: status.hostId,
    modelProfileId: installed.body.model.profileId });
  assert.equal(session.status, 202, JSON.stringify(session.body));
  let command;
  for (let attempt = 0; attempt < 150; attempt++) {
    command = (await api(accessOrigin, auth, 'GET',
      `/personal/v1/commands/${session.body.command.commandId}`)).body.command;
    if (!['pending', 'dispatching'].includes(command.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(command.state, 'accepted_by_dsh', JSON.stringify(command));
  assert.deepEqual(await defaultSelection(runtimeOrigin), before);
  assert.equal(JSON.parse(readFileSync(productSettingsFile, 'utf8')).models.activeId, productDefaultBefore);
  const changed = await api(accessOrigin, auth, 'PATCH',
    `/personal/v1/account/models/${installed.body.model.accountModelId}`, {
      requestId: 'new-runtime-revision', expectedRevision: 1, modelId: `${modelId}-v2` });
  assert.equal(changed.status, 202, JSON.stringify(changed.body));
  const revised = await settled(accessOrigin, auth, 'new-runtime-revision');
  assert.equal(revised.body.operation.status, 'succeeded', JSON.stringify(revised.body));
  assert.notEqual(revised.body.model.profileId, installed.body.model.profileId);
  assert.equal(revised.body.model.revision, 2);
  const visible = (await api(accessOrigin, auth, 'GET', '/personal/v1/models')).body.models;
  assert.equal(visible.some((item) => item.id === revised.body.model.profileId), true);
  assert.equal(visible.some((item) => item.id === installed.body.model.profileId), false);
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) runtimeOrigin = match[1];
  const oldGoal = await api(accessOrigin, auth, 'POST', '/personal/v1/commands', {
    requestId: 'old-revision-send', kind: 'session.message', targetDeviceId: status.hostId,
    sessionId: command.sessionId, text: 'Synthetic old-revision probe' });
  assert.equal(oldGoal.status, 202, JSON.stringify(oldGoal.body));
  for (let attempt = 0; attempt < 150 && inferenceModels.length === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (inferenceModels.length === 0) {
    const actual = (await api(accessOrigin, auth, 'GET',
      `/personal/v1/commands/${oldGoal.body.command.commandId}`)).body.command;
    const dshList = await (await fetch(`${runtimeOrigin}/weftmate/api/v1/sessions`)).json();
    const dshRow = dshList.items?.find((item) => item.sessionId === command.sessionId);
    const binding = JSON.parse(readFileSync(join(profile, 'weftmate-settings.json'), 'utf8'))
      .sessionBindings?.[command.sessionId]?.profileId;
    const ref = officialCredentialRef(routeForProfile(installed.body.model.profileId).provider);
    const rpcId = randomUUID();
    const credentialReply = await (await fetch(`${runtimeOrigin}/api/credentials.describe`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'credentials.describe',
        payload: { refs: [ref] } }) })).json();
    const credential = credentialReply.result?.value?.credentials?.[ref]?.configured;
    throw new Error(`old revision did not reach synthetic provider: command=${actual?.state}/${actual?.errorCode ?? 'none'}; ` +
      `dsh=${(await (await fetch(`${runtimeOrigin}/weftmate/api/v1/sessions/${command.sessionId}/models`)).json()).current?.model ?? 'missing'}; ` +
      `listed=${!!dshRow}/${dshRow?.agentPreset ?? 'none'}; binding=${binding}; credential=${credential}; ` +
      `tail=${output.slice(-420).replaceAll(secret, '[redacted]')}`);
  }
  assert.equal(inferenceModels[0], modelId,
    'a previously bound session routes its next prompt to the original model');
  const historical = await fetch(`${runtimeOrigin}/weftmate/api/v1/sessions/${command.sessionId}/models`);
  assert.equal(historical.status, 200);
  assert.equal((await historical.json()).current.model, modelId);
  assert.deepEqual(await defaultSelection(runtimeOrigin), before);
  assert.equal(JSON.parse(readFileSync(productSettingsFile, 'utf8')).models.activeId, productDefaultBefore);
  assert.ok(inference >= 1 && inference <= 3,
    'only the explicit synthetic turn and its bounded title request may call the provider');
  assert.equal(inferenceModels.every((item) => item === modelId), true);
  const beforeColdInference = inference;
  await stop();
  output = '';
  child = start();
  accessOrigin = (await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/))[1];
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) runtimeOrigin = match[1];
  assert.deepEqual(await defaultSelection(runtimeOrigin), before);
  const cold = (await api(accessOrigin, { ...auth, origin: accessOrigin }, 'GET',
    '/personal/v1/account/models')).body.models;
  assert.equal(cold[0].profileId, revised.body.model.profileId);
  assert.equal(cold[0].revision, 2);
  assert.equal(cold[0].configured, true);
  const other = await fetch(`${accessOrigin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin: accessOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'AccountModelB', password: `synthetic-${randomUUID()}-password`,
      deviceName: 'Fixture B' }) });
  assert.equal(other.status, 201);
  const otherAuth = { origin: accessOrigin, cookie: other.headers.get('set-cookie').split(';')[0] };
  assert.equal((await api(accessOrigin, otherAuth, 'GET', '/personal/v1/account/models')).body.models.length, 0);
  assert.equal((await api(accessOrigin, otherAuth, 'GET', '/personal/v1/models')).body.models
    .some((item) => item.id === revised.body.model.profileId), false);
  const stopped = await api(accessOrigin, { ...auth, origin: accessOrigin }, 'POST',
    `/personal/v1/account/models/${revised.body.model.accountModelId}/stop-using`,
    { requestId: 'stop-private-model', expectedRevision: 2 });
  assert.equal(stopped.status, 202, JSON.stringify(stopped.body));
  const stopResult = await settled(accessOrigin, { ...auth, origin: accessOrigin }, 'stop-private-model');
  assert.equal(stopResult.body.operation.status, 'succeeded', JSON.stringify(stopResult.body));
  assert.equal(stopResult.body.model.status, 'stopped');
  assert.equal((await api(accessOrigin, { ...auth, origin: accessOrigin },
    'GET', '/personal/v1/models')).body.models.some((item) => item.id === revised.body.model.profileId), false);
  for (const match of output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)) runtimeOrigin = match[1];
  assert.deepEqual(await defaultSelection(runtimeOrigin), before);
  assert.equal(inference, beforeColdInference);
  console.log('[personal-account-model] owner route, immutable revision, DSH default and cold config verified; synthetic turn only');
} finally {
  await stop().catch(() => { child?.kill(); });
  await new Promise((resolve) => upstream.close(resolve));
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
  rmSync(root, { recursive: true, force: true });
}

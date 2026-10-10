import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentChatProfile, selectBackgroundProfile, backgroundModelReady } from '../src/background-model-selection.mjs';
import { checkModelConnection, canonicalProviderModelId } from '../src/model-connection-check.mjs';
import { createHostLog } from '../src/host-log.mjs';
import { createModelScheduler } from '../src/model-scheduler.mjs';
import { acquireModelSlot } from '../src/model-scheduler-client.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';

test('background selection follows session or account recent chat, never startup authRef', () => {
  const profiles = [{ id: 'muse' }, { id: 'occamy' }, { id: 'cloud' }];
  const account = { sessions: { old: { modelProfileId: 'occamy' }, latest: { modelProfileId: 'muse' } }, commands: {
    one: { kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'old', createdAt: '2026-10-08' },
    two: { kind: 'session.message', state: 'accepted_by_dsh', sessionId: 'latest', createdAt: '2026-10-09' }
  } };
  const current = currentChatProfile(account, () => true);
  assert.equal(current, 'muse');
  const select = (explicit = null, bound = null) => selectBackgroundProfile({ explicit, bound, current, profiles, allowed: () => true })?.id;
  assert.equal(select(), 'muse'); assert.equal(select(null, 'occamy'), 'muse');
  assert.equal(select('cloud', 'muse'), 'cloud'); assert.equal(select('cloud'), 'cloud');
  assert.equal(currentChatProfile({}, () => true), null);
  assert.equal(selectBackgroundProfile({ explicit: null, bound: null, current: null, profiles, allowed: () => true }), null);
  assert.equal(currentChatProfile({ ...account, lastChatModelProfileId: 'cloud' }, () => true), 'cloud');
});

test('connection check distinguishes unreachable, rejected keys, no directory, missing IDs and malformed lists without inference', async () => {
  let mode = 'good', inference = 0;
  const endpoint = createServer(async (request, response) => {
    if (request.method === 'POST') { inference++; request.resume(); response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); return; }
    const status = Number(mode);
    if (Number.isInteger(status)) { response.writeHead(status).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(mode === 'invalid' ? {} : { data: [{ id: mode === 'missing' ? 'other' : 'muse' }] }));
  });
  await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(endpoint.address() as any).port}/v1`;
  const check = (sendTestMessage = false) => checkModelConnection({ baseUrl, modelId: 'muse', apiKey: 'synthetic-check-key', sendTestMessage });
  try {
    assert.equal((await check()).model, 'listed');
    for (const code of [401, 403]) { mode = String(code); const result = await check(); assert.equal(result.authentication, 'rejected'); assert.equal(result.httpStatus, code); assert.equal(result.reachable, true); }
    mode = 'missing'; assert.equal((await check()).model, 'missing');
    mode = 'invalid'; assert.equal((await check()).catalog, 'invalid');
    mode = '500'; assert.equal((await check()).catalog, 'failed');
    mode = '404'; assert.equal((await check()).catalog, 'unsupported'); assert.equal(inference, 0);
    const explicit = await check(true); assert.equal(explicit.inferenceVerified, true); assert.equal(inference, 1);
    const rejected = await checkModelConnection({ baseUrl, modelId: 'muse', apiKey: 'synthetic-check-key', fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(rejected.address, 'unreachable'); assert.equal(rejected.reachable, false);
    assert.equal(JSON.stringify(explicit).includes('synthetic-check-key'), false);
  } finally { endpoint.closeAllConnections(); await new Promise<void>(resolve => endpoint.close(() => resolve())); }
});

test('official MiMo IDs normalize while other providers retain case', async () => {
  assert.equal(canonicalProviderModelId('https://api.xiaomimimo.com/v1', 'MiMo-V2.6-Flash'), 'mimo-v2.6-flash');
  assert.equal(canonicalProviderModelId('https://other.example/v1', 'Mixed-Case'), 'Mixed-Case');
  const result = await checkModelConnection({ baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'MiMo-V2.6-Flash', apiKey: 'synthetic',
    fetchImpl: async () => Response.json({ data: [{ id: 'mimo-v2.6-flash' }] }) });
  assert.equal(result.modelListed, true); assert.equal(result.suggestedModelId, 'mimo-v2.6-flash');
});

test('Anthropic compatibility diagnostics use native catalog headers without sending a conversation', async () => {
  let calls = 0;
  const result = await checkModelConnection({ baseUrl: 'https://api.anthropic.com/v1', modelId: 'synthetic-claude', apiKey: 'synthetic-key',
    fetchImpl: async (url: URL, options: any) => {
      calls++; assert.equal(url.pathname, '/v1/models'); assert.equal(options.method, undefined);
      assert.equal(options.headers['x-api-key'], 'synthetic-key'); assert.equal(options.headers['anthropic-version'], '2023-06-01');
      return Response.json({ data: [{ id: 'synthetic-claude' }] });
    } });
  assert.equal(calls, 1); assert.equal(result.modelListed, true); assert.equal(result.inferenceVerified, false);
});

test('background local request waits for already loaded model, releases queue for chat, then rechecks before inference', async () => {
  let loaded = 'muse', switching = false, requests = 0;
  const profile = { id: 'occamy', model: 'occamy', baseUrl: 'http://127.0.0.1:1/v1' };
  const fetchImpl = async (url: any) => String(url).endsWith('/props') ? Response.json({ total_slots: 1 })
    : String(url).endsWith('/switch/status') ? Response.json({ currentModelId: loaded, switching })
      : (requests++, Response.json({ choices: [{ message: { content: 'OK' } }] }));
  const events: string[] = [];
  const bridge = await createModelScheduler({ profileFor: () => profile, credentialFor: () => 'synthetic', isIdle: async () => true,
    backgroundRoute: () => ({}), fetchImpl, backgroundReady: row => backgroundModelReady(row, { credentialFor: () => 'synthetic', fetchImpl }), onEvent: event => events.push(event) });
  const cancel = new AbortController();
  try {
    const memory = fetch(`${bridge.memoryBaseUrl(profile.id)}/chat/completions`, { method: 'POST', signal: cancel.signal,
      headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'private memory text' }] }) });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(requests, 0); assert.equal(bridge.queue.status().backgroundPending, 1);
    const foreground = await acquireModelSlot('foreground', undefined, bridge.url, { profileId: profile.id, sessionId: 'chat' });
    assert.equal(requests, 0); await foreground();
    loaded = 'occamy'; switching = true;
    assert.equal(await backgroundModelReady(profile, { credentialFor: () => 'synthetic', fetchImpl }), false);
    switching = false;
    assert.equal((await memory).status, 200); assert.equal(requests, 1);
    assert.ok(events.includes('model.switch_wait')); assert.ok(events.includes('model.start'));
  } finally { cancel.abort(); await bridge.close(); }
});

test('daily host logs rotate with seven-day retention and discard conversation, memory and credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'ms1-log-'));
  let date = new Date('2026-10-01T12:00:00Z');
  const log = createHostLog(root, { now: () => date, maxBytes: 400 });
  try {
    log.write('host.start', { mode: 'personal-host' });
    date = new Date('2026-10-09T12:00:00Z');
    for (let i = 0; i < 10; i++) log.write('model.start', { profileId: 'synthetic', priority: 'background',
      text: 'CONFIDENTIAL_CONVERSATION', memory: 'CONFIDENTIAL_MEMORY', apiKey: 'CONFIDENTIAL_KEY', authorization: 'CONFIDENTIAL_TOKEN', error: new Error('CONFIDENTIAL_KEY') });
    const files = readdirSync(log.directory);
    assert.ok(files.length > 1); assert.ok(files.every(file => !file.includes('2026-10-01')));
    const content = files.map(file => readFileSync(join(log.directory, file), 'utf8')).join('');
    for (const value of ['CONFIDENTIAL_CONVERSATION', 'CONFIDENTIAL_MEMORY', 'CONFIDENTIAL_KEY', 'CONFIDENTIAL_TOKEN']) assert.equal(content.includes(value), false);
    assert.ok(files.every(file => Buffer.byteLength(readFileSync(join(log.directory, file))) <= 400));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('account model settings persist per account and draft check does not store its key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ms1-settings-'));
  const backend = { getStatus: async () => ({}), listModels: async () => [{ id: 'muse', name: 'Muse', configured: true }],
    preflight: async () => ({}), createSession: async () => ({}), sendMessage: async () => ({}), cancelSession: async () => ({}), readEvents: async () => ({}), describeSession: async () => ({}) };
  const service = await createPersonalAccessService({ root, port: 0, backend, accountModelManager: {
    ...Object.fromEntries(['stageSecret', 'apply', 'inspect', 'test', 'disable', 'readSecret'].map(name => [name, async () => ({})])), hasCredential: () => false,
    check: async ({ input }: any) => checkModelConnection({ ...input, fetchImpl: async () => Response.json({ data: [{ id: 'muse' }] }) })
  } });
  try {
    const { origin } = await service.start(), setup = await service.issueSetupGrant();
    const registered = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: setup.grant, username: 'SyntheticMS1', password: 'synthetic test password 2026', deviceName: 'MS1' }) });
    const account = await registered.json(); assert.equal(registered.status, 201);
    const headers = { origin, cookie: registered.headers.get('set-cookie')!.split(';')[0], 'x-weftmate-csrf': account.csrfToken, 'content-type': 'application/json' };
    const saved = await fetch(`${origin}/personal/v1/settings/models`, { method: 'PATCH', headers, body: JSON.stringify({ defaultModelProfileId: 'muse', backgroundModelProfileId: null }) });
    assert.equal(saved.status, 200); assert.equal((await saved.json()).defaultModelProfileId, 'muse');
    const checked = await fetch(`${origin}/personal/v1/account/models/check`, { method: 'POST', headers, body: JSON.stringify({ baseUrl: 'http://127.0.0.1:1/v1', modelId: 'muse', apiKey: 'SECRET_NOT_ON_DISK' }) });
    assert.equal(checked.status, 200); assert.equal((await checked.json()).modelListed, true);
    for (const file of readdirSync(root).filter(name => name.endsWith('.json'))) assert.equal(readFileSync(join(root, file), 'utf8').includes('SECRET_NOT_ON_DISK'), false);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

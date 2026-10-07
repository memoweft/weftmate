import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';

test('background selection persists per account and only host owner can restart shared services', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-system-'));
  const restarts: any[] = [];
  const backend = { getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
    listModels: async () => [{ id: 'local', name: 'Qwen', model: 'qwen', configured: true }],
    preflight: async () => ({ ok: true }), createSession: async () => ({}), sendMessage: async () => ({}),
    cancelSession: async () => ({}), readEvents: async () => ({}), describeSession: async () => null };
  const systemManager = { status: async () => ({ model: { state: 'ready', contextWindow: 32768 } }),
    restart: async (...args) => { restarts.push(args); } };
  let service = await createPersonalAccessService({ root, port: 0, backend, systemManager });
  try {
    let { origin } = await service.start();
    const grant = await service.issueSetupGrant();
    const call = async (path, headers = {}, body?, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(`${origin}/personal/v1${path}`, { method, headers: {
        origin, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { response, value: await response.json() };
    };
    const setup = await call('/auth/setup', {}, { grant: grant.grant, username: 'SyntheticOwner',
      password: 'synthetic system password', deviceName: 'Desktop' });
    assert.equal(setup.response.status, 201, JSON.stringify(setup.value));
    const ownerId = setup.value.account.ownerId;
    const auth = { cookie: setup.response.headers.get('set-cookie')!.split(';')[0], 'x-weftmate-csrf': setup.value.csrfToken };
    assert.equal((await call('/system')).response.status, 401);
    assert.equal((await call('/settings/models', auth)).value.backgroundModelProfileId, null);
    assert.equal((await call('/settings/models', auth, { backgroundModelProfileId: 'missing' }, 'PATCH')).response.status, 409);
    assert.equal((await call('/settings/models', auth, { backgroundModelProfileId: 'local' }, 'PATCH')).response.status, 200);
    assert.equal(service.backgroundModelProfile(ownerId), 'local');
    const foreign = await call('/auth/register', {}, { username: 'SyntheticGuest',
      password: 'synthetic guest password', deviceName: 'Phone' });
    const other = { cookie: foreign.response.headers.get('set-cookie')!.split(';')[0], 'x-weftmate-csrf': foreign.value.csrfToken };
    assert.equal((await call('/settings/models', other)).value.backgroundModelProfileId, null);
    assert.equal((await call('/system/model/restart', other, {})).response.status, 403);
    assert.equal((await call('/system/model/restart', { cookie: auth.cookie }, {})).response.status, 403);
    assert.equal((await call('/system/model/restart', auth, {})).response.status, 200);
    assert.deepEqual(restarts, [['model', ownerId]]);
    await service.close(); service = await createPersonalAccessService({ root, port: 0, backend, systemManager });
    ({ origin } = await service.start());
    assert.equal((await call('/settings/models', auth)).value.backgroundModelProfileId, 'local');
    await call('/settings/models', auth, { backgroundModelProfileId: null }, 'PATCH');
    assert.equal(service.backgroundModelProfile(ownerId), null);
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

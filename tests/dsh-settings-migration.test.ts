import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import {
  OfficialDshRpcError,
  assertOfficialDshLoopbackOrigin,
  createOfficialDshSettingsClient,
  migrateLegacyRoutes,
  officialCredentialRef,
  projectOfficialProviderConfig,
  repairOfficialLocalRouteLimits,
  verifyLegacyRouteMigration,
  type LegacyRouteProjection,
} from '../src/dsh-settings-migration.ts';

const route: LegacyRouteProjection = {
  route: 'weftmate-abc-123',
  displayName: 'Local Qwen',
  baseURL: 'http://127.0.0.1:8080/v1',
  models: [{ id: 'qwen', name: 'Qwen', contextWindow: 262144, maxTokens: 32768 }],
};

type FixtureReply = (request: { path: string; body: any }) => { status?: number; body?: unknown; delayMs?: number };

async function withFixture(reply: FixtureReply, run: (origin: string) => Promise<void>): Promise<void> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const next = reply({ path: request.url ?? '', body });
    const respond = () => {
      response.writeHead(next.status ?? 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(next.body ?? {}));
    };
    if (next.delayMs) setTimeout(respond, next.delayMs); else respond();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`); } finally { server.close(); await once(server, 'close'); }
}

function settingsValue(revision: number, options: { user?: Record<string, unknown>; base?: Record<string, unknown>; applies?: 'live' | 'restart'; writable?: boolean } = {}) {
  return {
    writable: options.writable ?? true,
    hasDocument: true,
    namespaces: [{
      ns: 'llm-pi-ai', schema: { intentionally: 'not returned by helper' }, value: { hidden: true }, secrets: [], revision,
      applies: options.applies ?? 'live', base: { providers: options.base ?? {} }, user: { providers: options.user ?? {} },
    }],
  };
}

function successEnvelope(request: any, value: unknown) {
  return { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } };
}

describe('official DSH legacy route migration helper', () => {
  for (const preference of ['zh', 'en', undefined]) it(`reads resolved locale.preference through settings.describe: ${preference}`, async () => {
    await withFixture(({ path, body }) => {
      assert.equal(path, '/api/settings.describe');
      return { body: successEnvelope(body, { writable: true, namespaces: preference === undefined ? [] : [
        { ns: 'locale', value: { preference }, base: { preference: 'zh' }, user: { preference: 'en' } },
      ] }) };
    }, async origin => {
      assert.equal(await createOfficialDshSettingsClient({ origin }).readLocalePreference(), preference === 'en' ? 'en' : 'zh');
    });
  });
  it('uses exact loopback unary envelopes and projects only metadata', async () => {
    const observed: any[] = [];
    await withFixture(({ path, body }) => {
      observed.push({ path, body });
      if (path === '/api/settings.describe') return { body: successEnvelope(body, settingsValue(7)) };
      if (path === '/api/settings.mutate') return { body: successEnvelope(body, {}) };
      return { status: 404 };
    }, async (origin) => {
      const client = createOfficialDshSettingsClient({ origin, rpcIdFactory: () => 'rpc-success' });
      const result = await migrateLegacyRoutes(client, [route]);
      assert.equal(result.mutated, true);
      assert.equal(result.attempts, 1);
    });
    assert.deepEqual(observed.map((entry) => entry.path), ['/api/settings.describe', '/api/settings.mutate']);
    assert.deepEqual(observed[0].body, { type: 'client-request', rpcId: 'rpc-success', method: 'settings.describe', payload: {} });
    assert.deepEqual(observed[1].body.payload, {
      ns: 'llm-pi-ai', expectedRevision: 7,
      ops: [{ op: 'set', path: ['providers', route.route], value: projectOfficialProviderConfig(route) }],
    });
    assert.equal(Object.hasOwn(observed[0].body.payload, 'schema'), false);
  });

  for (const code of ['settings-conflict', 'settings/conflict']) it(`re-describes and retries ${code} no more than three times`, async () => {
    let describes = 0; let mutates = 0;
    await withFixture(({ path, body }) => {
      if (path === '/api/settings.describe') {
        describes += 1;
        return { body: successEnvelope(body, settingsValue(describes)) };
      }
      if (path === '/api/settings.mutate') {
        mutates += 1;
        if (mutates === 1) return { body: { type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code } } } };
        return { body: successEnvelope(body, {}) };
      }
      return { status: 404 };
    }, async (origin) => {
      const result = await migrateLegacyRoutes(createOfficialDshSettingsClient({ origin }), [route]);
      assert.equal(result.attempts, 2);
      assert.equal(result.mutated, true);
    });
    assert.equal(describes, 2); assert.equal(mutates, 2);
  });

  it('switches once on 404 to Typert paths and args, including direct credential rows', async () => {
    const observed: any[] = [];
    const ref = officialCredentialRef(route.route);
    const rows = { [ref]: { configured: true, writable: true, source: 'weftmate' } };
    await withFixture(({ path, body }) => {
      observed.push({ path, body });
      if (path === '/api/settings.describe') return { status: 404 };
      assert.equal(body.method, path.slice('/api/'.length));
      if (path === '/api/settings/describe') return { body: successEnvelope(body, settingsValue(7)) };
      if (path === '/api/credentials/describe') {
        assert.deepEqual(body.payload, { args: { refs: [ref] } });
        return { body: successEnvelope(body, rows) };
      }
      assert.equal(path, '/api/settings/mutate');
      assert.equal(body.payload.args.expectedRevision, 7);
      return { body: successEnvelope(body, {}) };
    }, async origin => {
      const client = createOfficialDshSettingsClient({ origin, rpcIdFactory: () => 'modern-rpc' });
      await migrateLegacyRoutes(client, [route]);
      assert.deepEqual(await client.describeCredentials([ref]), rows);
      await client.describeSettings();
      // Protocol selection belongs to this client, not a process-wide cache.
      await createOfficialDshSettingsClient({ origin }).describeSettings();
    });
    assert.deepEqual(observed.map(row => row.path), ['/api/settings.describe', '/api/settings/describe',
      '/api/settings/mutate', '/api/credentials/describe', '/api/settings/describe',
      '/api/settings.describe', '/api/settings/describe']);
    assert.deepEqual(observed[1].body, { type: 'client-request', rpcId: 'modern-rpc', method: 'settings/describe', payload: { args: {} } });
  });

  for (const code of ['settings-conflict', 'settings/conflict']) it(`local limit repair retries ${code} and respects its retry budget`, async () => {
    let describes = 0, mutates = 0;
    const client = {
      origin: 'http://127.0.0.1:8123',
      async describeSettings() {
        describes++;
        return { writable: true, applies: 'live' as const, revision: describes, baseProviders: {},
          userProviders: { [route.route]: { ...projectOfficialProviderConfig(route), models: [{ ...route.models[0], maxTokens: 100 }] } } };
      },
      async mutateSettings(_ops: unknown, revision: number) {
        assert.equal(revision, describes);
        mutates++;
        if (mutates !== 2) throw new OfficialDshRpcError('conflict', code);
      },
      async readLocalePreference() { return 'zh' as const; },
      async describeCredentials() { return {}; },
    };
    assert.equal(await repairOfficialLocalRouteLimits(client, route), true);
    assert.equal(mutates, 2);
    await assert.rejects(repairOfficialLocalRouteLimits(client, route), error => error instanceof OfficialDshRpcError && error.code === code);
    assert.equal(mutates, 5);
    assert.equal(describes, 5);
    await assert.rejects(migrateLegacyRoutes({ ...client, async describeSettings() {
      return { writable: true, applies: 'live' as const, revision: describes, baseProviders: {}, userProviders: {} };
    } }, [route]), error => error instanceof OfficialDshRpcError && error.code === code);
    assert.equal(mutates, 8);
  });

  it('fails closed when the user layer already differs from the desired route', async () => {
    let mutates = 0;
    await withFixture(({ path, body }) => {
      if (path === '/api/settings.describe') return { body: successEnvelope(body, settingsValue(1, { user: { [route.route]: { ...projectOfficialProviderConfig(route), displayName: 'user edit' } } })) };
      if (path === '/api/settings.mutate') mutates += 1;
      return { status: 500 };
    }, async (origin) => {
      await assert.rejects(migrateLegacyRoutes(createOfficialDshSettingsClient({ origin }), [route]), /conflicts with an existing official user route/);
    });
    assert.equal(mutates, 0);
  });

  it('repairs only owned local model limits with a revision guard', async () => {
    const desired = { ...route, models: [{ ...route.models[0], maxTokens: 16384 }] };
    const old = projectOfficialProviderConfig(route);
    let current: unknown = old;
    const writes: any[] = [];
    await withFixture(({ path, body }) => {
      if (path === '/api/settings.describe') return { body: successEnvelope(body, settingsValue(3, { user: { [route.route]: current } })) };
      if (path === '/api/settings.mutate') {
        writes.push(body.payload);
        current = body.payload.ops[0].value;
        return { body: successEnvelope(body, {}) };
      }
      return { status: 404 };
    }, async (origin) => {
      const client = createOfficialDshSettingsClient({ origin });
      assert.equal(await repairOfficialLocalRouteLimits(client, desired), true);
      assert.equal(await repairOfficialLocalRouteLimits(client, desired), false);
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].expectedRevision, 3);
    assert.deepEqual(writes[0].ops, [{ op: 'set', path: ['providers', route.route], value: projectOfficialProviderConfig(desired) }]);

    let attempted = 0;
    await withFixture(({ path, body }) => {
      if (path === '/api/settings.describe') return { body: successEnvelope(body, settingsValue(4, {
        user: { [route.route]: { ...old, baseURL: 'http://127.0.0.1:9999/v1' } },
      })) };
      if (path === '/api/settings.mutate') attempted += 1;
      return { status: 500 };
    }, async (origin) => {
      await assert.rejects(repairOfficialLocalRouteLimits(createOfficialDshSettingsClient({ origin }), desired),
        /differs from the owned projection/);
    });
    assert.equal(attempted, 0);
  });

  it('rejects invalid carrier envelopes and mismatched rpcIds', async () => {
    await withFixture(({ body }) => ({ body: { type: 'server-response', rpcId: `${body.rpcId}-other`, result: { ok: true, value: settingsValue(1) } } }), async (origin) => {
      const client = createOfficialDshSettingsClient({ origin });
      await assert.rejects(client.describeSettings(), (error: unknown) => error instanceof OfficialDshRpcError && /invalid response envelope/.test(error.message));
    });
  });

  it('allows only a precise loopback origin and rejects timeout', async () => {
    for (const origin of ['https://127.0.0.1:8080', 'http://localhost:8080', 'http://127.0.0.1', 'http://127.0.0.1:8080/path']) {
      assert.throws(() => assertOfficialDshLoopbackOrigin(origin), /exactly/);
    }
    await withFixture(({ body }) => ({ body: successEnvelope(body, settingsValue(1)), delayMs: 40 }), async (origin) => {
      await assert.rejects(createOfficialDshSettingsClient({ origin, timeoutMs: 5 }).describeSettings(), /timed out/);
    });
  });

  it('verifies the final user-only live route and metadata-only credential rows', async () => {
    const desired = projectOfficialProviderConfig(route);
    await withFixture(({ path, body }) => {
      if (path === '/api/credentials.describe') {
        return { body: successEnvelope(body, { credentials: { [officialCredentialRef(route.route)]: { configured: true, writable: true, source: 'weftmate-safe-storage' } } }) };
      }
      return { status: 404 };
    }, async (origin) => {
      const rows = await createOfficialDshSettingsClient({ origin }).describeCredentials([officialCredentialRef(route.route)]);
      assert.deepEqual(rows, { [officialCredentialRef(route.route)]: { configured: true, writable: true, source: 'weftmate-safe-storage' } });
      const verification = verifyLegacyRouteMigration([route], {
        writable: true, applies: 'live', revision: 4, baseProviders: {}, userProviders: { [route.route]: desired },
      }, rows);
      assert.deepEqual(verification, { ok: true, reasons: [] });
      assert.equal(verifyLegacyRouteMigration([route], {
        writable: true, applies: 'restart', revision: 4, baseProviders: { [route.route]: desired }, userProviders: { [route.route]: desired },
      }).ok, false);
    });
  });

  it('derives the official route credential reference', () => {
    assert.equal(officialCredentialRef('weftmate-a/b 7'), 'WEFTMATE_A_B_7_API_KEY');
  });
});


describe('token-authenticated official DSH client', () => {
  it('validates URL and explicit tokens before issuing requests', () => {
    const origin = 'http://127.0.0.1:8123';
    assert.equal(assertOfficialDshLoopbackOrigin(origin + '/?token=a%2Bb'), origin);
    assert.equal(assertOfficialDshLoopbackOrigin('http://127.0.0.1:80/'), 'http://127.0.0.1:80');
    for (const suffix of ['?x=y', '?token=', '?token=a&token=b', '?token=a&x=y', '#x', '?token=%', '?token=%0A']) {
      assert.throws(() => createOfficialDshSettingsClient({ origin: origin + '/' + suffix }));
    }
    for (const value of ['http://user:pass@127.0.0.1:8123', 'http://127.1:8123', 'http://127.0.0.1:0', 'http://127.0.0.1:65536']) {
      assert.throws(() => assertOfficialDshLoopbackOrigin(value));
    }
    for (const token of ['', ' ', 'a\nb', null, 1, '\ud800']) {
      assert.throws(() => createOfficialDshSettingsClient({ origin, token: token as any }));
    }
    assert.throws(() => createOfficialDshSettingsClient({ origin: origin + '/?token=a', token: 'b' }));
  });

  it('exchanges cookies once and isolates cache by fetch, origin and token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (init?.method === 'GET') {
        assert.equal(init.redirect, 'manual');
        return new Response(null, { status: 302, headers: [
          ['set-cookie', 'session=fixture; HttpOnly; Path=/'], ['set-cookie', 'other=value; Path=/'],
          ['location', './api/remote.mux'],
        ] });
      }
      assert.equal(new Headers(init?.headers).get('cookie'), 'session=fixture; other=value');
      const body = JSON.parse(String(init?.body));
      return Response.json(successEnvelope(body, body.method === 'credentials.describe' ? { credentials: {} } : settingsValue(1)));
    };
    const origin = 'http://127.0.0.1:8123';
    const a = createOfficialDshSettingsClient({ origin: origin + '/?token=a%2Bb', fetchImpl });
    const b = createOfficialDshSettingsClient({ origin, token: 'a+b', fetchImpl });
    assert.equal(a.origin, origin);
    await Promise.all([a.describeSettings(), b.describeCredentials([])]);
    await b.mutateSettings([], 1);
    assert.equal(calls.filter(call => call.init?.method === 'GET').length, 1);
    assert.equal(calls[0].url, origin + '/connect?token=a%2Bb');
    await createOfficialDshSettingsClient({ origin, token: 'other', fetchImpl }).describeSettings();
    await createOfficialDshSettingsClient({ origin: 'http://127.0.0.1:8124', token: 'a+b', fetchImpl }).describeSettings();
    await createOfficialDshSettingsClient({ origin, token: 'a+b', fetchImpl: (input, init) => fetchImpl(input, init) }).describeSettings();
    assert.equal(calls.filter(call => call.init?.method === 'GET').length, 4);
    assert.equal(calls.filter(call => call.init?.method === 'POST').every(call => !call.url.includes('?')), true);
  });

  for (const persistent of [false, true]) it('refreshes a rejected cookie only once: ' + persistent, async () => {
    let connects = 0; let posts = 0;
    const fetchImpl = async (_input: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        connects++;
        return new Response(null, { status: 302, headers: { 'set-cookie': 'session=' + connects + '; HttpOnly' } });
      }
      posts++;
      assert.equal(new Headers(init?.headers).get('cookie'), 'session=' + connects);
      if (persistent || posts === 1) return new Response(null, { status: 401 });
      return Response.json(successEnvelope(JSON.parse(String(init?.body)), settingsValue(1)));
    };
    const client = createOfficialDshSettingsClient({ origin: 'http://127.0.0.1:8123/?token=fixture', fetchImpl });
    if (persistent) await assert.rejects(client.describeSettings(), /carrier failed/);
    else await client.describeSettings();
    assert.equal(connects, 2); assert.equal(posts, 2);
    if (persistent) {
      await assert.rejects(client.describeSettings(), /carrier failed/);
      assert.equal(connects, 4);
    } else {
      await client.describeSettings(); assert.equal(connects, 2);
    }
  });

  it('does not connect or retry 401 without a token', async () => {
    let calls = 0;
    const client = createOfficialDshSettingsClient({ origin: 'http://127.0.0.1:8123', fetchImpl: async (_input, init) => {
      calls++;
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).has('cookie'), false);
      return new Response(null, { status: 401 });
    } });
    await assert.rejects(client.describeSettings(), /carrier failed/);
    assert.equal(calls, 1);
  });

  for (const status of [302, 401, 500]) it('clears failed connection cache without posting: ' + status, async () => {
    let calls = 0;
    const client = createOfficialDshSettingsClient({ origin: 'http://127.0.0.1:8123/?token=fixture', fetchImpl: async (_input, init) => {
      calls++; assert.equal(init?.method, 'GET');
      return new Response(null, { status });
    } });
    await assert.rejects(client.describeSettings(), /connection/);
    await assert.rejects(client.describeSettings(), /connection/);
    assert.equal(calls, 2);
  });
});

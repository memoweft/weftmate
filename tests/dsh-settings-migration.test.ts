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

  it('re-describes and retries a settings-conflict no more than three times', async () => {
    let describes = 0; let mutates = 0;
    await withFixture(({ path, body }) => {
      if (path === '/api/settings.describe') {
        describes += 1;
        return { body: successEnvelope(body, settingsValue(describes)) };
      }
      if (path === '/api/settings.mutate') {
        mutates += 1;
        if (mutates === 1) return { body: { type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code: 'settings-conflict' } } } };
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

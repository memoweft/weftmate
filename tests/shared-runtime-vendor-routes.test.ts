/**
 * Real pinned-vendor integration: one DSH child/home owns two internal routes.
 * The fixture keys are generated in memory and never printed, persisted, or
 * included in assertions/messages.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { DshWebRuntime } from '../src/dsh-web-runtime.ts';
import { routeForProfile, writeModelRoutesPatch } from '../src/harness-model-routes.ts';
import { restoreInternalSessionRoute } from '../src/session-model-route-restore.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

type Hit = { path: string; authorization: string | undefined; model: string | undefined };
async function fixture(key: string): Promise<{ baseUrl: string; requests: Hit[]; metadataRequests: string[]; close: () => Promise<void> }> {
  const requests: Hit[] = [];
  const metadataRequests: string[] = [];
  const server = createServer((req, res) => {
    const hit: Hit = { path: `${req.method} ${req.url}`, authorization: req.headers.authorization, model: undefined };
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) { res.writeHead(404).end(); return; }
    requests.push(hit);
    let raw = '';
    const observeBody = () => { try { const body = JSON.parse(raw || '{}'); hit.model = typeof body.model === 'string' ? body.model : undefined; } catch { /* incomplete chunk */ } };
    req.on('data', (part) => { raw += String(part); observeBody(); });
    req.on('end', () => {
      observeBody();
      if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401).end(); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write('data: {"id":"fixture","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture did not bind');
  server.prependListener('request', req => { if (req.method === 'GET') metadataRequests.push(req.url ?? ''); });
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, metadataRequests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function request(origin: string, path: string, method = 'GET', body?: unknown): Promise<any> {
  const response = await fetch(new URL(`/weftmate/api/v1${path}`, origin), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `gateway ${method} ${path} failed (${response.status}; ${String(value?.error?.code ?? 'unknown')}; ${String(value?.error?.message ?? '')})`);
  return value;
}

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('timed out waiting for provider request');
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function startPump(origin: string, sessionId: string): Promise<{ controller: AbortController; events: any[] }> {
  const controller = new AbortController();
  const response = await fetch(new URL(`/weftmate/api/v1/sessions/${encodeURIComponent(sessionId)}/events`, origin), { signal: controller.signal });
  assert.equal(response.ok, true, 'gateway event pump failed');
  const events: any[] = [];
  void (async () => {
    const reader = response.body?.getReader(); if (!reader) return;
    const decoder = new TextDecoder(); let pending = '';
    try {
      while (!controller.signal.aborted) {
        const next = await reader.read(); if (next.done) break;
        pending += decoder.decode(next.value, { stream: true });
        const blocks = pending.split('\n\n'); pending = blocks.pop() ?? '';
        for (const block of blocks) {
          const row = block.split('\n').find((line) => line.startsWith('data: '));
          if (row) events.push(JSON.parse(row.slice(6)));
        }
      }
    } catch { /* abort closes the test stream */ }
  })();
  return { controller, events };
}

describe('shared DSH_HOME vendor routes', () => {
  test('secure mode rejects a currently enabled HMR row before any child boot', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'weftmate-secure-hmr-')); roots.push(root);
    const home = join(root, 'dsh-home'); await mkdir(home, { recursive: true });
    const securityPatch = join(home, 'weftmate-security-credentials.patch.yml');
    await writeFile(securityPatch, [
      '- id: credentials', '  disabled: true',
      '- id: weftmate-credentials', '  disabled: true',
      '- insert:', '    - id: weftmate-safe-credentials', '      name: ./plugins/weftmate-credentials.mjs', '',
    ].join('\n'), 'utf8');
    const runtime = new DshWebRuntime({
      homeDir: home, workspaceDir: join(root, 'workspace'), runtimePath: join(process.cwd(), 'vendor', 'dsh-runtime'),
      patchFiles: [securityPatch], readyTimeoutMs: 10_000, credentialRequestHandler: async () => ({}),
    });
    try {
      // start() writes the generated profile before preflight. A hand-authored
      // patch is preserved, so this must be rejected rather than overwritten.
      await mkdir(join(home, 'profiles', 'weftmate'), { recursive: true });
      await writeFile(join(home, 'profiles', 'weftmate', 'cordis.patch.yml'), '- id: hmr\n  disabled: false\n', 'utf8');
      await assert.rejects(runtime.start(), /安全凭据配置预检拒绝/);
      assert.equal(runtime.isRunning(), false);
    } finally { await runtime.close(); }
  });

  test('secure crash respawn composes a fresh snapshot and rejects a newly unsafe owner patch', { timeout: 45_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'weftmate-secure-respawn-')); roots.push(root);
    const home = join(root, 'dsh-home'); const profileDir = join(home, 'profiles', 'weftmate');
    await mkdir(join(profileDir, 'plugins'), { recursive: true });
    const securityPatch = join(home, 'weftmate-security-credentials.patch.yml');
    const ownerPatch = join(profileDir, 'cordis.patch.yml');
    await writeFile(securityPatch, [
      '- id: credentials', '  disabled: true',
      '- id: weftmate-credentials', '  disabled: true',
      '- insert:', '    - id: weftmate-safe-credentials', '      name: ./plugins/weftmate-credentials.mjs', '',
    ].join('\n'), 'utf8');
    await writeFile(join(profileDir, 'plugins', 'respawn-mutator.mjs'), [
      "import { writeFile } from 'node:fs/promises';",
      `const patch = ${JSON.stringify(ownerPatch)};`,
      'export default () => {',
      "  setTimeout(async () => { await writeFile(patch, '- id: hmr\\n  disabled: false\\n', 'utf8'); process.exit(41) }, 700);",
      '};', '',
    ].join('\n'), 'utf8');
    await writeFile(ownerPatch, [
      '- insert:', '    - id: respawn-mutator', '      name: ./plugins/respawn-mutator.mjs', '',
    ].join('\n'), 'utf8');
    const logs: string[] = []; const origins: Array<string | null> = [];
    const runtime = new DshWebRuntime({
      homeDir: home, workspaceDir: join(root, 'workspace'), runtimePath: join(process.cwd(), 'vendor', 'dsh-runtime'),
      patchFiles: [securityPatch], readyTimeoutMs: 30_000, credentialRequestHandler: async () => ({}), log: (line) => logs.push(line),
    });
    runtime.onOrigin = (origin) => origins.push(origin);
    try {
      await runtime.start();
      for (let attempt = 0; attempt < 180 && !logs.some((line) => line.includes('重拉失败')); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(origins.includes(null), true, 'unexpected child exit must revoke the current origin');
      assert.equal(origins.some((origin) => origin !== null), false, 'unsafe fresh composition must not publish a respawn origin');
      assert.equal(logs.some((line) => line.includes('重拉失败')), true, 'respawn must re-run secure composition validation');
      assert.equal(runtime.isRunning(), false);
    } finally { await runtime.close(); }
  });

  test('secure boot freezes the verified profile/home composition before child spawn', { timeout: 60_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'weftmate-secure-snapshot-')); roots.push(root);
    const home = join(root, 'dsh-home');
    const profileDir = join(home, 'profiles', 'weftmate');
    const securityPatch = join(home, 'weftmate-security-credentials.patch.yml');
    const marker = join(root, 'unexpected-live-patch-marker.txt');
    const markerPlugin = [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(marker)}, 'activated');`,
      'export default () => {};', '',
    ].join('\n');
    const snapshots: Array<{ digest: string, entries: readonly unknown[] }> = [];
    await mkdir(home, { recursive: true });
    await writeFile(securityPatch, [
      '- id: credentials', '  disabled: true',
      '- id: weftmate-credentials', '  disabled: true',
      '- insert:', '    - id: weftmate-safe-credentials', '      name: ./plugins/weftmate-credentials.mjs', '',
    ].join('\n'), 'utf8');
    const runtime = new DshWebRuntime({
      homeDir: home, workspaceDir: join(root, 'workspace'), runtimePath: join(process.cwd(), 'vendor', 'dsh-runtime'),
      patchFiles: [securityPatch], readyTimeoutMs: 30_000, credentialRequestHandler: async () => ({}),
      testOnlyAfterSecureCompositionSnapshot: async (snapshot) => {
        snapshots.push(snapshot);
        // This is deliberately after `--dump-config` and before spawn. If the
        // child rereads the mutable profile layer, this plugin creates marker.
        await writeFile(join(profileDir, 'plugins', 'late-marker.mjs'), markerPlugin, 'utf8');
        await writeFile(join(profileDir, 'cordis.patch.yml'), [
          '- insert:', '    - id: late-profile-marker', '      name: ./plugins/late-marker.mjs', '',
        ].join('\n'), 'utf8');
      },
    });
    try {
      const origin = await runtime.start();
      assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(snapshots.length, 1, 'one start must create exactly one frozen snapshot');
      const encoded = JSON.stringify(snapshots[0]?.entries);
      assert.match(encoded, /"id":"agent-presets"/, 'snapshot retains official agent presets');
      assert.match(encoded, /"id":"session-telemetry-otel"/, 'snapshot retains official telemetry row');
      assert.match(encoded, /"disabled":true/, 'snapshot carries the final telemetry disable');
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(existsSync(marker), false, 'post-preflight profile mutation must not enter the child boot tree');

      // The second mutable layer is the home patch. A running secure child
      // must neither watch it nor HMR it into the verified composition.
      await writeFile(join(home, 'cordis.patch.yml'), [
        '- insert:', '    - id: late-home-marker', '      name: ./profiles/weftmate/plugins/late-marker.mjs', '',
      ].join('\n'), 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(existsSync(marker), false, 'post-ready home mutation must not activate');
    } finally {
      await runtime.close();
    }
  });

  test('old and new sessions retain distinct endpoint/key routes with one pinned runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weftmate-shared-dsh-')); roots.push(root);
    const keyA = randomBytes(32).toString('hex'); const keyB = randomBytes(32).toString('hex');
    const [a, b] = await Promise.all([fixture(keyA), fixture(keyB)]);
    try {
      const profiles = [
        { id: 'profile-a', name: 'Fixture A', provider: 'openai-compatible' as const, baseUrl: a.baseUrl, model: 'same-model' },
        { id: 'profile-b', name: 'Fixture B', provider: 'openai-compatible' as const, baseUrl: b.baseUrl, model: 'same-model' },
      ];
      const home = join(root, 'dsh-home'); const patch = join(home, 'weftmate-stage2-model-routes.patch.yml');
      writeModelRoutesPatch(patch, profiles);
      const securityPatch = join(home, 'weftmate-security-credentials.patch.yml');
      await writeFile(securityPatch, [
        '- id: credentials', '  disabled: true',
        '- id: weftmate-credentials', '  disabled: true',
        '- insert:', '    - id: weftmate-safe-credentials', '      name: ./plugins/weftmate-credentials.mjs', '',
      ].join('\n'), 'utf8');
      const runtimeLogs: string[] = [];
      const credentialRequests: Array<{ operation: string; ref: string }> = [];
      const credentialRequestHandler = ({ operation, ref }: { operation: string; ref: string }) => {
        credentialRequests.push({ operation, ref });
        const routeARef = routeForProfile('profile-a').apiKeyEnv;
        const routeBRef = routeForProfile('profile-b').apiKeyEnv;
        const value = ref === routeARef ? keyA
          : ref === routeBRef ? keyB
            : undefined;
        if (operation === 'resolve') return value ? { value, source: 'test-vault' } : {};
        if (operation === 'describe') return { configured: value !== undefined, writable: true, source: 'test-vault' };
        throw new Error('shared-runtime fixture supports credential resolve/describe only');
      };
      const runtimeOptions = {
        homeDir: home, workspaceDir: join(root, 'workspace'), runtimePath: join(process.cwd(), 'vendor', 'dsh-runtime'),
        patchFiles: [patch, securityPatch], readyTimeoutMs: 45_000,
        credentialRequestHandler,
        log: (line: string) => runtimeLogs.push(line),
      };
      let runtime = new DshWebRuntime(runtimeOptions);
      try {
        const origin = await runtime.start();
        const catalog = await request(origin, '/models');
        const group = catalog.groups?.find((item: any) => item.id === routeForProfile('profile-a').provider);
        assert.ok(group, 'route A must be visible from the real shared Harness catalog');
        assert.equal(group.models?.some((model: any) => model.id === 'same-model'), true, 'route A must expose its selected model');
        // This is a genuine Stage 1-shaped persisted header. The secure runtime
        // no longer injects the legacy provider's DEEPSEEK_API_KEY/base URL
        // environment contract, so migration must restore the session to A's
        // internal route before the next (and first post-migration) message.
        const legacyA = await request(origin, '/sessions', 'POST', {});
        await request(origin, `/sessions/${encodeURIComponent(legacyA.sessionId)}/models`, 'PUT', { provider: 'deepseek-official', model: 'same-model' });
        const emptyA = await request(origin, '/sessions', 'POST', {});
        await request(origin, `/sessions/${encodeURIComponent(emptyA.sessionId)}/models`, 'PUT', { provider: routeForProfile('profile-a').provider, model: 'same-model' });
        const first = await request(origin, '/sessions', 'POST', {});
        await request(origin, `/sessions/${encodeURIComponent(first.sessionId)}/models`, 'PUT', { provider: routeForProfile('profile-a').provider, model: 'same-model' });
        const firstPump = await startPump(origin, first.sessionId);
        await request(origin, `/sessions/${encodeURIComponent(first.sessionId)}/messages`, 'POST', { content: 'first', mode: 'queue' });
        await waitFor(() => a.requests.length >= 1).catch((error) => { throw new Error(`${error.message}; events=${firstPump.events.map((event) => event.type).join(',')}; routes=${a.requests.map((item) => item.path).join(',')}`); });
        firstPump.controller.abort();

        const second = await request(origin, '/sessions', 'POST', {});
        await request(origin, `/sessions/${encodeURIComponent(second.sessionId)}/models`, 'PUT', { provider: routeForProfile('profile-b').provider, model: 'same-model' });
        const secondPump = await startPump(origin, second.sessionId);
        await request(origin, `/sessions/${encodeURIComponent(second.sessionId)}/messages`, 'POST', { content: 'second', mode: 'queue' });
        await waitFor(() => b.requests.length >= 1);
        secondPump.controller.abort();
        const bAfterOwnTurn = b.requests.length;
        const aAfterOwnTurn = a.requests.length;

        const firstAgainPump = await startPump(origin, first.sessionId);
        await request(origin, `/sessions/${encodeURIComponent(first.sessionId)}/messages`, 'POST', { content: 'again', mode: 'queue' });
        await waitFor(() => a.requests.length > aAfterOwnTurn);
        firstAgainPump.controller.abort();
        assert.equal(b.requests.length, bAfterOwnTurn, 'continuing A must not reach B after the active profile changed');
        assert.ok(a.metadataRequests.includes('/props'), 'startup must read service metadata');
        assert.equal(a.requests.every((hit) => hit.path === 'POST /v1/chat/completions' && hit.authorization === `Bearer ${keyA}`), true);
        assert.equal(b.requests.every((hit) => hit.path === 'POST /v1/chat/completions' && hit.authorization === `Bearer ${keyB}`), true);
        assert.equal(a.requests.every((hit) => hit.model === 'same-model'), true);
        assert.equal(b.requests.every((hit) => hit.model === 'same-model'), true);

        // A new child with the *same* DSH_HOME must recover the persisted
        // session header; resume re-establishes only the gateway-local owner.
        const aBeforeRestart = a.requests.length; const bBeforeRestart = b.requests.length;
        await runtime.close();
        runtime = new DshWebRuntime(runtimeOptions);
        const restartedOrigin = await runtime.start();
        const restored = await request(restartedOrigin, '/sessions');
        assert.equal(restored.items.some((item: any) => item.sessionId === emptyA.sessionId), true, 'the shared root must retain a Stage 1-style session before any sidebar interaction');
        await request(restartedOrigin, `/sessions/${encodeURIComponent(legacyA.sessionId)}/resume`, 'POST', {});
        await restoreInternalSessionRoute({
          sessionId: legacyA.sessionId, profile: profiles[0], provider: routeForProfile('profile-a').provider, needsRestore: true,
          current: () => request(restartedOrigin, `/sessions/${encodeURIComponent(legacyA.sessionId)}/models`),
          select: (value) => request(restartedOrigin, `/sessions/${encodeURIComponent(legacyA.sessionId)}/models`, 'PUT', value),
        });
        const legacyAfterReloadPump = await startPump(restartedOrigin, legacyA.sessionId);
        const bBeforeLegacyAfterReload = b.requests.length; const aBeforeLegacyAfterReload = a.requests.length;
        await request(restartedOrigin, `/sessions/${encodeURIComponent(legacyA.sessionId)}/messages`, 'POST', { content: 'legacy A after B switch and CRUD reload', mode: 'queue' });
        await waitFor(() => a.requests.length > aBeforeLegacyAfterReload); legacyAfterReloadPump.controller.abort();
        assert.equal(b.requests.length, bBeforeLegacyAfterReload, 'legacy A must not silently inherit active B after shared runtime reload');
        await request(restartedOrigin, `/sessions/${encodeURIComponent(emptyA.sessionId)}/resume`, 'POST', {});
        await restoreInternalSessionRoute({
          sessionId: emptyA.sessionId, profile: profiles[0], provider: routeForProfile('profile-a').provider, needsRestore: true,
          current: () => request(restartedOrigin, `/sessions/${encodeURIComponent(emptyA.sessionId)}/models`),
          select: (value) => request(restartedOrigin, `/sessions/${encodeURIComponent(emptyA.sessionId)}/models`, 'PUT', value),
        });
        const emptyAPump = await startPump(restartedOrigin, emptyA.sessionId);
        const aBeforeEmptyRecovery = a.requests.length; const bBeforeEmptyRecovery = b.requests.length;
        await request(restartedOrigin, `/sessions/${encodeURIComponent(emptyA.sessionId)}/messages`, 'POST', { content: 'first message after B switch and restart', mode: 'queue' });
        await waitFor(() => a.requests.length > aBeforeEmptyRecovery); emptyAPump.controller.abort();
        assert.equal(b.requests.length, bBeforeEmptyRecovery, 'empty A must not inherit B after restart');
        await request(restartedOrigin, `/sessions/${encodeURIComponent(first.sessionId)}/resume`, 'POST', {});
        await request(restartedOrigin, `/sessions/${encodeURIComponent(second.sessionId)}/resume`, 'POST', {});
        const resumedAPump = await startPump(restartedOrigin, first.sessionId);
        await request(restartedOrigin, `/sessions/${encodeURIComponent(first.sessionId)}/messages`, 'POST', { content: 'after restart A', mode: 'queue' });
        await waitFor(() => a.requests.length > aBeforeRestart); resumedAPump.controller.abort();
        const resumedBPump = await startPump(restartedOrigin, second.sessionId);
        await request(restartedOrigin, `/sessions/${encodeURIComponent(second.sessionId)}/messages`, 'POST', { content: 'after restart B', mode: 'queue' });
        await waitFor(() => b.requests.length > bBeforeRestart); resumedBPump.controller.abort();
        assert.equal(a.requests.length > aBeforeRestart, true);
        assert.equal(b.requests.length > bBeforeRestart, true);
        const patchText = await readFile(patch, 'utf8');
        assert.equal(patchText.includes(keyA) || patchText.includes(keyB), false, 'owned patch must not contain a credential');
        const resolvedRefs = new Set(credentialRequests.filter((item) => item.operation === 'resolve').map((item) => item.ref));
        assert.equal(resolvedRefs.has(routeForProfile('profile-a').apiKeyEnv), true, 'route A must resolve through credential IPC');
        assert.equal(resolvedRefs.has(routeForProfile('profile-b').apiKeyEnv), true, 'route B must resolve through credential IPC');
        assert.equal(resolvedRefs.has('DEEPSEEK_API_KEY'), false, 'legacy selection must be restored before a post-migration turn resolves credentials');
        assert.equal(runtimeLogs.some((line) => line.includes(keyA) || line.includes(keyB)), false, 'runtime logs must not contain a credential');
      } finally { await runtime.close(); }
    } finally { await Promise.all([a.close(), b.close()]); }
  }, 90_000);
});

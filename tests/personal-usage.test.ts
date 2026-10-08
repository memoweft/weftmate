import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createUsageStore, normalizeUsage, usageCost, MIMO_PRICE, defaultUsagePrice } from '../src/personal-access/usage.mjs';
import { usageResponse } from '../src/personal-access/usage-response.mjs';
import { meteredNativeStream, usageSessionId } from '../src/personal-access/usage-native.mjs';
import { createModelScheduler } from '../src/model-scheduler.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';

const cloud = { id: 'mimo', model: 'mimo-v2.6-flash', name: 'MiMo', configured: true, sourceKind: 'cloud' };
const local = { id: 'local', model: 'local', name: 'Local', configured: true, sourceKind: 'local' };
async function fixture(t: any) {
    const root = await mkdtemp(join(tmpdir(), 'weft-usage-'));
    let time = Date.parse('2026-10-08T08:00:00Z');
    const store = await createUsageStore({ root, clock: () => time });
    t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
    const record = async (owner = 'a', model = cloud, sessionId: string | null = 'one', usage: any = { prompt_tokens: 1000, completion_tokens: 100 }) => {
        const id = await store.begin(owner, { sessionId, profileId: model.id, model });
        await store.finish(owner, id, usage); return id;
    };
    return { root, store, record, setTime: (date: string) => { time = Date.parse(date); } };
}
test('provider tokens include cache; native input excludes read/write; missing/malformed usage is unknown', () => {
    const sessions = new Map([['root', { header: {} }], ['child', { header: { parentSession: 'root' } }], ['grandchild', { header: { parentSession: 'child' } }]]);
    assert.equal(usageSessionId('grandchild', sessions), 'root');
    assert.deepEqual(normalizeUsage({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600 } }), { inputTokens: 1000, cachedInputTokens: 600, outputTokens: 50 });
    assert.deepEqual(normalizeUsage({ inputTokens: 400, outputTokens: 50, cacheReadTokens: 600, cacheWriteTokens: 10 }, 'dsh'), { inputTokens: 1010, cachedInputTokens: 600, outputTokens: 50 });
    for (const value of [null, {}, { prompt_tokens: 10 }, { prompt_tokens: -1, completion_tokens: 0 }, { prompt_tokens: 1, completion_tokens: 0, prompt_cache_hit_tokens: 2 }]) assert.equal(normalizeUsage(value), null);
    assert.equal(normalizeUsage({ inputTokens: 0, outputTokens: 0 }, 'dsh'), null);
    assert.equal(usageCost(normalizeUsage({ prompt_tokens: 1000, completion_tokens: 50, prompt_cache_hit_tokens: 600 }), MIMO_PRICE), 0.000512);
    assert.deepEqual(defaultUsagePrice(local), { input: 0, cachedInput: 0, output: 0 });
    assert.equal(defaultUsagePrice({ model: 'other', sourceKind: 'cloud' }), null);
});
test('numeric-only ledger survives reopen; price snapshots, unknown requests and owner/month/day/session/model aggregation', async t => {
    const f = await fixture(t);
    const id = await f.record('a', cloud, 'one', { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600 } });
    await f.store.finish('a', id, { prompt_tokens: 9000, completion_tokens: 3000 });
    f.setTime('2026-10-09T23:59:59Z'); await f.record('a', cloud, 'two', null);
    await f.record('a', local, 'two'); await f.record('b');
    await f.store.configure('a', { profileId: 'mimo', price: { input: 2, cachedInput: 0.1, output: 4 } });
    await f.record('a');
    f.setTime('2026-11-01T00:00:00Z'); await f.record('a');
    const summary = f.store.summary('a', '2026-10');
    assert.equal(summary.total.requests, 4); assert.equal(summary.total.unknownRequests, 1);
    assert.equal(summary.total.cost, 0.002912);
    assert.equal(summary.days.length, 31); assert.equal(summary.days[7].cost, 0.000512); assert.equal(summary.days[8].requests, 3);
    assert.equal(summary.sessions.length, 2); assert.equal(summary.models.length, 2);
    assert.equal(f.store.summary('a', '2026-10', 'one').total.requests, 2);
    assert.equal(f.store.summary('b', '2026-10').total.requests, 1);
    const reopened = await createUsageStore({ root: f.root }); assert.deepEqual(reopened.summary('a', '2026-10'), summary);
    const saved = JSON.parse(await readFile(join(f.root, 'usage.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved.accounts.a.records[0]).sort(), ['at', 'cost', 'durationMs', 'price', 'profileId', 'requestId', 'sessionId', 'source', 'tokens']);
});
test('80% warns; 100% blocks next cloud request; local bypasses; temporary increase expires next UTC month', async t => {
    const f = await fixture(t);
    await f.store.configure('a', { monthlyLimit: 0.0015 }); await f.record();
    assert.equal(f.store.summary('a').budget.state, 'warning');
    await f.store.configure('a', { monthlyLimit: 0.0012 });
    assert.equal(f.store.summary('a').budget.state, 'blocked');
    await assert.rejects(f.record(), { code: 'USAGE_LIMIT_REACHED', status: 402 });
    assert.equal(f.store.summary('a').total.requests, 1);
    await f.record('a', local); assert.equal(f.store.summary('a').total.cost, 0.0012);
    await f.store.configure('a', { temporaryLimit: 0.003 }); await f.record();
    assert.equal(f.store.summary('a').budget.state, 'warning');
    f.setTime('2026-11-01T00:00:00Z');
    assert.equal(f.store.summary('a').budget.effectiveLimit, 0.0012);
    assert.equal(f.store.summary('a').budget.temporaryLimit, null);
    await f.store.configure('a', { monthlyLimit: 0, temporaryLimit: null });
    await assert.rejects(f.record(), { code: 'USAGE_LIMIT_REACHED' }); await f.record('a', local);
    for (const input of [{ monthlyLimit: -1 }, { temporaryLimit: '1' }, { price: {} }, { profileId: 'x', price: { input: -1, output: 1, cachedInput: 0 } }]) await assert.rejects(f.store.configure('a', input), { code: 'INVALID_REQUEST' });
});
test('stream forwards exact bytes and accounts terminal cumulative usage once, JSON and cancelled responses too', async () => {
    const source = 'data: {"choices":[],"usage":{"prompt_tokens":123,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":100}}}\r\n\r\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(source); let calls: any[] = [];
    const response = new Response(new ReadableStream({ start(controller) { for (const b of bytes) controller.enqueue(Uint8Array.of(b)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    const observed = await usageResponse(response, (value: any) => { calls.push(value); });
    assert.equal(await observed.text(), source); assert.equal(calls.length, 1); assert.equal(calls[0].prompt_tokens_details.cached_tokens, 100);
    const json = await usageResponse(Response.json({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } }), (value: any) => { calls.push(value); });
    assert.equal((await json.json()).usage.prompt_tokens, 5); assert.equal(calls.length, 2);
    const missing = await usageResponse(Response.json({ choices: [] }), (value: any) => { calls.push(value); }); await missing.text(); assert.equal(calls.at(-1), null);
    const aborted = await usageResponse(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {}\n')); } }), { headers: { 'content-type': 'text/event-stream' } }), (value: any) => { calls.push(value); });
    await aborted.body.cancel(); assert.equal(calls.at(-1), null);
});
test('private bridge meters native foreground and scoped background streams, blocks before upstream and does not bill refusal', async t => {
    const f = await fixture(t); let upstream = 0;
    const bridge = await createModelScheduler({ isIdle: async () => true, profileFor: () => ({ id: 'mimo', baseUrl: 'https://synthetic.example/v1', model: cloud.model }), credentialFor: () => 'fixture', backgroundRoute: () => ({}),
        beginUsage: async (input: any) => ({ ownerId: input.ownerId || 'a', requestId: await f.store.begin(input.ownerId || 'a', { ...input, model: cloud }) }),
        finishUsage: (input: any) => f.store.finish(input.ownerId, input.requestId, input.usage, input.source),
        fetchImpl: async () => { upstream++; return Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 100 } }); } });
    t.after(() => bridge.close());
    const native = async function* () { yield { type: 'usage', usage: { inputTokens: 400, cacheReadTokens: 600, outputTokens: 100 } }; yield { type: 'finish' }; };
    for await (const _chunk of meteredNativeStream({ provider: 'mimo', sessionId: 'one' }, native, bridge.url)) { /* consume real private bridge */ }
    const background = await fetch(`${bridge.memoryBaseUrl('mimo', 'b', 'two')}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: '{}' });
    await background.text(); assert.equal(f.store.summary('b').sessions[0].sessionId, 'two');
    await f.store.configure('a', { monthlyLimit: 0 });
    await assert.rejects(async () => { for await (const _chunk of meteredNativeStream({ provider: 'mimo', sessionId: 'one' }, native, bridge.url)) {} }, { code: 'USAGE_LIMIT_REACHED' });
    const refused = await fetch(`${bridge.memoryBaseUrl('mimo', 'a', 'one')}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: '{}' });
    assert.equal(refused.status, 402); assert.equal(upstream, 1); assert.equal(f.store.summary('a').total.requests, 1);
});
test('authenticated API isolates usage/settings and refuses model proxy at limit before modelCompletion', async t => {
    const root = await mkdtemp(join(tmpdir(), 'weft-usage-http-')); let completions = 0;
    const backend = Object.fromEntries(['getStatus', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(key => [key, async () => ({})]));
    backend.listModels = async () => [cloud, local];
    backend.modelCompletion = async () => { completions++; return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 500 } } }); };
    const service = await createPersonalAccessService({ root, port: 0, backend });
    t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
    const { origin } = await service.start();
    const api = async (path: string, method = 'GET', body?: any, auth?: any) => {
        const response = await fetch(`${origin}/personal/v1${path}`, { method, headers: { origin, 'content-type': 'application/json', ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
    };
    const grant = await service.issueSetupGrant();
    const register = async (username: string, setup = false) => { const result = await api(setup ? '/auth/setup' : '/auth/register', 'POST', { username, password: 'Synthetic-usage-password-2026', deviceName: 'fixture', ...(setup ? { grant: grant.grant } : {}) }); assert.equal(result.status, 201); return { cookie: result.cookie, csrf: result.body.csrfToken }; };
    const a = await register('UsageA', true), b = await register('UsageB');
    assert.equal((await api('/usage')).status, 401);
    const body = { model: cloud.model, messages: [{ role: 'user', content: 'synthetic' }] };
    assert.equal((await api('/models/mimo/chat/completions', 'POST', body, a)).status, 200);
    assert.equal((await api('/usage', 'GET', undefined, a)).body.total.cost, 0.00071);
    assert.equal((await api('/usage', 'GET', undefined, b)).body.total.requests, 0);
    assert.equal((await api('/settings/usage', 'PATCH', { monthlyLimit: 0 }, a)).status, 200);
    assert.equal((await api('/models/mimo/chat/completions', 'POST', body, a)).status, 402);
    assert.equal(completions, 1);
    assert.equal((await api('/usage?sessionId=foreign', 'GET', undefined, b)).status, 404);
    assert.equal((await api('/settings/usage', 'GET', undefined, b)).body.monthlyLimit, null);
    assert.equal((await api('/usage?month=2026-13', 'GET', undefined, a)).status, 400);
});
test('ui-core usage reads work outside account settings, uses CSRF, discards late account responses and warns once', async () => {
    const context: any = { URL, URLSearchParams, AbortSignal, Intl, Date, setTimeout, clearTimeout, setInterval, clearInterval };
    for (const name of uiCoreAssets.filter(row => !row.startsWith('adapters/'))) runInNewContext(await readFile(new URL(`../src/ui-core/${name}`, import.meta.url), 'utf8'), context);
    const requests: any[] = [], toasts: string[] = []; let gate: Promise<void> | null = null, release!: () => void;
    const core = context.WeftUiCore.create({ effects: { paintConnection() {}, updateAvailability() {}, toast: (message: string) => toasts.push(message) }, fetch: async (path: string, options: any) => {
        requests.push({ path, options });
        if (gate) await gate;
        return { ok: true, json: async () => path.includes('/settings/usage') ? { models: [] } : path.endsWith('/sessions') ? { sessions: [] } : { month: '2026-10', sessions: [], models: [], budget: { state: 'warning' } } };
    } });
    Object.assign(core.state, { account: { ownerId: 'a' }, device: { id: 'device' }, csrfToken: 'synthetic', currentView: 'assistant' });
    assert.ok(await core.loadUsage());
    await core.saveUsageSettings({ monthlyLimit: 1 }); assert.equal(requests.at(-1).options.headers['X-WeftMate-CSRF'], 'synthetic');
    await core.refreshUsageBudget(); await core.refreshUsageBudget(); assert.equal(toasts.length, 1);
    gate = new Promise(resolve => { release = resolve; });
    const pending = core.loadUsage(); await Promise.resolve(); core.state.account = { ownerId: 'b' }; core.state.identityGeneration++;
    release(); assert.equal(await pending, null);
});

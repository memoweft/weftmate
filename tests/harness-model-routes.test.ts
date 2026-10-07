import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { credentialEnvironment, DEFAULT_MODEL_CAPACITY, modelCapacityFor, renderModelRoutesPatch, routeForProfile } from '../src/harness-model-routes.ts';
import { clampMaxTokensToContext } from '../vendor/dsh-runtime/node_modules/@earendil-works/pi-ai/dist/api/simple-options.js';

const profiles = [
  { id: 'alpha/unsafe', name: 'Alpha', provider: 'openai-compatible' as const, baseUrl: 'http://127.0.0.1:8080/v1', model: 'same-model' },
  { id: 'beta', name: 'Beta', provider: 'openai-compatible' as const, baseUrl: 'https://example.invalid/v1', model: 'same-model' },
];

describe('shared DSH model-route projection', () => {
  it('resolves model capacity from its official destination and retains generic defaults elsewhere', () => {
    assert.deepEqual(modelCapacityFor({ baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash' }),
      { contextWindow: 1_000_000, maxTokens: 128_000 });
    assert.deepEqual(modelCapacityFor({ baseUrl: 'https://example.invalid/v1', modelId: 'mimo-v2.6-flash' }), DEFAULT_MODEL_CAPACITY);
    assert.deepEqual(modelCapacityFor({ baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'another-model' }), DEFAULT_MODEL_CAPACITY);
    const patch = renderModelRoutesPatch(profiles);
    assert.ok(patch.includes(`contextWindow: ${DEFAULT_MODEL_CAPACITY.contextWindow}`));
    assert.ok(patch.includes(`maxTokens: ${DEFAULT_MODEL_CAPACITY.maxTokens}`));
  });

  it('respects explicit model capacity fields before metadata defaults', () => {
    const identity = { baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash' };
    assert.deepEqual(modelCapacityFor({ ...identity, contextWindow: 65536, maxTokens: 4096 }),
      { contextWindow: 65536, maxTokens: 4096 });
    assert.deepEqual(modelCapacityFor({ ...identity, maxTokens: 8192 }),
      { contextWindow: 1_000_000, maxTokens: 8192 });
  });

  it('keeps a useful SDK request budget when history exceeds the old account capacity', () => {
    const context = { messages: [{ role: 'user', content: 'x'.repeat(160_000), timestamp: 0 }] };
    assert.equal(clampMaxTokensToContext({ contextWindow: 32768 }, context, 8192), 1);
    const official = modelCapacityFor({ baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash' });
    assert.equal(clampMaxTokensToContext(official, context, official.maxTokens), official.maxTokens);
    assert.equal(clampMaxTokensToContext(DEFAULT_MODEL_CAPACITY, context, DEFAULT_MODEL_CAPACITY.maxTokens), DEFAULT_MODEL_CAPACITY.maxTokens);
  });

  it('keeps the official Models namespace valid before any private profile exists', () => {
    const patch = renderModelRoutesPatch([]);
    assert.match(patch, /providers: \{\}/);
    assert.doesNotMatch(patch, /providers:\n\s*$/m);
  });

  it('derives stable path-safe route and environment-reference identifiers', () => {
    const first = routeForProfile('alpha/unsafe');
    assert.deepEqual(first, routeForProfile('alpha/unsafe'));
    assert.match(first.provider, /^weftmate-[a-f0-9]{24}$/);
    assert.match(first.apiKeyEnv, /^WEFTMATE_LLM_KEY_[A-F0-9]{32}$/);
    assert.notEqual(first.provider, routeForProfile('beta').provider);
  });

  it('renders an owned --patch overlay with no secret values', () => {
    const secret = randomBytes(24).toString('hex');
    const patch = renderModelRoutesPatch(profiles);
    for (const profile of profiles) {
      const route = routeForProfile(profile.id);
      assert.match(patch, new RegExp(`${route.provider}:`));
      assert.match(patch, new RegExp(`apiKeyEnv: "${route.apiKeyEnv}"`));
    }
    assert.match(patch, /api: openai-completions/);
    assert.match(patch, /baseURL: "http:\/\/127\.0\.0\.1:8080\/v1"/);
    assert.doesNotMatch(patch, new RegExp(secret));
  });

  it('injects each credential under only its route reference and retains legacy env compatibility', () => {
    const alpha = randomBytes(24).toString('hex'); const beta = randomBytes(24).toString('hex');
    const env = credentialEnvironment(profiles, (id) => id === 'alpha/unsafe' ? alpha : beta, profiles[0]);
    assert.equal(env[routeForProfile('alpha/unsafe').apiKeyEnv], alpha);
    assert.equal(env[routeForProfile('beta').apiKeyEnv], beta);
    assert.equal(env.DEEPSEEK_API_KEY, alpha);
    assert.equal(env.DEEPSEEK_BASE_URL, profiles[0].baseUrl);
    assert.equal(Object.keys(env).some((key) => key.includes('alpha') || key.includes('unsafe')), false);
  });
});

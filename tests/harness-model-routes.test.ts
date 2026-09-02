import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { credentialEnvironment, renderModelRoutesPatch, routeForProfile } from '../src/harness-model-routes.ts';

const profiles = [
  { id: 'alpha/unsafe', name: 'Alpha', provider: 'openai-compatible' as const, baseUrl: 'http://127.0.0.1:8080/v1', model: 'same-model' },
  { id: 'beta', name: 'Beta', provider: 'openai-compatible' as const, baseUrl: 'https://example.invalid/v1', model: 'same-model' },
];

describe('shared DSH model-route projection', () => {
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

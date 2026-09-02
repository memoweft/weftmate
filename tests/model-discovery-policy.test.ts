import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveModelDiscoveryRequest } from '../src/model-discovery-policy.ts';
import type { PublicModelProfile } from '../src/stage2-config.ts';

const saved: PublicModelProfile = {
  id: 'local-qwen',
  name: 'Local Qwen',
  provider: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:8080/v1',
  model: 'qwen',
};

describe('model discovery credential policy', () => {
  it('uses a newly entered credential without reading the vault', () => {
    let reads = 0;
    const request = resolveModelDiscoveryRequest({
      provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', apiKey: ' fresh-key ',
    }, [], () => { reads += 1; return 'must-not-be-read'; });
    assert.deepEqual(request, { provider: 'openai-compatible', baseUrl: saved.baseUrl, apiKey: 'fresh-key' });
    assert.equal(reads, 0);
  });

  it('reuses the stored credential only for the same id, provider, and canonical endpoint', () => {
    let reads = 0;
    const request = resolveModelDiscoveryRequest({
      id: saved.id, provider: saved.provider, baseUrl: 'http://127.0.0.1:8080/v1/', apiKey: '',
    }, [saved], (id) => { reads += 1; assert.equal(id, saved.id); return 'stored-key'; });
    assert.deepEqual(request, { provider: saved.provider, baseUrl: saved.baseUrl, apiKey: 'stored-key' });
    assert.equal(reads, 1);
  });

  it('does not read the vault for a new profile, unknown id, or changed endpoint', () => {
    for (const input of [
      { provider: saved.provider, baseUrl: saved.baseUrl, apiKey: '' },
      { id: 'unknown', provider: saved.provider, baseUrl: saved.baseUrl, apiKey: '' },
      { id: saved.id, provider: saved.provider, baseUrl: 'http://127.0.0.1:9090/v1', apiKey: '' },
    ]) {
      let reads = 0;
      assert.throws(() => resolveModelDiscoveryRequest(input, [saved], () => { reads += 1; return 'stored-key'; }));
      assert.equal(reads, 0);
    }
  });

  it('fails closed when the matching profile has no readable credential', () => {
    assert.throws(() => resolveModelDiscoveryRequest({
      id: saved.id, provider: saved.provider, baseUrl: saved.baseUrl, apiKey: '',
    }, [saved], () => null));
  });

  it('rejects an unsupported provider or unsafe public endpoint before reading the vault', () => {
    let reads = 0;
    for (const input of [
      { id: saved.id, provider: 'other', baseUrl: saved.baseUrl, apiKey: '' },
      { id: saved.id, provider: saved.provider, baseUrl: 'https://user:secret@example.com/v1', apiKey: '' },
      { id: saved.id, provider: saved.provider, baseUrl: 'https://example.com/v1?token=public-leak', apiKey: '' },
    ]) assert.throws(() => resolveModelDiscoveryRequest(input, [saved], () => { reads += 1; return 'stored-key'; }));
    assert.equal(reads, 0);
  });
});

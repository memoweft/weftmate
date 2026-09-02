import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveModelSaveCredential } from '../src/model-save-policy.ts';

describe('model save credential scope policy', () => {
  it('never starts a discovery request when a blank edit would send an old key to a new endpoint', async () => {
    let attackerRequests = 0;
    await assert.rejects(async () => {
      const key = resolveModelSaveCredential({ prior: { provider: 'openai-compatible', baseUrl: 'https://trusted.example/v1' }, provider: 'openai-compatible', baseUrl: 'https://attacker.example/v1', providedKey: '', storedKey: 'test-only' });
      attackerRequests++; void key;
    });
    assert.equal(attackerRequests, 0);
  });

  it('permits blank key reuse only for the exact unchanged canonical scope', () => {
    assert.equal(resolveModelSaveCredential({ prior: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1' }, provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', providedKey: '', storedKey: 'test-only' }), 'test-only');
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { modelTierFor } from '../src/model-tier.ts';
import { memoryRecallModelTier } from '../src/personal-memory/policy.mjs';
import { normalizeApiBaseUrl } from '../src/stage2-config.ts';
import { createPersonalAccessBackend } from '../src/personal-access-backend.mjs';

test('automatic model tier covers loopback, private subnet boundaries and local names', () => {
  const local = ['127.0.0.1', '127.0.0.2', '127.255.255.255', '[::1]',
    '[0:0:0:0:0:0:0:1]', 'localhost', 'LOCALHOST.', '10.0.0.0', '10.255.255.255',
    '172.16.0.0', '172.31.255.255', '192.168.0.0', '192.168.255.255', 'qwen.local', 'QWEN.LOCAL.'];
  const cloud = ['126.255.255.255', '128.0.0.0', '9.255.255.255', '11.0.0.0',
    '172.15.255.255', '172.32.0.0', '192.167.255.255', '192.169.0.0',
    '8.8.8.8', '[2001:db8::1]', 'local.example', 'localhost.example', 'qwen.local.example', '10e0.0.0.1'];
  for (const [hosts, expected] of [[local, 'local'], [cloud, 'cloud']] as const) {
    for (const host of hosts) {
      for (const protocol of ['http', 'https']) {
        const profile = { id: 'private-model-user', baseUrl: `${protocol}://${host}:18080/v1` };
        assert.equal(memoryRecallModelTier(profile), expected, profile.baseUrl);
        assert.equal(modelTierFor({ ...profile, modelTier: 'auto' }), expected);
      }
    }
  }
  for (const baseUrl of ['', 'not a URL']) assert.equal(modelTierFor({ baseUrl }), 'cloud');
  assert.equal(modelTierFor(null), 'cloud');
});

test('explicit user tier overrides either endpoint and the model directory reports the same result', () => {
  const profiles = [
    { id: 'proxy', name: 'Proxy', model: 'fixture', baseUrl: 'http://127.0.0.1:18080/v1', modelTier: 'cloud' },
    { id: 'remote', name: 'Remote', model: 'fixture', baseUrl: 'https://model.example/v1', modelTier: 'local' },
    { id: 'lan', name: 'LAN', model: 'fixture', baseUrl: 'http://192.168.1.10:18080/v1' },
  ];
  const backend = createPersonalAccessBackend({ profiles: () => profiles, hasCredential: () => true } as any);
  const directory = backend.listModels();
  profiles.forEach((profile, index) => {
    assert.equal(directory[index].sourceKind, memoryRecallModelTier(profile));
    assert.equal(directory[index].modelTier, profile.modelTier ?? 'auto');
  });
  assert.equal(directory[0].sourceKind, 'cloud');
  assert.equal(directory[1].sourceKind, 'local');
  assert.equal(directory[2].sourceKind, 'local');
});

test('HTTP local endpoints are saveable including LAN, while public HTTP remains invalid', () => {
  for (const host of ['127.0.0.1', '[::1]', 'localhost', '10.0.0.1', '172.16.0.1', '192.168.1.10', 'qwen.local']) {
    const baseUrl = `http://${host}:18080/v1`;
    assert.equal(normalizeApiBaseUrl(baseUrl), baseUrl);
  }
  assert.equal(normalizeApiBaseUrl('http://model.example/v1'), null);
  assert.equal(normalizeApiBaseUrl('http://192.168.1.10/v1?key=secret'), null);
});

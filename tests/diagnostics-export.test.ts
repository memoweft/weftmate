import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { buildRedactedDiagnostics } from '../src/diagnostics-export.ts';

describe('redacted diagnostics export', () => {
  it('projects public settings only and excludes runtime paths, origins and generated credentials', () => {
    const secret = randomBytes(24).toString('hex');
    const result = buildRedactedDiagnostics({
      version: '0.1.0', configured: true, ready: true,
      settings: { schemaVersion: 3, appearance: { theme: 'dark' }, models: { profiles: [{ id: 'a', name: 'A', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'm' }], activeId: 'a' } },
      models: { profiles: [{ id: 'a', name: 'A', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'm', hasKey: true, apiKey: secret }], activeId: 'a' },
      packaged: true, safeStorageAvailable: true,
      update: { enabled: true, status: 'error', version: null, error: '无法连接预发布更新源。请检查网络或稍后重试。' },
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes('runtimeOrigin'), false);
    assert.equal(serialized.includes('dsh-home'), false);
    assert.equal(serialized.includes('userData'), false);
    assert.equal(serialized.includes('127.0.0.1'), false);
    assert.equal(result.security.protectedCredentialProfiles, 1);
    assert.equal(result.dataPolicy.userConfiguration, 'retained-on-uninstall');
  });
});

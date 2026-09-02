import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prepareLegacyVaultMigration } from '../src/legacy-vault-migration.ts';

describe('Stage 1 combined encrypted vault migration', () => {
  it('preserves complete multi-profile write/embed payloads while extracting only usable llm metadata', () => {
    const oldVault = {
      activeId: 'profile-b',
      profiles: [
        { id: 'profile-a', name: 'A', llm: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'test-llm-a', model: 'model-a' }, write: { baseUrl: 'https://write.example/v1', apiKey: 'test-write-a', model: 'writer-a', tier: 'premium' }, embed: { baseUrl: 'https://embed.example/v1', apiKey: 'test-embed-a', model: 'embed-a' } },
        { id: 'profile-b', name: 'B', llm: { baseUrl: 'https://models.example/v1', apiKey: 'test-llm-b', model: 'model-b' }, write: { baseUrl: 'https://write-b.example/v1', apiKey: 'test-write-b', model: 'writer-b', tier: 'balanced' }, embed: { baseUrl: 'https://embed-b.example/v1', apiKey: 'test-embed-b', model: 'embed-b' } },
      ],
    };
    const migrated = prepareLegacyVaultMigration(oldVault);
    assert.ok(migrated); assert.equal(migrated.activeId, 'profile-b'); assert.equal(migrated.credentials['profile-a'], 'test-llm-a'); assert.equal(migrated.credentials['profile-b'], 'test-llm-b');
    assert.deepEqual(migrated.legacyPayload.document, oldVault);
    assert.equal(JSON.stringify(migrated.publicProfiles).includes('test-write-a'), false);
    assert.equal(JSON.stringify(migrated.publicProfiles).includes('test-embed-b'), false);
    assert.equal(JSON.stringify(migrated.publicProfiles).includes('tier'), false);
    assert.equal(prepareLegacyVaultMigration({ schemaVersion: 2, credentials: migrated.credentials, legacyPayload: migrated.legacyPayload }), null);
  });

  it('preserves the single top-level llm/write/embed form without exposing private siblings', () => {
    const oldVault = { llm: { baseUrl: 'http://localhost:8080/v1', apiKey: 'test-llm', model: 'model' }, write: { apiKey: 'test-write', tier: 'fast' }, embed: { apiKey: 'test-embed', model: 'embed' } };
    const migrated = prepareLegacyVaultMigration(oldVault);
    assert.ok(migrated); assert.equal(migrated.publicProfiles[0].id, 'p-legacy'); assert.deepEqual(migrated.legacyPayload.document, oldVault);
  });

  it('rejects corrupt or unknown old data instead of manufacturing an empty replacement vault', () => {
    assert.throws(() => prepareLegacyVaultMigration(null));
    assert.throws(() => prepareLegacyVaultMigration({ unrelated: true }));
  });
});

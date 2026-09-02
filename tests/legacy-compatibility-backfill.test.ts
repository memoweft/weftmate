import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectLegacyCompatibilityBackfill } from '../src/legacy-compatibility-backfill.ts';

const profiles = [
  { id: 'legacy', name: 'Legacy', provider: 'openai-compatible' as const, baseUrl: 'http://127.0.0.1:8080/v1', model: 'old' },
  { id: 'active-now', name: 'Active', provider: 'openai-compatible' as const, baseUrl: 'http://127.0.0.1:8081/v1', model: 'new' },
];

describe('legacy compatibility backfill', () => {
  it('backfills only an exact encrypted legacy id/endpoint/model match, never active or a single-profile guess', () => {
    assert.equal(selectLegacyCompatibilityBackfill({ recordedId: null, profiles, evidence: { id: 'legacy', baseUrl: profiles[0].baseUrl, model: 'old' } }), 'legacy');
    assert.equal(selectLegacyCompatibilityBackfill({ recordedId: null, profiles, evidence: { id: 'legacy', baseUrl: profiles[0].baseUrl, model: 'changed' } }), null);
    assert.equal(selectLegacyCompatibilityBackfill({ recordedId: null, profiles: [profiles[1]], evidence: { id: 'legacy', baseUrl: profiles[0].baseUrl, model: 'old' } }), null);
    assert.equal(selectLegacyCompatibilityBackfill({ recordedId: 'active-now', profiles, evidence: { id: 'legacy', baseUrl: profiles[0].baseUrl, model: 'old' } }), null);
  });
});

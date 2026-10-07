import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, test } from 'node:test';
import { PRODUCT_CONFIG_SCHEMA_VERSION, ProductConfigStore, normalizeProductConfig } from '../src/stage2-config.ts';

test('an explicit null active model stays null when account routes are added', () => {
  const profile = { id: 'private-model-a', name: 'Account model', provider: 'openai-compatible',
    baseUrl: 'https://example.test/v1', model: 'model-a' };
  assert.equal(normalizeProductConfig({ models: { profiles: [profile], activeId: null } }).models.activeId, null);
  assert.equal(normalizeProductConfig({ models: { profiles: [profile] } }).models.activeId, profile.id,
    'pre-existing documents without the field retain legacy inference');
});

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function store() { const root = mkdtempSync(join(tmpdir(), 'weftmate-stage2-settings-')); roots.push(root); return { root, file: join(root, 'weftmate-settings.json'), store: new ProductConfigStore(join(root, 'weftmate-settings.json')) }; }

describe('Stage 2 non-secret configuration', () => {
  it('persists model tier overrides and auto while old profiles remain compatible after reopening', () => {
    const { file, store: settings } = store();
    const profile = { name: 'Local', provider: 'openai-compatible', baseUrl: 'http://192.168.1.10:18080/v1', model: 'qwen' };
    settings.write(normalizeProductConfig({ models: { profiles: [
      { ...profile, id: 'legacy' }, { ...profile, id: 'automatic', modelTier: 'auto' },
      { ...profile, id: 'local', modelTier: 'local' }, { ...profile, id: 'proxy', modelTier: 'cloud' },
    ] } }));
    assert.deepEqual(new ProductConfigStore(file).read().models.profiles.map(p => p.modelTier),
      [undefined, 'auto', 'local', 'cloud']);
  });
  it('provides a schema-versioned default and preserves legacy non-secret preferences', () => {
    const { store: settings } = store();
    assert.deepEqual(settings.read().appearance, { theme: 'system' });
    const migrated = normalizeProductConfig({ perception: { cloudAllowed: true }, desktopPet: { visible: true } });
    assert.equal(migrated.schemaVersion, PRODUCT_CONFIG_SCHEMA_VERSION);
    assert.equal(migrated.perception?.cloudAllowed, true);
    assert.equal(migrated.desktopPet?.visible, true);
  });

  it('validates profiles, removes invalid active ids, and never accepts a secret field', () => {
    const result = normalizeProductConfig({ schemaVersion: 1, appearance: { theme: 'dark' }, models: { activeId: 'missing', profiles: [{ id: 'local', name: 'Local', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen', apiKey: 'must-not-persist' }] } });
    assert.equal(result.appearance.theme, 'dark'); assert.equal(result.models.activeId, 'local');
    assert.equal(JSON.stringify(result).includes('must-not-persist'), false);
    assert.equal(JSON.stringify(result).includes('apiKey'), false);
  });

  it('persists only validated non-secret session-to-profile migration bindings', () => {
    const result = normalizeProductConfig({
      models: { activeId: 'local', profiles: [{ id: 'local', name: 'Local', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen' }] },
      sessionBindings: { 'session-a': 'local', 'session-unknown': 'missing', '': 'local', 'session-secret': { apiKey: 'must-not-persist' } },
    });
    assert.deepEqual(result.sessionBindings, { 'session-a': { profileId: 'local', restoreInternalRoute: false } });
    assert.equal(JSON.stringify(result).includes('must-not-persist'), false);
  });

  it('retains an explicit legacy compatibility profile only when it names a durable known profile', () => {
    const source = { models: { activeId: 'new-active', profiles: [
      { id: 'old-legacy', name: 'Old', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'old' },
      { id: 'new-active', name: 'New', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8081/v1', model: 'new' },
    ] } };
    assert.equal(normalizeProductConfig({ ...source, legacyCompatibilityProfileId: 'old-legacy' }).legacyCompatibilityProfileId, 'old-legacy');
    assert.equal(normalizeProductConfig({ ...source, legacyCompatibilityProfileId: 'missing' }).legacyCompatibilityProfileId, null);
    assert.equal(normalizeProductConfig(source).legacyCompatibilityProfileId, null, 'activeId is not an implicit compatibility fallback');
  });

  it('keeps a valid session binding after a cold store reopen', () => {
    const { file, store: settings } = store();
    settings.write(normalizeProductConfig({
      models: { activeId: 'local', profiles: [{ id: 'local', name: 'Local', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen' }] },
      sessionBindings: { 'persisted-session': { profileId: 'local', restoreInternalRoute: true } },
    }));
    assert.deepEqual(new ProductConfigStore(file).read().sessionBindings['persisted-session'], { profileId: 'local', restoreInternalRoute: true });
  });

  it('backs up a corrupt document and safely falls back instead of overwriting it', () => {
    const { root, file, store: settings } = store(); writeFileSync(file, '{invalid', 'utf8');
    assert.equal(settings.read().schemaVersion, PRODUCT_CONFIG_SCHEMA_VERSION);
    assert.equal(existsSync(file), true);
    assert.equal(readdirSync(root).some((name) => name.includes('.corrupt-')), true);
    assert.equal(readFileSync(file, 'utf8'), '{invalid');
  });

  it('serialises concurrent updates and atomically leaves a complete valid JSON document', async () => {
    const { file, store: settings } = store();
    await Promise.all([
      settings.update((current) => ({ ...current, appearance: { theme: 'light' } })),
      settings.update((current) => ({ ...current, models: { profiles: [{ id: 'local', name: 'Local', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen' }], activeId: 'local' } })),
    ]);
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(disk.appearance.theme, 'light'); assert.equal(disk.models.activeId, 'local');
    assert.equal(disk.schemaVersion, PRODUCT_CONFIG_SCHEMA_VERSION);
    assert.equal(readdirSync(join(file, '..')).some((name) => name.endsWith('.tmp')), false);
  });
});

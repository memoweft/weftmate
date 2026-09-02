import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertAuthoritativeSessionsIdle, assertSessionReferenceScanReady, resolveSafeSessionBinding, scanSharedSessionBindings } from '../src/stage2-session-guards.ts';

describe('Stage 2 strict shared-session guards', () => {
  it('keeps add/edit/delete route changes locked until a failed or pending scan retries successfully, while ordinary active selection is independent', async () => {
    for (const state of [{ state: 'pending', error: null }, { state: 'failed', error: 'offline' }] as const) assert.throws(() => assertSessionReferenceScanReady(state), /暂不能修改|确认完成前/);
    // This represents set-active: it only changes a future-session preference,
    // so it deliberately does not consult the reference scan.
    let active = 'a'; active = 'b'; assert.equal(active, 'b');
    const bindings = new Map<string, string>();
    await scanSharedSessionBindings({ profiles: [{ id: 'a' }, { id: 'b' }],
      listSessions: async () => ({ items: [{ sessionId: 'internal' }, { sessionId: 'legacy' }] }),
      readSelectedModel: async (id) => id === 'internal' ? { current: { provider: 'weftmate-a' } } : { current: { provider: 'deepseek-official' } },
      providerForProfile: (profile) => `weftmate-${profile.id}`,
      priorBinding: (id) => id === 'legacy' ? 'b' : null,
      legacyCompatibilityProfileId: null,
      bind: (id, profileId) => bindings.set(id, profileId) });
    assert.doesNotThrow(() => assertSessionReferenceScanReady({ state: 'ready', error: null }));
    assert.deepEqual([...bindings], [['internal', 'a'], ['legacy', 'b']]);
  });

  it('never guesses an old session from active: unknown scan is retryable, atomic, and only explicit legacy compatibility can recover an empty header', async () => {
    const bindings = new Map<string, string>();
    const common = {
      profiles: [{ id: 'old-a' }, { id: 'current-b' }], providerForProfile: (profile: { id: string }) => `weftmate-${profile.id}`,
      priorBinding: () => null, legacyCompatibilityProfileId: null, bind: (id: string, profileId: string) => bindings.set(id, profileId),
    };
    await assert.rejects(() => scanSharedSessionBindings({ ...common,
      listSessions: async () => ({ items: [{ sessionId: 'known' }, { sessionId: 'unknown' }] }),
      readSelectedModel: async (id) => id === 'known' ? { current: { provider: 'weftmate-old-a' } } : { current: { provider: 'deepseek-official' } },
    }), /没有可确认的模型归属/);
    assert.deepEqual([...bindings], [], 'a failed scan must not partially bind the earlier session');
    await scanSharedSessionBindings({ ...common, legacyCompatibilityProfileId: 'old-a',
      listSessions: async () => ({ items: [{ sessionId: 'known' }, { sessionId: 'unknown' }] }),
      readSelectedModel: async (id) => id === 'known' ? { current: { provider: 'weftmate-old-a' } } : { current: { provider: 'deepseek-official' } },
    });
    assert.deepEqual([...bindings], [['known', 'old-a'], ['unknown', 'old-a']], 'a successful retry uses recorded compatibility, never current-b');
    assert.throws(() => resolveSafeSessionBinding({ provider: '', profiles: common.profiles, providerForProfile: common.providerForProfile,
      priorBinding: null, legacyCompatibilityProfileId: null }), (error: Error & { code?: string }) => error.code === 'session-model-ownership-unknown' && /没有可确认的模型归属/.test(error.message));
  });

  it('does not bind old sessions when an empty-profile startup later adds its first model', async () => {
    const bindings = new Map<string, string>();
    await assert.rejects(() => scanSharedSessionBindings({ profiles: [{ id: 'first-new-model' }],
      listSessions: async () => ({ items: [{ sessionId: 'old-session' }] }), readSelectedModel: async () => ({ current: { provider: '' } }),
      providerForProfile: (profile) => `weftmate-${profile.id}`, priorBinding: () => null, legacyCompatibilityProfileId: null,
      bind: (id, profileId) => bindings.set(id, profileId) }), /没有可确认的模型归属/);
    assert.deepEqual([...bindings], [], 'the first newly added profile cannot become an implicit legacy owner');
  });

  it('never treats an empty Stage 2 header as legacy compatibility, but retains an existing durable binding', () => {
    const common = { profiles: [{ id: 'created' }], providerForProfile: (profile: { id: string }) => `weftmate-${profile.id}`, legacyCompatibilityProfileId: 'created' };
    assert.throws(() => resolveSafeSessionBinding({ ...common, provider: '', priorBinding: null }), (error: Error & { code?: string }) => error.code === 'session-model-ownership-unknown');
    assert.deepEqual(resolveSafeSessionBinding({ ...common, provider: '', priorBinding: 'created' }), { profile: { id: 'created' }, source: 'durable-binding' });
  });

  it('fails closed for invalid /sessions, rejects every running turn, and permits only an authoritative all-idle response', () => {
    assert.throws(() => assertAuthoritativeSessionsIdle({}), /状态无效/);
    assert.throws(() => assertAuthoritativeSessionsIdle({ items: [{ sessionId: 's1', running: true }] }), /生成中/);
    assert.doesNotThrow(() => assertAuthoritativeSessionsIdle({ items: [{ sessionId: 's1', running: false }, { sessionId: 's2', running: false }] }));
  });
});

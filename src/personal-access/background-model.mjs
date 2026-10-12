import { currentChatProfile } from '../background-model-selection.mjs';

/** The existing account setting owns fallback; an available model never flips it back. */
export function createBackgroundModels(context) {
  const failures = new Map(), switching = new Map();
  const selectable = (owner, id) => context.modelSelectable ? context.modelSelectable(owner, id) : true;
  const chat = owner => currentChatProfile(context.accountState(owner), id => selectable(owner, id));
  async function fallback(owner, profileId) {
    if (switching.has(owner)) return switching.get(owner);
    if (!chat(owner) || chat(owner) === profileId) return;
    let changed = false;
    const work = Promise.resolve(context.serial(() => context.mutate(owner, next => {
      if (next.backgroundModelProfileId !== profileId || !chat(owner) || chat(owner) === profileId) return;
      next.backgroundModelFallback = { profileId, at: new Date(context.timestamp()).toISOString() };
      next.backgroundModelProfileId = null;
      changed = true;
    }))).then(() => {
      if (changed) failures.delete(`${owner}/${profileId}`);
      // Finish the response that triggered fallback before closing its memory worker.
      if (changed) setImmediate(async () => { try { await context.memoryManager?.invalidateOwnerRoute?.(owner); } catch { /* Keep chat usable if memory reconnect fails. */ } });
    }).finally(() => switching.delete(owner));
    switching.set(owner, work); await work;
  }
  function selected(owner, available = () => true) {
    const id = context.accountState(owner).backgroundModelProfileId ?? null;
    if (id && (!selectable(owner, id) || !available(id))) {
      void fallback(owner, id).catch(() => {});
      return null;
    }
    return id;
  }
  async function resolve(owner, models) {
    const id = context.accountState(owner).backgroundModelProfileId;
    if (id && (!selectable(owner, id) || !models.some(row => row.id === id && row.configured !== false))) await fallback(owner, id);
    return context.accountState(owner).backgroundModelProfileId ?? chat(owner);
  }
  async function report(owner, profileId, { unavailable = false, failed = false, aborted = false } = {}) {
    if (!owner || aborted || context.accountState(owner).backgroundModelProfileId !== profileId) return;
    const key = `${owner}/${profileId}`;
    if (!failed && !unavailable) { failures.delete(key); return; }
    const count = (failures.get(key) ?? 0) + 1; failures.set(key, count);
    if (unavailable || count >= 3) await fallback(owner, profileId);
  }
  async function completion(native, input) {
    const { ownerId: owner, signal } = input;
    const models = await context.callBackend(() => context.backend.listModels({ ownerId: owner }));
    const id = await resolve(owner, models);
    const invoke = profileId => {
      signal?.throwIfAborted();
      const profile = models.find(row => row.id === profileId);
      return native({ ...input, profileId, ...(input.onStart ? { onStart: () => input.onStart({ profileId, model: profile }) } : {}),
        body: { ...input.body, model: profile?.model ?? input.body.model } });
    };
    let response, error;
    try {
      response = await invoke(id);
      await report(owner, id, { failed: !response.ok && response.status !== 402,
        unavailable: response.status === 404, aborted: signal?.aborted });
      if (response.ok) return response;
    } catch (cause) {
      error = cause;
      await report(owner, id, { failed: true, unavailable: cause?.code === 'MODEL_UNAVAILABLE' || cause?.message === 'MODEL_UNAVAILABLE', aborted: signal?.aborted });
    }
    const next = context.accountState(owner).backgroundModelProfileId ?? chat(owner);
    if (next && next !== id && !signal?.aborted) { await response?.body?.cancel(); return invoke(next); }
    if (error) throw error;
    return response;
  }
  return { selected, resolve, report, completion,
    reset(owner) { for (const key of failures.keys()) if (key.startsWith(`${owner}/`)) failures.delete(key); } };
}

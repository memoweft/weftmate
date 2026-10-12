/** Account-local selection, with no fallback to a host startup credential. */
export function currentChatProfile(account, selectable) {
  if (account.lastChatModelProfileId && selectable(account.lastChatModelProfileId)) return account.lastChatModelProfileId;
  const recent = Object.values(account.commands ?? {}).filter(row => row.kind === 'session.message' &&
    ['dispatching', 'accepted_by_dsh', 'accepted_by_host', 'observed'].includes(row.state))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const row of recent) {
    const id = account.sessions?.[row.sessionId]?.modelProfileId;
    if (id && selectable(id)) return id;
  }
  return account.defaultModelProfileId && selectable(account.defaultModelProfileId) ? account.defaultModelProfileId : null;
}

export function selectBackgroundProfile({ explicit, bound, current, profiles, allowed }) {
  const id = explicit ?? current ?? bound;
  return profiles.find(row => row.id === id && allowed(row.id)) ?? null;
}

/** Record decisions per owner, rather than every session/health poll. */
export function createBackgroundRouteRecorder(write, { clock = Date.now, intervalMs = 3_600_000 } = {}) {
  const routes = new Map();
  function flush() {
    const now = clock();
    for (const row of routes.values()) {
      if (row.count) write('background.route', { ...row.data, phase: 'summary', ahead: row.count });
      row.count = 0; row.at = now;
    }
  }
  const timer = setInterval(flush, intervalMs); timer.unref();
  return { record(ownerId, data) {
    const signature = JSON.stringify([data.profileId ?? null, data.configured]);
    const previous = routes.get(ownerId), now = clock();
    if (!previous || previous.signature !== signature) {
      write('background.route', { ...data, phase: 'changed' });
      routes.set(ownerId, { signature, data, count: 0, at: now });
    } else {
      previous.count++;
      if (now - previous.at >= intervalMs) { flush(); previous.at = now; }
    }
  }, flush, close() { clearInterval(timer); } };
}

export async function backgroundModelReady(profile, { credentialFor, fetchImpl = fetch, onUnavailable = null }) {
  const base = new URL(profile.baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) return true;
  const headers = { authorization: `Bearer ${credentialFor(profile)}` };
  const root = profile.baseUrl.replace(/\/?v1\/?$/, '');
  let props;
  try {
    const response = await fetchImpl(`${root}/props`, { headers, signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (response.ok) props = await response.json();
  } catch { /* A configured ModelSwitcher can report status without props during loading. */ }
  let status;
  try {
    const response = await fetchImpl(`${root}/switch/status`, { headers, signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (response.ok) status = await response.json();
  } catch { /* Non-switching services have no status endpoint. */ }
  if (onUnavailable && status?.switching !== true &&
      (!props || status && (status.current_model ?? status.currentModelId ?? status.current_model_id) !== profile.model)) {
    try {
      const response = await fetchImpl(`${profile.baseUrl.replace(/\/$/, '')}/models`, { headers, signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (response.ok) {
        const catalog = await response.json();
        if (Array.isArray(catalog.data) && !catalog.data.some(row => row.id === profile.model)) {
          await onUnavailable({ unavailable: true }); return false;
        }
      } else if (response.status >= 500) await onUnavailable({ failed: true });
    } catch { await onUnavailable({ failed: true }); }
  }
  if (props?.total_slots > 1) return true;
  if (status) return status.switching !== true && (status.current_model ?? status.currentModelId ?? status.current_model_id) === profile.model;
  // A single-slot service with no observable model cannot safely load a background model.
  return props?.total_slots !== 1;
}

/** Read external occupancy for speculation only; memory retains its waiting policy.
 * A status read observes idleness but cannot reserve an independently owned proxy.
 */
export async function suggestionModelReady(profile, { credentialFor, fetchImpl = fetch, signal } = {}) {
  try {
    signal?.throwIfAborted();
    const base = new URL(profile.baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) return true;
    const root = profile.baseUrl.replace(/\/?v1\/?$/, '');
    const key = credentialFor?.(profile);
    const headers = key ? { authorization: `Bearer ${key}` } : {};
    const request = path => {
      const timeout = AbortSignal.timeout(2000);
      return fetchImpl(`${root}${path}`, { headers, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    };
    const propsResponse = await request('/props');
    if (!propsResponse.ok) return false;
    const props = await propsResponse.json();
    signal?.throwIfAborted();
    if (!Number.isInteger(props?.total_slots) || props.total_slots < 1) return false;
    if (props.total_slots > 1) return true;
    const statusResponse = await request('/switch/status');
    if (statusResponse.status === 503) return false;
    if (statusResponse.ok) {
      const status = await statusResponse.json();
      signal?.throwIfAborted();
      if (status?.switching !== false ||
          (status.current_model ?? status.currentModelId ?? status.current_model_id) !== profile.model) return false;
      const counters = [status.activeLeases, status.queuedLeases, status.maintenanceQueued];
      if (counters.some(value => value !== undefined && (!Number.isInteger(value) || value < 0))) return false;
      if (counters.some(value => Number.isInteger(value) && value > 0)) return false;
      if (counters.every(value => Number.isInteger(value) && value >= 0)) return counters.every(value => value === 0);
    } else if (![404, 405, 501].includes(statusResponse.status)) return false;
    const slotsResponse = await request('/slots?fail_on_no_slot=1');
    if (!slotsResponse.ok) return false;
    const slots = await slotsResponse.json();
    signal?.throwIfAborted();
    return Array.isArray(slots) && slots.length === 1 && slots[0]?.is_processing === false;
  } catch { return false; }
}

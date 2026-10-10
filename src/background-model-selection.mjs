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

export async function backgroundModelReady(profile, { credentialFor, fetchImpl = fetch }) {
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

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

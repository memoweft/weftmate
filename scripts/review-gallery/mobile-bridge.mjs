// Reuses FE-1b's authenticated native bridge adapter; secrets stay in this closure.
export function mobileBridge(fixture, theme) {
let nativeLogin=null, cookie='', csrf='', appearance=theme;
const nativeRequests=[];
async function request(path, method = 'GET', body) {
  const response = await fetch(fixture.origin + path, { method, headers: { origin: fixture.origin, cookie, 'content-type': 'application/json', ...(csrf ? { 'x-weftmate-csrf': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.code || `HTTP_${response.status}`);
  const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(row => row.split(';')[0]).join('; ');
  if (value.csrfToken) csrf = value.csrfToken;
  return value;
}
const profile = payload => ({ loggedIn: true, ...payload.account, device: payload.device, deviceId: payload.device?.id, owner: fixture.ownerId, connectionVerified: true, backgroundSync: 'scheduled' });
async function bridge({ method, params = {} }) {
  nativeRequests.push({ method, params: method.startsWith('auth.') ? undefined : params });
  if (method === 'app.bootstrap') return { loggedIn: !!nativeLogin, username: nativeLogin?.username || '', owner: nativeLogin ? fixture.ownerId : '', deviceId: nativeLogin?.deviceId || '', model: null, busy: false, backgroundSync: 'scheduled', ui: { activeVersion: '0.8.6' } };
  if (method === 'auth.login' || method === 'auth.register') { const { username, password, deviceName, displayName } = params; nativeLogin = profile(await request(`/personal/v1/auth/${method.split('.')[1]}`, 'POST', { username, password, deviceName, ...(method === 'auth.register' ? { displayName } : {}) })); return nativeLogin; }
  if (method === 'auth.me') { if (!nativeLogin) throw Error('LOGIN_REQUIRED'); return profile(await request('/personal/v1/auth/me')); }
  if (method === 'auth.state') return request('/personal/v1/auth/state');
  if (method === 'settings.appearance') { if (params.value) appearance = params.value; return { value: appearance }; }
  if (method === 'conversations.list') return { conversations: [], source: 'phone' };
  if (method === 'shared.sessions.list') { if (!nativeLogin) throw Error('LOGIN_REQUIRED'); const result = await request('/personal/v1/sessions'); return { ...result, sessions: result.sessions.map(row => ({ ...row, source: 'host' })), source: 'host', hostAvailable: true }; }
  if (method === 'shared.sessions.events') { const query = new URLSearchParams(); for (const key of ['afterSeq', 'beforeSeq']) if (params[key] != null) query.set(key, params[key]); return { ...await request(`/personal/v1/sessions/${params.sessionId}/events?${query}`), source: 'host', sessionId: params.sessionId, hostAvailable: true }; }
  if (method === 'shared.sessions.eventDetail') return request(`/personal/v1/sessions/${params.sessionId}/events/${params.seq}/detail`);
  if (method === 'shared.approvals.list' || method === 'shared.questions.list') return request(`/personal/v1/sessions/${params.sessionId}/${method.includes('approvals') ? 'approvals' : 'questions'}`);
  if (method === 'shared.approvals.decide') return request(`/personal/v1/sessions/${params.sessionId}/approvals/${params.approvalId}`, 'POST', params);
  if (method === 'shared.tasks.detail') return request(`/personal/v1/tasks/${params.taskId}`);
  if (method === 'shared.artifacts.preview') return request(`/personal/v1/artifacts/${params.artifactId}/preview`);
  if (method === 'host.business') return request(params.path, params.method, params.body);
  if (method === 'shared.send' || method === 'shared.stop') { const kind = method === 'shared.send' ? 'session.message' : 'session.cancel'; const result = await request('/personal/v1/commands', 'POST', { ...params, kind, targetDeviceId: 'synthetic-host', ...(kind === 'session.message' ? { mode: 'queue' } : {}) }); return { source: 'host', sessionId: params.sessionId, requestId: params.requestId, state: 'accepted', command: result.command }; }
  if (method === 'shared.commands.byRequest') return { ...await request(`/personal/v1/commands/by-request/${params.requestId}`), source: 'host' };
  if (method === 'shared.commands.detail') return { ...await request(`/personal/v1/commands/${params.commandId}`), source: 'host' };
  if (method === 'shared.outbox.list' || method === 'shared.outbox.reconcile') return { source: 'host', commands: [] };
  if (method === 'shared.activity.list' || method === 'activity.list') return { activities: [] };
  if (method === 'attachments.list') return { attachments: [] };
  if (method === 'cloud.tokens') return { value: null };
  if (method === 'cloud.login.state') return { configured: false };
  return {};
}
return bridge;
}

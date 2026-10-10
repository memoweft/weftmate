import { noPush, pushRegistration } from '../push/provider.mjs';
import { failure } from './common.mjs';
/** Trusted host seam. A provider sees identity/type only, never Activity content. */
export async function sendHostPush(context, ownerId, eventId, provider = noPush) {
  const account = context.accountState(ownerId), row = account.activity?.items[eventId];
  if (!row || row.read || row.notification?.notify !== true) return { accepted: false, reason: 'NO_NOTIFICATION' };
  const deliveries = [];
  for (const [deviceId, device] of Object.entries(account.devices)) {
    if (device.revoked || !device.push || device.expiresAt && Date.parse(device.expiresAt) <= context.timestamp() ||
        device.authEpoch !== undefined && device.authEpoch !== account.account?.authEpoch) continue;
    deliveries.push(await provider.send({ ...device.push, deviceId, ownerId }, { eventId, type: row.type }));
  }
  return { configured: provider.id !== 'none', accepted: deliveries.some(row => row.accepted), reason: provider.id === 'none' ? 'PUSH_NOT_CONFIGURED' : 'PROVIDER_RESULT', deliveries };
}
export async function handlePush(context, request, response, url, ownerId, deviceId) {
  if (url.pathname !== '/personal/v1/push/registration') return false;
  if (url.search || !['GET','PUT','DELETE'].includes(request.method)) throw failure('INVALID_REQUEST');
  context.authenticate(request, request.method === 'GET' ? 'sessions:read' : 'account:manage');
  let registration;
  if (request.method === 'PUT') {
    try { registration = pushRegistration(await context.readJson(request)); } catch { throw failure('INVALID_REQUEST'); }
  }
  if (request.method !== 'GET') await context.serial(() => context.mutate(ownerId, next => {
    context.authenticate(request, 'account:manage');
    if (registration) next.devices[deviceId].push = { ...registration, updatedAt: new Date(context.timestamp()).toISOString() };
    else delete next.devices[deviceId].push;
  }));
  const saved = context.accountState(ownerId).devices[deviceId].push;
  context.json(response, 200, { deviceId, registered: !!saved, platform: saved?.platform ?? null,
    provider: saved?.provider ?? 'none', tokenPresent: !!saved?.token, ...(await noPush.register()) });
  return true;
}

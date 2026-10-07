import { HEALTH_BODY_MAX, healthFailure, healthDate } from './summary.mjs';

export async function handlePersonalHealthHttp({ store, context, request, url, pathname, ownerId, deviceId }) {
  const base = '/personal/v1/health/daily-summaries';
  const authorize = (sourceDeviceId) => {
    const current = context.authenticate(request, 'commands:write');
    if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw healthFailure('UNAUTHORIZED', 401);
    // Previously issued / revoked device IDs still identify offline summaries from this account.
    if (sourceDeviceId && !Object.hasOwn(context.accountState(ownerId).devices, sourceDeviceId)) {
      throw healthFailure('FORBIDDEN', 403);
    }
  };
  if (request.method === 'GET' && pathname === base) {
    if ([...url.searchParams.keys()].some((key) => !['days', 'timeZone'].includes(key)) ||
        ['days', 'timeZone'].some((key) => url.searchParams.getAll(key).length > 1)) throw healthFailure('INVALID_REQUEST');
    const result = await store.list(ownerId, { days: Number(url.searchParams.get('days') ?? '14'),
      timeZone: url.searchParams.get('timeZone') ?? 'UTC' });
    const current = context.authenticate(request, 'sessions:read');
    if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw healthFailure('UNAUTHORIZED', 401);
    return { status: 200, body: result };
  }
  if (url.search) throw healthFailure('INVALID_REQUEST');
  if (request.method === 'POST' && pathname === base) {
    const body = await context.readJson(request, HEALTH_BODY_MAX);
    const result = await context.serial(() => store.upsert(ownerId, body, authorize));
    return { status: 200, body: result };
  }
  if (request.method === 'DELETE' && (pathname === base || pathname.startsWith(`${base}/`))) {
    const date = pathname === base ? null : healthDate(pathname.slice(base.length + 1));
    const body = await context.readJson(request, HEALTH_BODY_MAX);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
      throw healthFailure('INVALID_REQUEST');
    }
    return { status: 200, body: await context.serial(() => store.delete(ownerId, date, authorize)) };
  }
  throw healthFailure('NOT_FOUND', 404);
}

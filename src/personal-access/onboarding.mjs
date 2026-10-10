import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { failure, exactKeys } from './common.mjs';

export const onboardingSteps = ['welcome', 'account', 'model', 'memory', 'import', 'phone', 'first'];
export const defaultModelPorts = [11434, 1234, 8000, 5000];
export function privateModelAddress(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('INVALID_REQUEST'); }
  const h = url.hostname;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      !((isIP(h) === 4 && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) || h === 'localhost' || h === '[::1]') ||
      (url.port === '8081')) throw failure('INVALID_REQUEST');
  url.pathname = url.pathname.replace(/\/$/, '') || '/v1';
  if (!url.pathname.endsWith('/v1')) throw failure('INVALID_REQUEST');
  return url.href.replace(/\/$/, '');
}
export async function discoverModels({ addresses = [], neighbors = [], fetchImpl = fetch } = {}) {
  const candidates = new Set([...addresses.map(privateModelAddress), ...['127.0.0.1', ...neighbors]
    .flatMap(host => defaultModelPorts.map(port => privateModelAddress(`http://${host}:${port}/v1`)))]);
  const results = await Promise.all([...candidates].map(async baseUrl => {
    try {
      const response = await fetchImpl(baseUrl + '/models', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(1200) });
      if (!response.ok) return null;
      const body = await response.json();
      const models = Array.isArray(body.data) ? body.data.filter(row => typeof row?.id === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(row.id)).map(row => row.id) : [];
      return models.length ? { baseUrl, models } : null;
    } catch { return null; }
  }));
  return results.filter(Boolean);
}
async function networkNeighbors() {
  try {
    const { stdout } = await promisify(execFile)('arp', ['-a'], { windowsHide: true, timeout: 2000 });
    return [...new Set((stdout.match(/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/g) || [])
      .filter(ip => !ip.endsWith('.255') && !ip.endsWith('.0')))];
  } catch { return []; }
}
export async function handleOnboarding(context, request, response, url) {
  if (url.search) throw failure('INVALID_REQUEST');
  if (url.pathname === '/personal/v1/models/discover') {
    if (request.method !== 'POST') throw failure('NOT_FOUND', 404);
    context.authenticate(request, 'account:manage');
    const body = await context.readJson(request); exactKeys(body, ['addresses'], []);
    if (body.addresses !== undefined && (!Array.isArray(body.addresses) || body.addresses.some(item => typeof item !== 'string'))) throw failure('INVALID_REQUEST');
    const results = await discoverModels({ addresses: body.addresses || [], neighbors: await networkNeighbors() });
    context.authenticate(request, 'account:manage');
    return context.json(response, 200, { results });
  }
  if (request.method === 'GET') {
    const value = context.rootState.onboarding;
    return context.json(response, 200, { onboarding: value?.ownerId && value.ownerId !== context.ownerForRequest(request) ? null : value ?? null });
  }
  if (request.method !== 'PATCH') throw failure('NOT_FOUND', 404);
  // Before an account exists only the direct installation origin may save progress.
  // Afterwards the usual Cookie + CSRF account-management checks apply.
  if (context.registeredAccountCount()) context.authenticate(request, 'account:manage');
  else context.requireBrowserOrigin(request, true);
  const body = await context.readJson(request); exactKeys(body, ['step', 'completed'], ['step', 'completed']);
  if (!onboardingSteps.includes(body.step) || typeof body.completed !== 'boolean') throw failure('INVALID_REQUEST');
  await context.serial(() => context.mutateRoot(next => {
    if (context.registeredAccountCount()) context.authenticate(request, 'account:manage');
    next.onboarding = { step: body.step, completed: body.completed, started: true, ...(context.registeredAccountCount() ? { ownerId: context.authenticate(request, 'account:manage').ownerId } : {}) };
  }));
  return context.json(response, 200, { onboarding: context.rootState.onboarding });
}

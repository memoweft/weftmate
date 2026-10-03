import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/** Compare only an exact public provider route and actual request model. */
export function modelRouteFingerprint(endpoint, modelId) {
  if (typeof endpoint !== 'string' || typeof modelId !== 'string' ||
      !/^[A-Za-z0-9._:/-]{1,128}$/.test(modelId)) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') ||
      !/^[a-z0-9.-]+$/.test(host) || host.split('.').some((label) =>
        !label || label.startsWith('-') || label.endsWith('-')) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|arpa)$/.test(host)) return null;
  let route = url.pathname.replace(/\/+$/g, '');
  if (route.endsWith('/v1')) route += '/chat/completions';
  if (!route.endsWith('/chat/completions') || !/^\/[A-Za-z0-9._/-]+$/.test(route)) return null;
  const canonical = `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${route}`;
  return createHash('sha256').update(`weftmate-model-route/v1\n${canonical}\n${modelId}`, 'utf8').digest('hex');
}

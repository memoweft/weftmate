import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, sep } from 'node:path';

/** Fixture only: no production profile or remote model address can enter this path. */
export function syntheticStopFixtureRoute(message, { enabled, profile } = {}) {
  if (enabled !== true || !message || typeof message !== 'object' || Array.isArray(message) ||
      Object.keys(message).sort().join(',') !== 'action,baseUrl,requestId,type' ||
      message.action !== 'model.configure-synthetic-stop-fixture' ||
      typeof message.baseUrl !== 'string') return null;
  let actualProfile, tempRoot, url;
  try {
    actualProfile = realpathSync(profile);
    tempRoot = realpathSync(tmpdir());
    url = new URL(message.baseUrl);
  } catch { return null; }
  if (!actualProfile.startsWith(tempRoot + sep) || basename(actualProfile) !== 'profile' ||
      !basename(dirname(actualProfile)).startsWith('weftmate-synthetic-stop-') ||
      url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      !/^[1-9][0-9]{0,4}$/.test(url.port) || Number(url.port) > 65535 ||
      url.pathname !== '/v1' || url.search || url.hash ||
      url.href !== message.baseUrl) return null;
  return { baseUrl: message.baseUrl };
}

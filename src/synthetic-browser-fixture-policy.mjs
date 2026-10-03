import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, sep } from 'node:path';

const RESERVED = new Set([18186, 18188, 443, 8443, 8080, 8081]);
const HOSTS = new Set(['page-a.weftmate.invalid', 'page-b.weftmate.invalid']);

/** Explicit named Temp profile only. Production receives no DNS override. */
export function syntheticBrowserFixtureSettings(env, profile) {
  const supplied = env?.WEFTMATE_SYNTHETIC_BROWSER_PORT;
  if (supplied === undefined) return {};
  let canonical, temp;
  try { canonical = realpathSync(profile); temp = realpathSync(tmpdir()); }
  catch { throw new Error('synthetic browser fixture profile refused'); }
  const port = Number(supplied);
  if (env?.WEFTMATE_SYNTHETIC_STOP_FIXTURE !== '1' || env?.WEFTMATE_DOGFOOD_CONTROL !== '1' ||
      typeof supplied !== 'string' || !/^[1-9][0-9]{0,4}$/.test(supplied) ||
      !Number.isSafeInteger(port) || port > 65535 || RESERVED.has(port) ||
      !canonical.toLowerCase().startsWith((temp + sep).toLowerCase()) ||
      basename(canonical).toLowerCase() !== 'profile' ||
      !/^weftmate-synthetic-stop-stage11-[A-Za-z0-9_-]{4,64}$/i.test(basename(dirname(canonical)))) {
    throw new Error('synthetic browser fixture refused');
  }
  return {
    syntheticFixture: { hostnameSuffix: '.weftmate.invalid', allowedPort: port },
    resolver: async (hostname) => {
      if (!HOSTS.has(hostname)) throw new Error('synthetic browser hostname refused');
      return [{ address: '127.0.0.1', family: 4 }];
    },
  };
}

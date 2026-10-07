import { loadConfig } from './config.mjs';
import { loadKeys } from './keys.mjs';
process.umask(0o077);
const config = loadConfig();
const keys = await loadKeys(config.dataDir, { rotate: true });
process.stdout.write(
  JSON.stringify({
    event: 'keys.rotated',
    kid: keys.publicJwks.keys[0].kid,
    restartRequired: true,
  }) + '\n',
);

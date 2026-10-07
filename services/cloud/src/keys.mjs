import { generateKeyPair, exportJWK, importJWK } from 'jose';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, open, rename, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function writePrivate(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  const dir = await open(path.dirname(file), 'r');
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
async function newKey() {
  const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  return { ...(await exportJWK(privateKey)), kid: randomUUID(), use: 'sig', alg: 'RS256' };
}
export async function loadKeys(dataDir, { rotate = false, now = Date.now() } = {}) {
  const dir = path.join(dataDir, 'identity-keys');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const file = path.join(dir, 'keys.json');
  let state;
  try {
    state = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!state)
    state = {
      cookieSecret: randomBytes(32).toString('hex'),
      keys: [{ jwk: await newKey(), retireAt: null }],
    };
  else if (rotate) {
    // Access/ID tokens live for 300 s; allow 60 s for clock skew.
    state.keys[0].retireAt = now + 360000;
    state.keys.unshift({ jwk: await newKey(), retireAt: null });
  }
  state.keys = state.keys.filter((key) => key.retireAt === null || key.retireAt > now);
  if (state.keys.length === 0 || !/^[a-f0-9]{64}$/.test(state.cookieSecret))
    throw new Error('Invalid identity key state');
  for (const { jwk } of state.keys) await importJWK(jwk, 'RS256');
  await writePrivate(file, state);
  const privateJwks = { keys: state.keys.map((key) => key.jwk) };
  const publicJwks = {
    keys: privateJwks.keys.map(({ kty, n, e, kid, alg, use }) => ({ kty, n, e, kid, alg, use })),
  };
  return { ...state, privateJwks, publicJwks };
}

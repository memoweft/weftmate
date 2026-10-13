import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const owner = 'owner-synthetic-a', other = 'owner-synthetic-b';
const sha = value => createHash('sha256').update(value).digest('hex');
const account = username => ({ account: { username, usernameCanonical: username, authEpoch: 1,
  password: { algorithm: 'scrypt', N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024, salt: '0'.repeat(64), hash: '1'.repeat(128) } },
  devices: {}, setupGrant: null, authLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 }, sessions: {}, commands: {} });
async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-snapshot-')), root = path.join(base, 'profile'), directory = path.join(base, 'Backups');
  const store = { version: 3, hostId: 'host-synthetic', legacyOwnerId: other, executionOwnerId: owner,
    accounts: { [owner]: account('synthetic-a'), [other]: account('synthetic-b') },
    unknownAuthLimits: { failures: 0, lastFailureAt: 0, lockUntil: 0 }, sharedModelProfiles: [] };
  await mkdir(root, { recursive: true });
  const put = async (name, value) => { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
  await put('personal-access/store.json', store);
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, root, directory, store, put };
}
const native = (root, id, extra = {}) => JSON.stringify({ type: 'session', id, cwd: path.join(root, 'conversations', sha(owner), id), ...extra }) + '\n' + JSON.stringify({ type: 'user/message', data: { text: `history-${id}` } }) + '\n';

export {owner,other,sha,fixture,native};

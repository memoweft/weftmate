import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';

const root = await fsp.mkdtemp(path.join(tmpdir(), 'personal-sync-commit-guard-'));
const variant = process.argv[2];
let armed = false, authorized = true, stats = 0, checks = 0, changedAtCheck = null, closeFlight, store;
const originalLstat = fsp.lstat;
// Deliver the state change at the independent review's actual I/O boundary.
// Every stat, permission check, write and rename still uses the real filesystem.
fsp.lstat = async function (file, ...args) {
  const result = await originalLstat.call(this, file, ...args);
  if (armed && path.dirname(String(file)) === root && /^events\.json\..+\.tmp$/.test(path.basename(String(file)))) {
    if (++stats === 3) {
      changedAtCheck = checks;
      if (variant === 'authorization') authorized = false;
      else if (variant === 'closed') closeFlight = store.close();
      else throw Error('unknown synthetic guard variant');
    }
  }
  return result;
};
syncBuiltinESMExports();
try {
  const { createPersonalSyncStore } = await import('../../src/personal-sync/index.mjs');
  store = await createPersonalSyncStore({ root, ownerId: 'owner-test' });
  armed = true;
  let state = 'applied', error = null;
  const uuid = '00000000-0000-4000-8000-000000000001';
  try {
    await store.append({ sourceDeviceId: 'device-one', events: [{ eventId: 'event-' + uuid,
      conversationId: uuid, clientSeq: 1, kind: 'message.created', occurredAt: '2026-09-26T13:00:00.000Z',
      payload: { messageId: 'message-' + uuid, role: 'user', text: 'synthetic commit guard' } }],
    authorize() { checks++; if (!authorized) throw Object.assign(Error('authorization expired'), { code: 'UNAUTHORIZED', status: 401 }); } });
  } catch (cause) { state = 'rejected'; error = cause.code ?? cause.name; }
  await closeFlight;
  const disk = JSON.parse(await fsp.readFile(path.join(root, 'events.json'), 'utf8'));
  console.log(JSON.stringify({ variant, state, error, stats, checks, changedAtCheck,
    diskEvents: disk.events.length, memoryEvents: store.page().events.length,
    tempFiles: (await fsp.readdir(root)).filter(name => name.endsWith('.tmp')).length }));
} finally {
  await store?.close();
  fsp.lstat = originalLstat;
  syncBuiltinESMExports();
  await fsp.rm(root, { recursive: true, force: true });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { constants, zstdCompressSync } from 'node:zlib';
import { nativeHeader } from '../src/personal-backup/cloud-snapshot.mjs';

const frame = value => zstdCompressSync(Buffer.from(JSON.stringify(value) + '\n'), {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'backup-header-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, 'log.jsonl.zstd');
}

test('native backup header stops at its frame and preserves the exact event-tail offset', async t => {
  const file = await fixture(t), header = { type: 'session', id: 'synthetic-session', cwd: '/synthetic' };
  const head = frame(header), tail = Buffer.concat([frame({ type: 'user/message' }), frame({ type: 'turn/end' })]);
  await writeFile(file, Buffer.concat([head, tail]));
  assert.deepEqual(await nativeHeader(file), { header, offset: head.length });
});

test('native backup header spans read chunks and compressed blocks without consuming event frames', async t => {
  const file = await fixture(t), header = { type: 'session', id: 'synthetic-long', padding: randomBytes(150000).toString('base64') };
  const head = frame(header);
  assert.ok(head.length > 64 * 1024);
  await writeFile(file, Buffer.concat([head, frame({ type: 'turn/end' })]));
  assert.deepEqual(await nativeHeader(file), { header, offset: head.length });
});

test('native backup metadata does not decode an incomplete or corrupt event tail', async t => {
  const file = await fixture(t), header = { type: 'session', id: 'synthetic-torn-tail' }, head = frame(header);
  const event = frame({ type: 'user/message' });
  for (const tail of [event.subarray(0, event.length - 1), Buffer.from('invalid event frame')]) {
    await writeFile(file, Buffer.concat([head, tail]));
    assert.deepEqual(await nativeHeader(file), { header, offset: head.length });
  }
});

test('native backup metadata still rejects an incomplete header or invalid header checksum', async t => {
  const file = await fixture(t), head = frame({ type: 'session', id: 'synthetic-damaged' });
  const corrupt = Buffer.from(head); corrupt[corrupt.length - 1] ^= 1;
  for (const bytes of [head.subarray(0, head.length - 1), corrupt]) {
    await writeFile(file, bytes);
    await assert.rejects(nativeHeader(file));
  }
});

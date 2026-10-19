import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControlAccess } from './control-access.mjs';

test('restarted sessions rotate tokens and reject the previous session token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'control-rotation-'));
  try {
    const path = join(directory, 'session.json');
    const previous = createControlAccess();
    await previous.publish(path, { controlPort: 1 });
    const first = JSON.parse(await readFile(path, 'utf8'));
    const current = createControlAccess();
    await current.publish(path, { controlPort: 2 });
    const second = JSON.parse(await readFile(path, 'utf8'));
    assert.notEqual(first.controlToken, second.controlToken);
    assert.equal(second.controlPort, 2);
    let status;
    const response = { writeHead(value) { status = value; return this; }, end() {} };
    assert.equal(current.authorize({ headers: { authorization: 'Bearer ' + first.controlToken } }, response), false);
    assert.equal(status, 401);
    assert.equal(current.authorize({ headers: { authorization: 'Bearer ' + second.controlToken } }, response), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

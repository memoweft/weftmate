import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { distinctPorts } from './relay-fixture.mjs';

test('relay fixture reserves distinct ephemeral endpoints together and releases every reservation', async () => {
  const names = ['frps', 'https', 'control', 'content', 'plugin', 'api'];
  const ports = await distinctPorts(names);
  assert.equal(new Set(Object.values(ports)).size, names.length);
  const listeners = names.map(() => createServer());
  try {
    await Promise.all(listeners.map(async (server, index) => {
      server.listen(ports[names[index]], '127.0.0.1'); await once(server, 'listening');
    }));
  } finally {
    await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))));
  }
});

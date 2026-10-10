import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { hostName } from '../src/host-name.mjs';

test('synthetic host identity overrides OS identity only when explicitly injected', () => {
  const previous = process.env.WEFTMATE_TEST_HOST_NAME;
  try {
    delete process.env.WEFTMATE_TEST_HOST_NAME;
    assert.equal(hostName(), hostname());
    process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
    assert.equal(hostName(), 'synthetic-host');
  } finally {
    if (previous === undefined) delete process.env.WEFTMATE_TEST_HOST_NAME;
    else process.env.WEFTMATE_TEST_HOST_NAME = previous;
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildMachineIdentity, containsBuildMachineIdentity } from '../scripts/windows-package-policy.mjs';

test('pinned vendor CSS virtual modules use portable source IDs instead of build-machine paths', () => {
  const bundle = readFileSync('vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', 'utf8');
  assert.match(bundle, /dsh-css:packages\/client\/ui-conversation\//, 'must exercise actual emitted CSS modules');
  assert.doesNotMatch(bundle, /dsh-css:(?:[a-z]:[\\/]|\/)/i);
  assert.equal(containsBuildMachineIdentity(bundle, buildMachineIdentity()), false);
});

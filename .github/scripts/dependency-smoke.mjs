// Verify the major global-agent override through its actual electron-builder
// consumer. All traffic terminates at an isolated loopback proxy fixture.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const get = builderRequire('@electron/get');
const requests = [];
const payload = 'isolated dependency download fixture\n';
const proxy = createServer((request, response) => {
  requests.push(request.url);
  response.end(payload);
});
const cacheRoot = await mkdtemp(join(tmpdir(), 'weftmate-ci-dependency-'));
try {
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  process.env.GLOBAL_AGENT_HTTP_PROXY = origin;
  process.env.GLOBAL_AGENT_HTTPS_PROXY = origin;
  process.env.GLOBAL_AGENT_NO_PROXY = '';
  get.initializeProxy();
  assert.equal(global.GLOBAL_AGENT.HTTP_PROXY, origin);
  const artifact = await get.downloadArtifact({
    version: '43.7.8', artifactName: 'SHASUMS256.txt', isGeneric: true,
    mirrorOptions: { mirror: 'http://dependency-smoke.invalid/' },
    cacheRoot, force: true,
    downloadOptions: { quiet: true, timeout: { request: 5_000 }, retry: { limit: 0 } },
  });
  assert.equal(await readFile(artifact, 'utf8'), payload);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^http:\/\/dependency-smoke\.invalid\//);
  console.log('Dependency smoke passed: electron-builder @electron/get downloads through global-agent 4 loopback proxy.');
} finally {
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
  await rm(cacheRoot, { recursive: true, force: true });
}

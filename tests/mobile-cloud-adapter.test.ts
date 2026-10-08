import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/ui-core/adapters/android-bridge.js', import.meta.url), 'utf8');
function context() { const scope = { globalThis: null, URL, setTimeout, clearTimeout, WeftUiCore: {} }; scope.globalThis = scope; vm.runInNewContext(source, scope); return scope.WeftUiCore; }
test('mobile app transport keeps platform key operations native and uses only opaque refresh handles', async () => {
  const methods = [];
  const bridge = { call: async (method, params) => { methods.push({ method, params });
    if (method === 'cloud.app.configure') return { issuer: 'https://cloud.example.com/personal/v1/cloud/oidc', hostId: 'unconnected' };
    if (method === 'cloud.app.key') return { publicJwk: { kty: 'EC' }, deviceId: 'android-example' };
    if (method === 'cloud.app.sign') return { signature: 'signed-in-native' };
    if (method === 'cloud.app.credentials') return { value: { refreshToken: 'wm-refresh:opaque' } };
    return { status: 200, body: { refresh_token: 'wm-refresh:rotated' } };
  } };
  const api = context().createMobileCloudTransport({ bridge, native: true, hostOrigin: 'https://host.example.com' });
  assert.equal((await api.nativeCloudKey.get('scope')).deviceId, 'android-example');
  assert.equal(await api.nativeCloudKey.sign('scope', 'header.payload'), 'signed-in-native');
  assert.equal((await api.cloudCredentials('app-tokens:scope')).refreshToken, 'wm-refresh:opaque');
  const response = await api.fetch('https://cloud.example.com/personal/v1/cloud/oidc/token', { method: 'POST', body: 'refresh_token=wm-refresh%3Aopaque' });
  assert.equal((await response.json()).refresh_token, 'wm-refresh:rotated');
  assert.equal(methods.at(-1).method, 'cloud.app.request');
  assert.equal(methods.some(row => row.method === 'cloud.tokens'), false);
  const config = await api.fetch('https://host.example.com/personal/v1/cloud/config');
  assert.equal((await config.json()).hostId, 'unconnected');
});
test('mobile adapter preserves native errors and treats a missing trusted computer as approval, without weakening token errors', async () => {
  const functions = context();
  const api = functions.createMobileCloudTransport({ native: true, hostOrigin: 'https://host.example.com', bridge: {
    call: async () => { throw Object.assign(new Error('PAIRING_REQUIRED'), { status: 403 }); }
  } });
  const response = await api.fetch('https://host.example.com/personal/v1/auth/cloud-session');
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'PAIRING_REQUIRED');
  const client = functions.adaptMobileCloudClient({ config: { hostId: 'host-example' }, exchange: async () => { throw { code: 'PAIRING_REQUIRED' }; } });
  assert.equal((await client.exchange()).status, 'pending_approval');
  const invalid = functions.adaptMobileCloudClient({ config: { hostId: 'host-example' }, exchange: async () => { throw { code: 'CLOUD_TOKEN_INVALID' }; } });
  await assert.rejects(invalid.exchange(), error => error.code === 'CLOUD_TOKEN_INVALID');
});

test('known direct computer connects without a relay, but mismatched host identity stays refused', async () => {
  const functions = context(), paths = [];
  const client = { config: { hostId: 'host-example' }, host: 'https://host.example.com', request: async path => { paths.push(path); return { hostId: 'host-example' }; } };
  const connection = await functions.resolveMobileCloudConnection(client, { hostId: 'host-example', status: 'offline', approval: 'trusted' });
  assert.equal(connection.status, 'online'); assert.equal(connection.baseUrl, client.host);
  assert.equal(paths.at(-1), client.host + '/personal/v1/auth/cloud-nonce');
  const other = { hostId: 'other-host', status: 'offline' };
  assert.equal(await functions.resolveMobileCloudConnection(client, other), other);
  await assert.rejects(functions.resolveMobileCloudConnection({ ...client, request: async () => ({ hostId: 'wrong-host' }) }, { hostId: 'host-example', status: 'offline' }), error => error.code === 'HOST_TRUST_INVALID');
});

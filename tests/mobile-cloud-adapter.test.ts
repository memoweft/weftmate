import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/ui-core/adapters/android-bridge.js', import.meta.url), 'utf8');
function context() { const scope = { globalThis: null, URL, setTimeout, clearTimeout, WeftUiCore: {} }; scope.globalThis = scope; vm.runInNewContext(source, scope); return scope.WeftUiCore; }

test('remembered native local session is verified before acceptance without a cloud adoption or refresh', async () => {
  const calls = [], accepted = [], payload = {account:{ownerId:'native-scope',username:'Synthetic'},device:{id:'native-device'},csrfToken:'native-managed'};
  const result = await context().restoreMobileHostSession({fetch:async path=>{calls.push(path);return {ok:true,status:200,json:async()=>payload};},call:async()=>{throw Error('Local login must not adopt a cloud result');}},value=>accepted.push(value));
  assert.equal(result,payload);assert.deepEqual(accepted,[payload]);assert.deepEqual(calls,['/personal/v1/auth/me']);
});

test('revoked native local session is refused before accepting identity', async () => {
  let accepted=false;
  await assert.rejects(context().restoreMobileHostSession({fetch:async()=>({ok:false,status:401,json:async()=>({error:{code:'UNAUTHORIZED'}})})},()=>accepted=true),error=>error.code==='UNAUTHORIZED'&&error.status===401);
  assert.equal(accepted,false);
});
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
test('mobile adapter preserves native trust and token errors without inventing device approval', async () => {
  const functions = context();
  const api = functions.createMobileCloudTransport({ native: true, hostOrigin: 'https://host.example.com', bridge: {
    call: async () => { throw Object.assign(new Error('PAIRING_REQUIRED'), { status: 403 }); }
  } });
  const response = await api.fetch('https://host.example.com/personal/v1/auth/cloud-session');
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'PAIRING_REQUIRED');
  const client = functions.adaptMobileCloudClient({ config: { hostId: 'host-example' }, authorized: async () => ({status:'online'}), exchange: async () => { throw { code: 'PAIRING_REQUIRED' }; } });
  await assert.rejects(client.exchange(), error => error.code === 'PAIRING_REQUIRED');
  const invalid = functions.adaptMobileCloudClient({ config: { hostId: 'host-example' }, authorized: async () => ({status:'online'}), exchange: async () => { throw { code: 'CLOUD_TOKEN_INVALID' }; } });
  await assert.rejects(invalid.exchange(), error => error.code === 'CLOUD_TOKEN_INVALID');
});

test('cached native content restores without a server request or cloud credentials', async () => {
  const profile = { owner: 'cached-owner', username: 'Synthetic', device: { id: 'cached-device' }, connectionVerified: false };
  const bridge = { account: value => ({ ...value, ownerId: value.owner }), call: async method => { assert.equal(method, 'auth.cached'); return profile; },
    fetch: async () => { throw Error('Cached reading must not contact a server'); } };
  let accepted;
  const payload = await context().restoreCachedMobileHostSession(bridge, value => { accepted = value; });
  assert.equal(payload, accepted); assert.equal(payload.account.ownerId, profile.owner); assert.equal(payload.connectionVerified, false);
});

test('new account selects its own computer without pairing and validates the connection identity', async () => {
  const calls = [], connected = [];
  const base = { host: 'https://cloud.example', config: { clientId:'weftmate-web',hostId: 'unconnected', issuer: 'https://cloud.example/personal/v1/cloud/oidc' },
    authorized: async (path, options) => { calls.push({ path, options }); return path === '/devices' ? { hosts: [{ hostId: 'own-computer', status: 'online' }] } : { baseUrl: 'https://computer.example' }; },
    request: async () => ({ clientId:'desktop-client',hostId: 'own-computer', issuer: 'https://cloud.example/personal/v1/cloud/oidc' }),
    exchange: async () => ({ account: { ownerId: 'synthetic-owner' } }) };
  const client = context().adaptMobileCloudClient({ ...base, config: { ...base.config } }, value => connected.push(value));
  assert.equal((await client.exchange()).account.ownerId, 'synthetic-owner');
  assert.equal(client.config.clientId,'weftmate-web');assert.equal(client.host, 'https://computer.example'); assert.equal(connected.length, 1);
  assert.equal(calls[1].options.body.hostId, 'own-computer');
  const wrong = context().adaptMobileCloudClient({ ...base, config: { ...base.config }, request: async () => ({ hostId: 'other-computer', issuer: base.config.issuer }) });
  await assert.rejects(wrong.exchange(), error => error.code === 'HOST_TRUST_INVALID');
  const none = context().adaptMobileCloudClient({ ...base, config: { ...base.config }, authorized: async () => ({ hosts: [] }) });
  assert.equal((await none.exchange()).status, 'cloud_only');
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
test('an unavailable cached direct transport preserves the clouds explicit offline result for the original computer',async()=>{
  const connection={hostId:'host-example',status:'offline',approval:'trusted'};
  const client={config:{hostId:'host-example'},host:'https://host.example.com',request:async()=>{throw {code:'CLOUD_TLS_UNAVAILABLE',status:503};}};
  const offline=await context().resolveMobileCloudConnection(client,connection);
  assert.equal(offline,connection);assert.equal(offline.status,'offline');
  await assert.rejects(context().resolveMobileCloudConnection({...client,request:async()=>{throw {code:'UNAUTHORIZED',status:401};}},connection),error=>error.code==='UNAUTHORIZED');
});
test('cached native verification falls through to cloud presence after transport loss but keeps authorization failures',async()=>{
  const functions=context(),offline={hostId:'original-host',status:'offline'};let probes=0;
  for(const verify of [async()=>null,async()=>{throw {code:'CLOUD_TRANSPORT_UNAVAILABLE',status:503};}]){
    assert.equal(await functions.probeMobileCloudPresence(verify,async()=>{probes++;return offline;}),offline);
  }
  const online={hostId:'original-host',status:'online'};
  assert.equal(await functions.probeMobileCloudPresence(async()=>online,async()=>{throw Error('Known direct connection must stay usable');}),online);
  await assert.rejects(functions.probeMobileCloudPresence(async()=>{throw {code:'UNAUTHORIZED',status:401};},async()=>offline),error=>error.code==='UNAUTHORIZED');
  assert.equal(probes,2);
});

test('cloud login stays phone-only when an offline computer still has a relay address', async () => {
  let hostRequests = 0, connected = 0;
  const client = context().adaptMobileCloudClient({
    config: { hostId: 'unconnected', issuer: 'https://cloud.example/personal/v1/cloud/oidc' },
    authorized: async (path: string) => path === '/devices'
      ? { hosts: [{ hostId: 'offline-computer', status: 'offline' }] }
      : { hostId: 'offline-computer', status: 'offline', baseUrl: 'https://unavailable.example' },
    request: async () => { hostRequests++; throw { status: 503, code: 'CLOUD_TLS_UNAVAILABLE' }; },
    exchange: async () => { throw Error('An offline computer must not supply account login'); },
  }, async () => { connected++; });
  assert.equal((await client.exchange()).status, 'cloud_only');
  assert.equal(hostRequests, 0);
  assert.equal(connected, 0);
});

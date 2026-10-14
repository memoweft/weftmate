import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { uiCoreAssets } from '../src/ui-core/manifest.mjs';

class Element {
  tagName: string; className: string; textContent: string;
  children: Element[] = []; parentNode: Element | null = null;
  attributes = new Map<string, string>(); listeners = new Map<string, Function[]>();
  hidden = false; disabled = false; value = ''; type = '';
  constructor(tag = 'div', cls = '', text = '') { this.tagName = tag.toUpperCase(); this.className = cls; this.textContent = text; }
  append(...nodes: Element[]) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes: Element[]) { this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, action: Function) { this.listeners.set(name, [...(this.listeners.get(name) || []), action]); }
  fire(name: string) { for (const action of this.listeners.get(name) || []) action(); }
  focus() {}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check: () => boolean) { for (let i = 0; i < 30; i++) { if (check()) return; await tick(); } assert.fail('onboarding action did not complete'); }

function fixture({ statusError = null as any, capabilities = { modelServices: 1 } as any, catalogStatus = 'available', saveError = null as any, savedService = null as any, defaultModelProfileId = null as any } = {}) {
  const body = new Element('body'), settings = new Element('section');
  const context: any = { AbortController, AbortSignal, URL, URLSearchParams, Intl, TextEncoder, Blob, DOMException, setTimeout, clearTimeout, setInterval, clearInterval,
    document: { body, querySelector: () => settings }, weftmateDesktop: {}, WeftUiComponents: { factories: {} } };
  const source = uiCoreAssets.map(path => readFileSync(new URL(`../src/ui-core/${path}`, import.meta.url), 'utf8')).join('\n;\n');
  runInNewContext(source, context);
  runInNewContext(readFileSync(new URL('../src/personal-access-ui/components/onboarding.js', import.meta.url), 'utf8'), context);
  const calls: string[] = [], writes: any[] = []; let completeStatus: Function;
  const status = new Promise(resolve => { completeStatus = resolve; });
  const service = savedService || { serviceId: 'synthetic-service', selectedModelId: 'synthetic-model', models: [{ modelId: 'synthetic-model', profileId: 'synthetic-profile', name: 'Synthetic' }] };
  const effects = new Proxy({}, { get: () => () => {} });
  const core = context.WeftUiCore.create({ effects, storage: { getItem: () => null, setItem() {}, removeItem() {} }, crypto: { randomUUID: () => crypto.randomUUID() },
    fetch: async (path: string, options: any = {}) => {
      const route = path.replace('/personal/v1', ''); calls.push(route); if (options.body) writes.push({ route, body: JSON.parse(options.body) });
      let value: any = {};
      if (route === '/status') { await status; if (statusError) return { ok: false, status: 503, json: async () => ({ error: statusError }) }; value = { ownerId: 'synthetic-owner', hostId: 'synthetic-host', personalCapabilities: capabilities }; }
      if (route === '/onboarding') value = { onboarding: { step: options.body ? JSON.parse(options.body).step : 'model', started: true, completed: false } };
      if (route === '/model-services/check') value = { catalog: { status: catalogStatus, message: catalogStatus === 'authentication_failed' ? '密钥没有通过验证，请检查后重新填写。' : '找到 1 个模型', models: catalogStatus === 'available' ? service.models : [] } };
      if (route === '/model-services' && options.method === 'POST') { if (saveError) return { ok: false, status: 503, json: async () => ({ error: saveError }) }; value = { service }; }
      if (route === '/model-services' && options.method !== 'POST') value = { services: [service], models: service.models.map(model => ({ id: model.profileId, name: model.name, configured: true })), modelSettings: { defaultModelProfileId } };
      if (route.endsWith('/select')) value = { profileId: service.models.find(model => model.modelId === JSON.parse(options.body).modelId)?.profileId, service };
      return { ok: true, status: 200, json: async () => value };
    } });
  Object.assign(core.state, { identityGeneration: 1, csrfToken: 'synthetic-csrf', account: { ownerId: 'synthetic-owner', username: 'Synthetic' }, device: { id: 'synthetic-device' }, models: [] });
  const ui = { element: (tag: string, cls: string, text: string) => new Element(tag, cls, text), updateAvailability() {}, paintCloudAuth() {}, paintScreen() {} };
  const onboarding = context.WeftUiComponents.factories.onboarding(core, ui); onboarding.mountOnboarding();
  const all = (): Element[] => { const visit = (node: Element): Element[] => [node, ...node.children.flatMap(visit)]; return visit(body); };
  const field = (label: string) => all().find(node => node.attributes.get('aria-label') === label)!;
  const button = (label: string) => all().find(node => node.tagName === 'BUTTON' && node.textContent === label)!;
  const diagnostic = () => all().find(node => node.className === 'onboarding-diagnostic')!;
  const notice = () => all().find(node => node.className === 'onboarding-status')!;
  return { core, calls, writes, onboarding, field, button, diagnostic, notice, ready: () => completeStatus!({}) };
}

test('fresh onboarding waits for capabilities, then queries, saves and selects through the shared model actions', async () => {
  const f = fixture(); await f.onboarding.startOnboarding({ configured: false });
  f.field('密钥').value = 'synthetic-key'; f.button('重新查询模型').fire('click'); await tick();
  assert.deepEqual(f.calls, ['/onboarding', '/status']);
  assert.equal(f.diagnostic().textContent, '正在读取模型…');
  f.ready(); await until(() => f.diagnostic().textContent === '找到 1 个模型');
  f.button('继续').fire('click'); await until(() => f.writes.some(row => row.route === '/onboarding' && row.body.step === 'memory'));
  assert.equal(f.core.state.modelProfileId, 'synthetic-profile');
  assert.equal(f.writes.find(row => row.route === '/model-services').body.apiKey, 'synthetic-key');
  assert.equal(f.field('密钥'), undefined, 'successful save leaves the model step');
});

test('onboarding preserves the server-selected flash model when pro is first in the catalog', async () => {
  const service = { serviceId: 'synthetic-service', selectedModelId: 'synthetic-flash', models: [
    { modelId: 'synthetic-pro', profileId: 'profile-pro', name: 'Synthetic Pro', enabled: true },
    { modelId: 'synthetic-flash', profileId: 'profile-flash', name: 'Synthetic Flash', enabled: true },
  ] };
  const f = fixture({ savedService: service, defaultModelProfileId: 'profile-pro' }); f.core.state.personalCapabilities = { modelServices: 1 };
  await f.onboarding.startOnboarding({ configured: false }); f.button('继续').fire('click');
  await until(() => f.writes.some(row => row.route === '/onboarding' && row.body.step === 'memory'));
  assert.equal(f.writes.find(row => row.route.endsWith('/select')).body.modelId, 'synthetic-flash');
  assert.equal(f.core.state.modelProfileId, 'profile-flash');
  assert.equal(f.core.state.modelSettings.defaultModelProfileId, 'profile-flash');
});

test('onboarding preserves the account default when the service has no selected model', async () => {
  const service = { serviceId: 'synthetic-service', models: [
    { modelId: 'synthetic-pro', profileId: 'profile-pro', name: 'Synthetic Pro', enabled: true },
    { modelId: 'synthetic-flash', profileId: 'profile-flash-current', profileIds: ['profile-flash-current', 'profile-flash-default'], name: 'Synthetic Flash', enabled: true },
  ] };
  const f = fixture({ savedService: service, defaultModelProfileId: 'profile-flash-default' }); f.core.state.personalCapabilities = { modelServices: 1 };
  await f.onboarding.startOnboarding({ configured: false }); f.button('继续').fire('click');
  await until(() => f.writes.some(row => row.route === '/onboarding' && row.body.step === 'memory'));
  assert.equal(f.writes.find(row => row.route.endsWith('/select')).body.modelId, 'synthetic-flash');
});

test('onboarding falls back to the first enabled model only when there is no usable server choice or account default', async () => {
  const service = { serviceId: 'synthetic-service', selectedModelId: 'synthetic-pro', models: [
    { modelId: 'synthetic-pro', profileId: 'profile-pro', name: 'Synthetic Pro', enabled: false },
    { modelId: 'synthetic-flash', profileId: 'profile-flash', name: 'Synthetic Flash', enabled: true },
  ] };
  const f = fixture({ savedService: service, defaultModelProfileId: 'profile-pro' }); f.core.state.personalCapabilities = { modelServices: 1 };
  await f.onboarding.startOnboarding({ configured: false }); f.button('继续').fire('click');
  await until(() => f.writes.some(row => row.route === '/onboarding' && row.body.step === 'memory'));
  assert.equal(f.writes.find(row => row.route.endsWith('/select')).body.modelId, 'synthetic-flash');
});

test('invalid key stays on the model step with a key-specific message and no save', async () => {
  const f = fixture({ catalogStatus: 'authentication_failed' }); f.core.state.personalCapabilities = { modelServices: 1 };
  await f.onboarding.startOnboarding({ configured: false }); f.field('密钥').value = 'wrong-key';
  f.button('重新查询模型').fire('click'); await until(() => f.diagnostic().textContent.includes('密钥'));
  f.button('继续').fire('click'); await until(() => f.notice().textContent.includes('密钥'));
  assert.equal(f.calls.filter(path => path === '/model-services').length, 0);
});

test('a confirmed old host is described as needing an update, without blaming the key or saving', async () => {
  const f = fixture({ capabilities: {} }); await f.onboarding.startOnboarding({ configured: false });
  f.button('重新查询模型').fire('click'); f.ready(); await until(() => f.diagnostic().textContent.includes('更新'));
  assert.equal(f.calls.includes('/model-services/check'), false);
});

test('host status failure is recoverable and is not described as a service address or key error', async () => {
  const f = fixture({ statusError: { code: 'NETWORK' } }); await f.onboarding.startOnboarding({ configured: false });
  f.button('重新查询模型').fire('click'); f.ready(); await until(() => f.diagnostic().textContent.includes('电脑'));
  assert.equal(f.diagnostic().textContent.includes('密钥'), false);
  assert.equal(f.calls.includes('/model-services/check'), false);
});

test('model save backend failure preserves the step and does not blame credentials', async () => {
  const f = fixture({ saveError: { code: 'ACCOUNT_MODEL_ROUTE_UNCONFIRMED' } }); f.core.state.personalCapabilities = { modelServices: 1 };
  await f.onboarding.startOnboarding({ configured: false }); f.button('重新查询模型').fire('click');
  await until(() => f.diagnostic().textContent === '找到 1 个模型'); f.button('继续').fire('click');
  await until(() => f.notice().textContent.includes('稍后'));
  assert.equal(f.notice().textContent.includes('密钥'), false);
  assert.equal(f.writes.some(row => row.route === '/onboarding'), false);
});

test('concurrent shared model actions wait for one capability read, including save without prior query', async () => {
  const f = fixture(), draft = { name: 'Synthetic', baseUrl: 'https://synthetic.example/v1', apiKey: 'synthetic-key' };
  const checking = f.core.checkModelService(draft), saving = f.core.writeModelService(null, draft);
  await tick(); assert.deepEqual(f.calls, ['/status']);
  f.ready(); await Promise.all([checking, saving]);
  assert.equal(f.calls.filter(path => path === '/status').length, 1);
  assert.equal(f.writes.filter(row => row.route === '/model-services').length, 1);
});

test('identity change while loading capabilities never submits the previous draft', async () => {
  const f = fixture(), work = f.core.checkModelService({ baseUrl: 'https://synthetic.example/v1', apiKey: 'previous-key' });
  f.core.state.identityGeneration++; f.ready();
  await assert.rejects(work, error => error.code === 'ABORTED');
  assert.equal(f.calls.includes('/model-services/check'), false);
});

test('failed capability read can be retried instead of being cached as an old computer', async () => {
  const f = fixture(), original = f.core.refreshStatus; let attempts = 0;
  f.core.refreshStatus = async () => { if (++attempts === 1) throw { code: 'NETWORK' }; return original(); };
  const draft = { baseUrl: 'https://synthetic.example/v1', apiKey: 'synthetic-key' };
  await assert.rejects(f.core.checkModelService(draft), error => error.code === 'MODEL_SERVICE_STATUS_UNAVAILABLE');
  const retry = f.core.checkModelService(draft); f.ready(); await retry;
  assert.equal(attempts, 2); assert.equal(f.calls.includes('/model-services/check'), true);
});

test('identity change just before a ready model action resumes never submits the previous draft', async () => {
  for (const action of ['checkModelService', 'writeModelService', 'selectServiceModel']) {
    const f = fixture(); f.core.state.personalCapabilities = { modelServices: 1 };
    const draft = { baseUrl: 'https://synthetic.example/v1', apiKey: 'previous-key' };
    const work = action === 'writeModelService' ? f.core[action](null, draft) : f.core[action](action === 'selectServiceModel' ? { serviceId: 'synthetic-service', modelId: 'synthetic-model' } : draft);
    f.core.state.identityGeneration++;
    await assert.rejects(work, error => error.code === 'ABORTED');
    assert.equal(f.calls.length, 0);
  }
});

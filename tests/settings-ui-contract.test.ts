import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// R6/R8 设置面收口契约：官方设置页 settings.section「WeftMate」节 = 感知/桌宠/设备配对
// 唯一控制面（感知/桌宠浮动胶囊已删）；动作 = 确定性 set-* + value（宿主白名单校验 →
// main 消费落盘 → 采集面/桌宠热读生效），桌宠等待真实状态，不把请求受理当成已生效。
// P1-02：感知/桌宠动作面（白名单 + value 校验）下沉 gateway/legacy。
const gatewayPerception = readFileSync(new URL('../src/runtime/gateway/legacy/perception.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gatewayPet = readFileSync(new URL('../src/runtime/gateway/legacy/pet.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

// 取顶层函数体（列 0 的收尾 `}` 为止；嵌套闭合均缩进）。
function fnBody(source: string, name: string): string {
  const match = new RegExp(`^(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm').exec(source);
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

describe('R6/R8 设置面收口契约（官方设置页 WeftMate 节）', () => {
  it('设置节注册：settings.section 槽位、id/order/label、感知/桌宠/设备三块', () => {
    const reg = between(client, "ctx.slots.inject('settings.section'", "ctx.slots.inject('shell.overlay'");
    assert.match(reg, /name: 'settings\.section'/);
    assert.match(reg, /id: 'weftmate'/);
    assert.match(reg, /order: 5000/);
    assert.match(reg, /label: 'WeftMate'/);
    assert.match(client, /桌面感知（R6 · opt-in）/);
    assert.match(client, /记忆与插件/);
    assert.match(client, /桌宠控制/);
    assert.match(client, /设备配对/);
  });

  it('宿主动作面：感知/桌宠 set-* 白名单 + value 校验（BAD_ACTION/BAD_VALUE）', () => {
    const perception = fnBody(gatewayPerception, 'writePerceptionRequest');
    assert.match(perception, /code: 'BAD_ACTION'/);
    assert.match(perception, /code: 'BAD_VALUE'/);
    assert.match(perception, /value !== 'app_title' && value !== 'app_only'/);
    assert.match(perception, /typeof value !== 'boolean'/);
    const pet = fnBody(gatewayPet, 'writePetRequest');
    assert.match(pet, /action !== 'set-visible' && action !== 'set-free-activity'/);
    assert.match(pet, /typeof value !== 'boolean'/);
  });

  it('main 消费确定性语义：不按当前值翻转，只按请求 value 落盘', () => {
    const perception = between(main, 'function handlePerceptionRequests()', '// R6-01 · 感知采集面');
    assert.match(perception, /raw\.value === true/);
    assert.match(perception, /raw\.value === 'app_only' \? 'app_only' : 'app_title'/);
    const pet = between(main, 'function handlePetRequests()', 'writeHostState();');
    assert.match(pet, /want !== desktopPetVisible\(\)/);
    assert.match(pet, /want !== desktopPetFreeActivity\(\)/);
    assert.match(pet, /setDesktopPetFreeActivity\(want\)/);
  });

  it('设置节设备块：轮询 device/state、token 展示+复制、设备列表', () => {
    assert.match(client, /fetchAvailableJson\('\/weftmate\/device\/state\.json', setDevice\)/);
    assert.match(client, /pairing\.token/);
    assert.match(client, /navigator\.clipboard/);
    assert.match(client, /'有效期 ' \+ fmtTokenLeft\(leftMs\)/);
    assert.match(client, /暂无已配对设备/);
  });

  it('感知保留原有对账，桌宠从真实状态显示', () => {
    const effect = between(client, '// 乐观覆盖', 'var eff = function');
    assert.match(effect, /prev\[key\] !== truth\[key\]/);
    assert.doesNotMatch(effect, /petVisible|petFreeActivity/);
    assert.match(client, /checked: pet\.visible/);
    assert.match(client, /pet\[petPending\.property\] === petPending\.value/);
  });
});

const connectionStates = runInNewContext(
  between(client, 'function memoryConnectionStatus(', 'function PhoneDeviceSetup(')
    + '\n({ memoryConnectionStatus, phoneRuntimeStatus })',
);
const memorySummary = runInNewContext(
  between(client, 'function deriveMemoryUiSummary(', 'function phoneRuntimeStatus(')
    + '\nderiveMemoryUiSummary',
);

const providerSave = runInNewContext(
  between(client, 'function isProviderSecretField(', 'function reloadProviders(')
    + '\nproviderSaveValue',
);

describe('模型提供方编辑保真', () => {
  it('编辑显示名会保留未在表单展示的正式 provider 配置，且不携带明文密钥', () => {
    const original = {
      displayName: '旧名称', api: 'openai-completions', baseURL: 'http://127.0.0.1:8080/v1',
      apiKeyEnv: 'DAI_MODELS_API_KEY', timeoutMs: 45_000, streamIdleTimeoutMs: 12_000,
      extraLegalOption: { retry: 2 }, apiKey: 'must-never-return', headers: { authorization: 'must-never-return', accept: 'application/json' },
      models: [{ id: 'qwen', name: 'Qwen', contextWindow: 131072, reasoningEfforts: { off: 'none' } }],
    };
    const result = providerSave({
      originalConfig: original, displayName: '新名称', api: original.api, baseURL: original.baseURL, models: original.models,
    }, original.apiKeyEnv) as Record<string, unknown>;
    assert.equal(result.displayName, '新名称');
    assert.equal(result.timeoutMs, 45_000);
    assert.equal(result.streamIdleTimeoutMs, 12_000);
    assert.deepEqual(JSON.parse(JSON.stringify(result.extraLegalOption)), { retry: 2 });
    assert.deepEqual(result.models, original.models);
    assert.equal(result.apiKeyEnv, 'DAI_MODELS_API_KEY');
    assert.equal(Object.hasOwn(result, 'apiKey'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(result.headers)), { accept: 'application/json' });
  });

  it('新增提供方仅写入表单合法字段及安全凭据引用', () => {
    const result = providerSave({
      originalConfig: undefined, displayName: '本地模型', api: 'openai-completions', baseURL: 'http://127.0.0.1:8080/v1',
      models: [{ id: 'qwen', name: 'qwen', contextWindow: 131072 }],
    }, 'NEW_LOCAL_API_KEY') as Record<string, unknown>;
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      displayName: '本地模型', api: 'openai-completions', baseURL: 'http://127.0.0.1:8080/v1',
      models: [{ id: 'qwen', name: 'qwen', contextWindow: 131072 }], apiKeyEnv: 'NEW_LOCAL_API_KEY',
    });
  });
});

describe('记忆与插件的真实状态', () => {
  it('记忆区分本次未启用、读取失败与连接就绪', () => {
    const memory = connectionStates.memoryConnectionStatus;
    assert.equal(memory({}, { ready: true }).label, '状态未知');
    assert.equal(memory({ available: false }, { ready: true }).label, '状态未知');
    assert.equal(memory({ available: true, memoweft: { enabled: false } }, { ready: true }).label, '本次未启用');
    const enabled = { available: true, memoweft: { enabled: true } };
    assert.equal(memory(enabled, { available: false }).ready, false);
    assert.match(memory(enabled, { available: false }).label, /不可用/);
    assert.equal(memory(enabled, { available: true, ready: true }).label, '已就绪');
  });

  it('Weave 统一记忆状态只投影 enabled、health、world 与 jobs 真值', () => {
    const host = { memoweft: { enabled: true } };
    assert.equal(memorySummary(null, null, null, null, 'loading').label, '连接中');
    assert.equal(memorySummary({ memoweft: { enabled: false } }, null, null, null, 'ready').label, '待配置');
    assert.equal(memorySummary(host, { available: false }, null, null, 'error').label, '不可用');
    const empty = memorySummary(host, { ready: true }, { cognitions: [] }, { jobs: [] }, 'ready');
    assert.equal(empty.label, '已连接'); assert.equal(empty.count, 0); assert.match(empty.detail, /暂无长期理解/);
    const pending = memorySummary(host, { ready: true }, { cognitions: [{ id: 'c1' }] }, { jobs: [{ worker: { state: 'processing' } }] }, 'ready');
    assert.equal(pending.label, '整理中'); assert.equal(pending.count, 1); assert.equal(pending.pending, 1);
  });

  it('手机服务就绪不冒充设备可执行，缺字段或未知状态不计为未安装', () => {
    const phone = connectionStates.phoneRuntimeStatus;
    assert.equal(phone({}).label, '状态未知');
    assert.equal(phone({ available: true, aiGame: { state: 'new-state' } }).label, '状态未知');
    assert.equal(phone({ available: true, aiGame: { state: 'not_installed' } }).label, '未安装');
    const ready = phone({ available: true, aiGame: { state: 'ready' } });
    assert.equal(ready.label, '服务就绪');
    assert.match(ready.detail, /设备连接、授权与任务执行仍需单独确认/);
  });

  it('状态请求失败清除过期状态，不伪装空设备或持续连接', async () => {
    const fetchState = runInNewContext(
      between(client, 'function fetchAvailableJson(', '// An enabled startup choice') + '\nfetchAvailableJson',
      { fetch: async () => ({ ok: false }), AbortSignal },
    );
    let state: any = { available: true, devices: [{ name: 'prior device' }] };
    await fetchState('/status', (next: unknown) => { state = next; });
    assert.equal(state.available, false);
    assert.equal(state.devices, undefined);
  });
});

describe('桌宠请求与实际状态分开', () => {
  async function submit(ok: boolean) {
    let pending: any = null;
    let feedback: any = null;
    let refreshed = false;
    const pet = { visible: false, freeActivity: false };
    const apply = runInNewContext(
      between(client, 'var applyPet = function', 'var sampleLine =') + '\napplyPet',
      {
        pet, petPending: null, AbortSignal,
        setPetPending: (next: unknown) => { pending = next; },
        setPetFeedback: (next: unknown) => { feedback = next; },
        fetch: async () => ({ ok, json: async () => ({ ok }) }),
        fetchAvailableJson: () => { refreshed = true; },
        setStatus: () => {},
        setLocal: () => { throw new Error('pet must not apply an optimistic setting'); },
      },
    );
    apply('petVisible', 'set-visible', true);
    assert.equal(pending.phase, 'sending');
    await new Promise(resolve => setImmediate(resolve));
    return { pending, feedback, pet, refreshed };
  }

  it('HTTP受理之后保持原开关，并刷新状态等待确认', async () => {
    const result = await submit(true);
    assert.equal(result.pet.visible, false);
    assert.equal(result.pending.phase, 'waiting');
    assert.equal(result.pending.value, true);
    assert.equal(result.refreshed, true);
    assert.equal(result.feedback, null);
  });

  it('请求失败退出等待并提供可见错误，保持实际开关', async () => {
    const result = await submit(false);
    assert.equal(result.pet.visible, false);
    assert.equal(result.pending, null);
    assert.equal(result.feedback.error, true);
    assert.match(result.feedback.text, /失败或超时/);
  });
});

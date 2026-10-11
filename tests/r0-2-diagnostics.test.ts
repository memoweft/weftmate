import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSystemStatus, calculatePerformanceMetrics, semanticRecallStatus, repairSystemComponent,
  buildDiagnosticBundle, diagnosticBundlePreview } from '../src/system-diagnostics.mjs';
import { createSystemStatusManager } from '../src/system-status-runtime.mjs';
import { createHostDiagnostics } from '../src/host-diagnostics.mjs';

const at = '2026-10-11T12:00:00.000Z';
const runId = '00000000-0000-4000-8000-000000000001';
const ids = ['host', 'memory', 'model', 'relay', 'certificate'];
function healthy() {
  return { host: { state: 'ready' }, memory: { state: 'ready' }, model: { configured: true, state: 'ready' },
    relay: { state: 'online' }, certificate: { certificateExpiresAt: '2099-01-01T00:00:00.000Z' } };
}
function component(value: any, id: string) { return value.components.find((item: any) => item.id === id); }

test('five components classify independent faults and expose useful next steps', () => {
  const initial = buildSystemStatus(healthy());
  assert.deepEqual(initial.components.map((item: any) => item.state), ids.map(() => 'healthy'));
  assert.deepEqual(initial.components.map((item: any) => item.name), ['对话与工具', '记忆', '回复模型', '远程连接', '安全连接']);
  const faults: Record<string, any> = { host: { state: 'unavailable' }, memory: { state: 'unavailable' },
    model: { configured: true, state: 'unavailable' }, relay: { state: 'offline' },
    certificate: { certificateExpiresAt: '2000-01-01T00:00:00.000Z' } };
  for (const id of ids) {
    const state = buildSystemStatus({ ...healthy(), [id]: faults[id] });
    assert.equal(component(state, id).state, 'problem');
    assert.equal(component(state, id).repairable, true);
    assert.ok(component(state, id).description.length > 10);
    assert.ok(component(state, id).nextStep.target);
    for (const sibling of ids.filter(value => value !== id)) assert.equal(component(state, sibling).state, 'healthy', `${id} must not affect ${sibling}`);
  }
  assert.match(component(buildSystemStatus({ ...healthy(), certificate: faults.certificate }), 'certificate').description, /已经过期.*本机仍可使用/);
});

test('optional services disabled and old memory core has no semantic item', () => {
  const state = buildSystemStatus({ host: { ready: true }, memory: { state: 'disabled' },
    model: { state: 'unconfigured' }, relay: { state: 'disabled' } });
  assert.equal(component(state, 'host').state, 'healthy');
  for (const id of ids.slice(1)) { assert.equal(component(state, id).state, 'disabled'); assert.equal(component(state, id).repairable, false); }
  assert.equal(Object.hasOwn(component(buildSystemStatus(healthy()), 'memory'), 'semanticRecall'), false);
  const firstUse = component(buildSystemStatus({host:{state:'unconfigured'}}), 'host');
  assert.equal(firstUse.state, 'disabled'); assert.equal(firstUse.repairable, false);
  assert.match(firstUse.description, /设置回复模型后/);
});

test('model credential failures and unfinished conversation scan explain their actual impact', () => {
  const preparing = component(buildSystemStatus({...healthy(), model:{state:'starting'}}), 'model');
  assert.equal(preparing.state, 'healthy'); assert.match(preparing.description, /正在准备/);
  const missing = component(buildSystemStatus({...healthy(), model:{state:'unavailable',reachable:true,catalog:'available',modelListed:false}}), 'model');
  assert.equal(missing.reasonCode, 'MODEL_NOT_FOUND'); assert.match(missing.description, /没有找到所选模型/);
  for (const authentication of ['missing', 'rejected']) {
    const state = buildSystemStatus({ ...healthy(), model: { state: 'ready', configured: true, authentication } });
    assert.equal(component(state, 'model').state, 'problem');
    assert.match(component(state, 'model').description, /密钥|凭据/);
    assert.match(component(state, 'model').nextStep.label, /密钥/);
  }
  assert.equal(component(buildSystemStatus({ ...healthy(), model: { configured: true, state: 'unavailable', lastError: 'MODEL_CREDENTIAL_UNAVAILABLE' } }), 'model').reasonCode, 'MODEL_CREDENTIAL_UNAVAILABLE');
  const scan = component(buildSystemStatus({ ...healthy(), host: { ready: true, lastError: 'REFERENCE_SCAN_FAILED' } }), 'host');
  assert.equal(scan.state, 'problem'); assert.equal(scan.nextStep.target, 'diagnostics');
  assert.match(scan.description, /模型设置暂时不能更改；已有记录仍可查看/);
});

test('semantic recall four states, known reason descriptions, normalized twice and bridge fault', () => {
  for (const state of ['disabled', 'preparing', 'ready', 'unavailable']) {
    const semantic = semanticRecallStatus({ state, reason: state === 'unavailable' ? 'dependency_missing' : 'not_loaded', model_id: 'synthetic-private-model' });
    assert.equal(semantic.state, state);
    assert.deepEqual(semanticRecallStatus(semantic), semantic, 'second projection preserves safe reason');
    assert.ok(!JSON.stringify(semantic).includes('synthetic-private-model'));
    const value = buildSystemStatus({ ...healthy(), memory: { state: 'ready', runtime: { semantic_recall: semantic } } });
    assert.equal(component(value, 'memory').semanticRecall.state, state);
    assert.equal(component(value, 'memory').state, state === 'unavailable' ? 'problem' : 'healthy');
    if (state === 'unavailable') assert.equal(component(value, 'memory').reasonCode, 'MEMORY_SEMANTIC_UNAVAILABLE');
  }
  const expected = { dependency_missing: /缺少查找所需的组件/, invalid_configuration: /查找设置暂不可用/, stopped: /查找服务已停止/ };
  for (const [reason, phrase] of Object.entries(expected)) assert.match(semanticRecallStatus({ state: 'unavailable', reason }).description, phrase);
  const unknown = semanticRecallStatus({ state: 'unavailable', reason: 'synthetic-secret-in-error' });
  assert.equal(unknown.reasonCode, 'unknown'); assert.ok(!JSON.stringify(unknown).includes('synthetic-secret-in-error'));
});

test('three performance numbers use recent valid samples, true median and explicit reference', () => {
  const metrics = calculatePerformanceMetrics({ startupMs: 1234, firstTokenMs: [90, 10, 40, 20, NaN, -1, 'secret'], rssBytes: 512 * 1024 ** 2 });
  assert.equal(metrics.startup.value, 1234); assert.equal(metrics.startup.state, 'normal');
  assert.equal(metrics.firstToken.value, 30); assert.equal(metrics.firstToken.sampleCount, 4);
  assert.equal(metrics.memory.value, 512 * 1024 ** 2);
  assert.equal(calculatePerformanceMetrics({ firstTokenMs: [20, 10, 30] }).firstToken.value, 20);
  const window = calculatePerformanceMetrics({ firstTokenMs: [100_000, ...Array.from({ length: 20 }, (_, index) => index)], startupMs: 10001, rssBytes: 1024 ** 3 + 1 });
  assert.equal(window.firstToken.value, 9.5); assert.equal(window.firstToken.sampleCount, 20);
  assert.match(window.startup.reference, /偏慢/); assert.match(window.memory.reference, /偏高/);
  const empty = calculatePerformanceMetrics({ startupMs: NaN, firstTokenMs: [-1], rssBytes: -1 });
  for (const metric of Object.values(empty)) { assert.equal(metric.value, null); assert.equal(metric.reference, '尚未记录'); }
});

test('repair dispatch calls exactly the selected component and propagates its failure', async () => {
  const calls: string[] = [];
  const repairs = Object.fromEntries(ids.map(id => [id, async () => { calls.push(id); return { id }; }]));
  for (const id of ids) { calls.length = 0; assert.deepEqual(await repairSystemComponent(id, repairs), { id }); assert.deepEqual(calls, [id]); }
  calls.length = 0;
  await assert.rejects(repairSystemComponent('program', repairs), { code: 'COMPONENT_REPAIR_UNAVAILABLE' }); assert.deepEqual(calls, []);
  await assert.rejects(repairSystemComponent('memory', { memory: () => { throw new Error('synthetic failure'); } }), /synthetic failure/);
});

function unpack(buffer: Buffer) {
  const files: Record<string, string> = {}; let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compression = buffer.readUInt16LE(offset + 8), size = buffer.readUInt32LE(offset + 18), original = buffer.readUInt32LE(offset + 22);
    const nameSize = buffer.readUInt16LE(offset + 26), extraSize = buffer.readUInt16LE(offset + 28);
    const filename = buffer.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize + extraSize;
    assert.equal(compression, 8);
    const data = inflateRawSync(buffer.subarray(start, start + size)); assert.equal(data.length, original);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    assert.equal(buffer.readUInt32LE(offset + 14), (crc ^ 0xffffffff) >>> 0, 'standard ZIP entry CRC');
    files[filename] = data.toString('utf8'); offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  assert.equal(buffer.readUInt16LE(buffer.length - 12), Object.keys(files).length);
  return files;
}

test('diagnostic ZIP has the declared fixed files and synthetic body/key/token/name/path scan has zero hits', () => {
  const secrets = ['synthetic-private-conversation', 'synthetic-private-memory', 'sk-synthetic-secret-key-123456789',
    'synthetic-login-token-123456789', 'synthetic-private-account', 'synthetic-private-model', 'synthetic-private-device'];
  const secret = secrets.join(' ');
  const raw: any = { at, event: 'host.failure', runId, recordIndex: 2, platform: 'windows', appVersion: '0.1.0', osVersion: '10.0.0',
    name: 'TypeError', code: 'ENOENT', message: secret, stackFrames: [secret], content: secrets[0], memory: secrets[1],
    apiKey: secrets[2], accessToken: secrets[3], accountId: secrets[4], profileId: secrets[5], machineName: secrets[6],
    source: secret, reason: secret, path: 'C:\\Users\\<user>\\private.txt' };
  const metrics = calculatePerformanceMetrics({ startupMs: 1800, firstTokenMs: [100, 300], rssBytes: 123456 });
  const { buffer, manifest } = buildDiagnosticBundle({ records: [raw, { ...raw, event: secret }, { ...raw, event: 'component.recovery', phase: 'memory', status: 'completed', action: 'restart' }],
    summary: JSON.stringify({ platform: 'windows', appVersion: '0.1.0', osVersion: '10.0.0', generatedAt: at,
      recentAbnormalRecords: [raw], abnormalCountsLast7Days: { 'host.failure': 1, [secret]: 1 }, retentionPolicy: { retentionDays: 7, maxBytes: 32 * 1024 ** 2 }, body: secret }),
    components: buildSystemStatus({ ...healthy(), memory: { state: 'ready', semanticRecall: { state: 'unavailable', reason: secret }, content: secret } }).components.map((item: any) => ({ ...item, description: secret, credential: secret })),
    versions: { appVersion: '0.1.0', runtimeVersion: '1.2.3', memoryVersion: '2.3.4', platform: 'windows', osVersion: '10.0.0', apiKey: secret, model: secret },
    performance: { ...metrics, secret }, generatedAt: at });
  const files = unpack(buffer);
  assert.deepEqual(Object.keys(files), manifest.files);
  assert.deepEqual(Object.keys(files), ['manifest.json', 'runtime-records.jsonl', 'diagnostics-summary.json', 'components.json', 'versions.json', 'performance.json']);
  const text = Object.values(files).join('\n');
  for (const sensitive of [...secrets, 'private.txt', 'C:\\Users']) assert.equal(text.includes(sensitive), false, `scan hit: ${sensitive}`);
  assert.equal(JSON.parse(files['diagnostics-summary.json']).recentAbnormalRecords[0].fields.code, 'ENOENT');
  assert.equal(JSON.parse(files['versions.json']).runtimeVersion, '1.2.3');
  assert.deepEqual(JSON.parse(files['performance.json']), metrics);
  const logs = files['runtime-records.jsonl'].trim().split('\n').map(line => JSON.parse(line));
  assert.equal(logs.length, 2); assert.equal(logs[1].fields.phase, 'memory');
  assert.deepEqual(JSON.parse(files['manifest.json']).excludes, diagnosticBundlePreview().excludes);
});

test('component read failures stay isolated, manager repair passes account only to selected owner and records result', async () => {
  const calls: any[] = [], logs: any[] = [];
  const manager = createSystemStatusManager({ readHost: () => ({ state: 'ready' }), readMemory: () => { throw new Error('synthetic failure'); },
    readModel: async () => ({ configured: true, state: 'ready' }), readRelay: async () => ({ state: 'online', certificateExpiresAt: '2099-01-01T00:00:00.000Z' }),
    repairs: Object.fromEntries(ids.map(id => [id, async (ownerId: string) => calls.push([id, ownerId])])),
    diagnostics: { status: () => ({ summary: '{}' }), records: () => [], write: (event: string, data: any) => logs.push({ event, ...data }) },
    metrics: () => ({ startupMs: 50 }), versions: () => ({ appVersion: '0.1.0' }) });
  const status = await manager.status('synthetic-owner');
  assert.equal(component(status, 'memory').state, 'problem');
  for (const id of ids.filter(id => id !== 'memory')) assert.equal(component(status, id).state, 'healthy');
  for (const id of ids) { calls.length = 0; await manager.restart(id, 'synthetic-owner'); assert.deepEqual(calls, [[id, 'synthetic-owner']]); }
  assert.deepEqual(logs.map(row => row.phase), ids);
  assert.ok(logs.every(row => row.event === 'component.recovery' && row.status === 'completed'));
});

test('normal pipeline runtime records retain allowlisted timing and queue facts without profile/session identities', () => {
  const records = ['model.start', 'model.end', 'model.queued', 'model.loading', 'model.failure', 'runtime.event', 'memory.bridge', 'background.route']
    .map(event => ({ at, event, runId, durationMs: 42, ahead: 2, status: 503, priority: 'foreground', source: 'dsh',
      code: 'MODEL_QUEUE_UNAVAILABLE', phase: 'ready', profileId: 'synthetic-private-profile', sessionId: 'synthetic-private-session' }));
  const files = unpack(buildDiagnosticBundle({ records }).buffer);
  const safe = files['runtime-records.jsonl'].trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(safe.map(row => row.event), records.map(row => row.event));
  assert.ok(safe.every(row => row.fields.durationMs === '42' && row.fields.status === '503' && row.fields.ahead === '2'));
  assert.ok(!Object.values(files).join('\n').includes('synthetic-private'));
});

test('failed component repair logs only its outcome and never invokes another repair', async () => {
  const calls: string[] = [], logs: any[] = [];
  const manager = createSystemStatusManager({ readHost: () => healthy().host, readMemory: () => healthy().memory,
    readModel: () => healthy().model, readRelay: () => healthy().relay,
    repairs: Object.fromEntries(ids.map(id => [id, async () => { calls.push(id); if (id === 'model') throw new Error('synthetic-private-error'); }])),
    diagnostics: { status: () => ({ summary: '{}' }), records: () => [], write: (event: string, data: any) => logs.push({ event, ...data }) },
    metrics: () => ({}), versions: () => ({}) });
  await assert.rejects(manager.restart('model', 'synthetic-owner'), /synthetic-private-error/);
  assert.deepEqual(calls, ['model']);
  assert.deepEqual(logs, [{ event: 'component.recovery', phase: 'model', status: 'failed', action: 'restart' }]);
});

test('existing local crash marker remains visible through system status; bundle excludes native dumps', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wm-r02-crash-'));
  try {
    const first = createHostDiagnostics(root, { version: '0.1.0' }); first.begin();
    const second = createHostDiagnostics(root, { version: '0.1.0' }); second.begin();
    const manager = createSystemStatusManager({ readHost: () => healthy().host, readMemory: () => healthy().memory,
      readModel: () => healthy().model, readRelay: () => ({ ...healthy().relay, ...healthy().certificate }), repairs: {},
      diagnostics: second, metrics: () => ({ startupMs: 100 }), versions: () => ({ appVersion: '0.1.0' }) });
    const status = await manager.status('synthetic-owner');
    assert.equal(status.runRecord.previous.normal, false);
    assert.equal(status.runRecord.uncleanCount7Days, 1);
    const files = unpack((await manager.export('synthetic-owner')).buffer);
    assert.ok(JSON.parse(files['diagnostics-summary.json']).recentAbnormalRecords.some((row: any) => row.event === 'host.previous_unclean_exit'));
    assert.ok(!Object.keys(files).some(name => /Crashpad|\.dmp$/i.test(name)));
    second.exit('user-quit');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

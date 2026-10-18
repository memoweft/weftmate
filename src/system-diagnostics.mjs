import { deflateRawSync } from 'node:zlib';
import { diagnosticAppVersion, sanitizeErrorDiagnostic } from './host-log.mjs';

const names = { host: '对话与工具', memory: '记忆', model: '回复模型', relay: '远程连接', certificate: '安全连接' };
const labels = { healthy: '正常', problem: '有问题', disabled: '未启用' };
const componentCodes = new Set(['HOST_READY', 'HOST_DISABLED', 'HOST_UNAVAILABLE', 'REFERENCE_SCAN_FAILED', 'MEMORY_READY', 'MEMORY_DISABLED', 'MEMORY_UNAVAILABLE', 'MEMORY_SEMANTIC_UNAVAILABLE',
  'MEMORY_MODEL_UNAVAILABLE', 'MEMORY_MODEL_WAITING', 'MEMORY_FORMATION_PENDING', 'MEMORY_FORMATION_FAILED',
  'MEMORY_FORMATION_RECOVERING', 'MEMORY_BOUNDARY_PENDING', 'MODEL_READY', 'MODEL_STARTING', 'MODEL_DISABLED', 'MODEL_UNAVAILABLE',
  'MODEL_AUTH_REJECTED', 'MODEL_CREDENTIAL_UNAVAILABLE', 'MODEL_NOT_FOUND', 'RELAY_READY', 'RELAY_DISABLED', 'RELAY_UNAVAILABLE', 'CERTIFICATE_READY',
  'CERTIFICATE_DISABLED', 'CERTIFICATE_EXPIRED', 'CERTIFICATE_UNAVAILABLE', 'CERTIFICATE_RENEWAL_FAILED']);
const semanticCodes = new Set(['disabled', 'preparing', 'ready', 'unavailable']);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

function row(id, state, reasonCode, description, target, nextLabel) {
  return { id, name: names[id], state, label: labels[state], reasonCode, description, repairable: state === 'problem',
    ...(state === 'problem' ? { nextStep: { target, label: nextLabel } } : {}) };
}

/** Accept component-owned facts. Free-text errors, addresses and credentials are never projected. */
export function buildSystemStatus(input = {}, { now = Date.now() } = {}) {
  const { host = {}, memory = {}, model = {}, relay = {} } = input;
  const components = [];
  const referenceScanFailed = host.lastError === 'REFERENCE_SCAN_FAILED';
  const hostDisabled = !referenceScanFailed && ['disabled', 'unconfigured'].includes(host.state);
  const hostReady = !referenceScanFailed && (host.ready === true || ['ready', 'running', 'healthy', 'online'].includes(host.state));
  components.push(row('host', hostDisabled ? 'disabled' : hostReady ? 'healthy' : 'problem', hostDisabled ? 'HOST_DISABLED' : referenceScanFailed ? 'REFERENCE_SCAN_FAILED' : hostReady ? 'HOST_READY' : 'HOST_UNAVAILABLE',
    hostDisabled ? '设置回复模型后即可开始对话与使用工具。' : referenceScanFailed ? '对话记录尚未核对完成，模型设置暂时不能更改；已有记录仍可查看。' :
      hostReady ? '对话与工具可以正常运行。' : '电脑上的对话服务没有连接，对话与工具暂时不能运行。', 'diagnostics', '查看运行记录'));
  const memoryDisabled = memory.state === 'disabled' || memory.enabled === false;
  const memoryReady = ['ready', 'connected', 'healthy'].includes(memory.state);
  const memoryReason = componentCodes.has(memory.reasonCode) ? memory.reasonCode : 'MEMORY_UNAVAILABLE';
  const memoryDescriptions = {
    MEMORY_MODEL_UNAVAILABLE: '记忆使用的模型暂时连不上，记忆形成与按意思查找可能受影响。',
    MEMORY_MODEL_WAITING: '记忆使用的模型正在等待，新的记忆会稍后处理。',
    MEMORY_FORMATION_PENDING: '有记忆正在形成，已有记忆仍可查看。',
    MEMORY_FORMATION_FAILED: '有记忆没有形成成功，已有记忆仍可查看。',
    MEMORY_FORMATION_RECOVERING: '记忆正在恢复处理，已有记忆仍可查看。',
    MEMORY_BOUNDARY_PENDING: '有新内容尚未处理，相关记忆暂时不能使用。',
  };
  const memoryRow = row('memory', memoryDisabled ? 'disabled' : memoryReady ? 'healthy' : 'problem',
    memoryDisabled ? 'MEMORY_DISABLED' : memoryReady ? 'MEMORY_READY' : memoryReason,
    memoryDisabled ? '尚未启用记忆。' : memoryReady ? '记忆连接正常，可以查看与使用已有记忆。' :
      memoryDescriptions[memoryReason] ?? '记忆连接暂时不可用，记忆查找与形成暂时不可用。',
    memoryReason === 'MEMORY_MODEL_UNAVAILABLE' || memoryReason === 'MEMORY_MODEL_WAITING' ? 'models' : 'memory',
    memoryReason === 'MEMORY_MODEL_UNAVAILABLE' ? '去模型设置检查记忆使用的模型' : '去记忆页查看处理状态');
  const semantic = memory.runtime?.semantic_recall ?? memory.semanticRecall ?? memory.semantic_recall;
  if (semantic !== undefined && semantic !== null) {
    memoryRow.semanticRecall = semanticRecallStatus(semantic);
    if (!memoryDisabled && memoryReady && memoryRow.semanticRecall.state === 'unavailable') {
      Object.assign(memoryRow, { state: 'problem', label: labels.problem, reasonCode: 'MEMORY_SEMANTIC_UNAVAILABLE', repairable: true,
        description: '已有记忆可以查看，按意思查找暂时不可用。', nextStep: { target: 'memory', label: '重新连接后仍不可用时，去记忆页查看状态' } });
    }
  }
  components.push(memoryRow);
  const modelDisabled = model.configured === false || ['disabled', 'unconfigured'].includes(model.state);
  const modelAuthFailed = model.authentication === 'rejected';
  const modelCredentialMissing = model.authentication === 'missing' || model.lastError === 'MODEL_CREDENTIAL_UNAVAILABLE';
  const modelStarting = model.state === 'starting' && !modelAuthFailed && !modelCredentialMissing;
  const modelMissing = model.reachable === true && model.catalog === 'available' && model.modelListed === false;
  const modelReady = !modelAuthFailed && !modelCredentialMissing && (model.ready === true || ['ready', 'healthy'].includes(model.state) || model.reachable === true &&
    model.model !== 'missing' && (model.modelListed === true || model.inferenceVerified === true || model.catalog === 'unsupported'));
  components.push(row('model', modelDisabled ? 'disabled' : modelStarting || modelReady ? 'healthy' : 'problem',
    modelDisabled ? 'MODEL_DISABLED' : modelStarting ? 'MODEL_STARTING' : modelReady ? 'MODEL_READY' : modelMissing ? 'MODEL_NOT_FOUND' : modelAuthFailed ? 'MODEL_AUTH_REJECTED' : modelCredentialMissing ? 'MODEL_CREDENTIAL_UNAVAILABLE' : 'MODEL_UNAVAILABLE',
    modelDisabled ? '尚未设置回复使用的模型。' : modelStarting ? '模型正在准备，新的回复需要稍等。' : modelReady ? '回复模型可以连接。' : modelMissing ? '这个地址没有找到所选模型，新的回复暂时不能生成。' : modelCredentialMissing ? '模型密钥暂时不可用，新的回复暂时不能生成。' : modelAuthFailed ?
      '模型密钥没有通过验证，新的回复暂时不能生成。' : '模型地址暂时连不上，新的回复暂时不能生成。',
    'models', modelAuthFailed || modelCredentialMissing ? '去模型设置检查密钥' : '去模型设置检查地址与模型'));
  if (modelStarting) components.at(-1).pending = true;
  const relayDisabled = relay.enabled === false || ['disabled', 'unconfigured'].includes(relay.state) || !relay.state;
  const relayReady = ['online', 'ready', 'healthy'].includes(relay.state);
  components.push(row('relay', relayDisabled ? 'disabled' : relayReady ? 'healthy' : 'problem',
    relayDisabled ? 'RELAY_DISABLED' : relayReady ? 'RELAY_READY' : 'RELAY_UNAVAILABLE',
    relayDisabled ? '尚未启用远程连接。' : relayReady ? '手机与其他电脑可以连接。' : '远程连接暂时不可用，手机与其他电脑的访问受影响，本机仍可使用。',
    'connections', '检查电脑网络与远程连接设置'));
  const certificate = input.certificate ?? relay;
  const expires = Date.parse(certificate.certificateExpiresAt ?? certificate.expiresAt);
  const certificateDisabled = certificate.enabled === false || certificate.state === 'disabled' || relayDisabled && !input.certificate;
  const expired = Number.isFinite(expires) && expires <= now;
  const certificateReady = Number.isFinite(expires) && !expired;
  const renewalFailed = certificate.certificateErrorCode != null || certificate.errorCode != null && !certificateReady;
  components.push(row('certificate', certificateDisabled ? 'disabled' : certificateReady && !renewalFailed ? 'healthy' : 'problem',
    certificateDisabled ? 'CERTIFICATE_DISABLED' : expired ? 'CERTIFICATE_EXPIRED' : renewalFailed ? 'CERTIFICATE_RENEWAL_FAILED' : certificateReady ? 'CERTIFICATE_READY' : 'CERTIFICATE_UNAVAILABLE',
    certificateDisabled ? '未启用需要证书的远程连接。' : expired ? '远程证书已经过期，手机与其他电脑的安全连接受影响，本机仍可使用。' :
      certificate.certificateErrorCode === 'CERTIFICATE_NETWORK_UNAVAILABLE' ? '网络连不上证书服务。请检查网络或代理设置，再点重试。' :
      renewalFailed ? '远程证书更新没有成功，远程安全连接可能受影响，本机仍可使用。' : certificateReady ?
        '远程安全连接使用的证书有效。' : '远程证书暂时不可用，远程安全连接受影响，本机仍可使用。',
    'diagnostics', '查看安全连接的运行记录'));
  return { components };
}

export function semanticRecallStatus(value) {
  const source = typeof value === 'string' ? { state: value } : value ?? {};
  const state = source.enabled === false || ['disabled', 'not_enabled', 'not_configured'].includes(source.state) ? 'disabled' :
    source.ready === true || ['ready', 'available'].includes(source.state) ? 'ready' :
      ['preparing', 'starting', 'warming', 'loading', 'pending', 'initializing'].includes(source.state) ? 'preparing' : 'unavailable';
  const reason = source.reasonCode ?? source.reason_code ?? source.reason;
  const reasonCode = ['dependency_missing', 'invalid_configuration', 'stopped', 'not_loaded', 'model_unavailable'].includes(reason) ? reason :
    /model|embedding/i.test(typeof reason === 'string' ? reason : '') ? 'model_unavailable' : 'unknown';
  const reasons = { dependency_missing: '缺少查找所需的组件，仍可按关键词查找。',
    invalid_configuration: '查找设置暂不可用，仍可按关键词查找。', stopped: '查找服务已停止，仍可按关键词查找；可重新连接后再试。',
    model_unavailable: '查找使用的模型暂时不可用，仍可按关键词查找。' };
  const description = state === 'disabled' ? '按意思找未启用，仍可按关键词查找。' : state === 'ready' ? '可以按意思查找记忆。' :
    state === 'preparing' ? '按意思找正在准备，暂时可以按关键词查找。' :
      reasons[reasonCode] ?? '按意思找暂时不能启动，仍可按关键词查找；可重新连接后再试。';
  return { state, label: { disabled: '未启用', preparing: '准备中', ready: '就绪', unavailable: '不可用' }[state], description, reasonCode };
}

export function calculatePerformanceMetrics({ startupMs, firstTokenMs = [], rssBytes } = {}) {
  const samples = (Array.isArray(firstTokenMs) ? firstTokenMs : []).filter(value => number(value) !== null).slice(-20).sort((a, b) => a - b);
  const middle = Math.floor(samples.length / 2);
  const median = !samples.length ? null : samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2;
  const metric = (value, unit, threshold, reference) => ({ value: number(value), unit,
    state: number(value) === null ? 'unknown' : value > threshold ? 'slow' : 'normal',
    reference: number(value) === null ? '尚未记录' : value > threshold ? reference : '正常' });
  return { startup: metric(startupMs, 'ms', 10_000, '偏慢 · 超过 10 秒'),
    firstToken: { ...metric(median, 'ms', 5_000, '偏慢 · 超过 5 秒'), sampleCount: samples.length },
    memory: metric(rssBytes, 'bytes', 1024 ** 3, '偏高 · 超过 1 GB') };
}

/** The caller owns each component's recovery; this dispatcher never restarts a sibling. */
export async function repairSystemComponent(id, repairs) {
  if (!Object.hasOwn(names, id) || typeof repairs?.[id] !== 'function') throw Object.assign(new Error('COMPONENT_REPAIR_UNAVAILABLE'), { code: 'COMPONENT_REPAIR_UNAVAILABLE' });
  return repairs[id]();
}

export function diagnosticBundlePreview() {
  return { includes: ['脱敏运行记录', '诊断摘要', '五个组件的状态', '程序与运行时版本', '启动、首字与内存三项指标'],
    excludes: ['对话正文', '记忆内容', '密钥与登录凭据', '崩溃文件（可能含有私人内容）', '账号、机器名与服务器地址'] };
}

const events = new Set(['host.start', 'host.exit', 'host.failure', 'host.previous_unclean_exit', 'host.shutdown_step',
  'host.crash_reporter', 'host.session_end', 'host.event', 'host.ready', 'host.startup_ready', 'model.first_token',
  'renderer.process_gone', 'renderer.recovery', 'child.process_gone', 'runtime.process_gone', 'runtime.recovery',
  'model.request', 'model.response', 'model.request_started', 'model.request_completed', 'component.recovery',
  'model.start', 'model.end', 'model.queued', 'model.loading', 'model.failure', 'model.switch_wait',
  'runtime.event', 'memory.bridge', 'background.route']);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const enumFields = {
  phase: new Set(['host', 'memory', 'model', 'relay', 'certificate', 'configured', 'ready', 'disabled', 'recovering', 'degraded', 'unavailable']),
  priority: new Set(['foreground', 'background']),
  reason: new Set(['user-quit', 'update-restart', 'system-shutdown', 'single-instance', 'startup-failure', 'unknown', 'clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction', 'unexpected-exit', 'startup-failed']),
  status: new Set(['completed', 'failed', 'ready', 'starting', 'unavailable', 'disabled']),
  action: new Set(['shutdown-confirmed', 'ui-rollback-requested', 'no-recovery-requested', 'window-reloaded', 'electron-managed', 'retry', 'restart', 'retry-started', 'restart-succeeded', 'restart-failed', 'give-up', 'respawn-scheduled', 'respawn-succeeded', 'respawn-failed', 'startup-failed', 'startup-retry-scheduled', 'startup-abandoned']),
  processType: new Set(['renderer', 'GPU', 'Utility', 'Zygote', 'Sandbox-helper', 'Pepper-Plugin', 'Pepper-Plugin-Broker', 'auxiliary', 'runtime']),
  step: new Set(['backup', 'desktop-session', 'personal-access', 'personal-browser', 'account-memory', 'managed-ai-game', 'desktop-pet', 'perception', 'devices', 'dsh-runtime', 'model-observer']),
  source: new Set(['startup', 'uncaughtException', 'unhandledRejection', 'harness-startup', 'main-startup', 'personal-host-startup', 'crash-reporter', 'diagnostics-export', 'shutdown', 'shutdown-backup', 'shutdown-account-memory', 'shutdown-dsh-runtime', 'dsh', 'connection-test']),
  code: new Set([...componentCodes, 'RUNTIME_FAILURE', 'RUNTIME_STATE', 'CONNECTION_TEST_FAILED', 'USAGE_LIMIT_REACHED', 'MODEL_SUGGESTION_BUSY', 'MODEL_QUEUE_UNAVAILABLE']),
};
const numericFields = ['recordIndex', 'exitCode', 'durationMs', 'shutdownDurationMs', 'dumpCount', 'dumpBytes', 'startupMs', 'firstTokenMs', 'rssBytes', 'ahead'];
const booleanFields = ['normal', 'cleanupComplete', 'headless', 'memoryEnabled', 'localModelConfigured', 'configured'];
const platform = value => ['windows', 'macos', 'linux', 'android', 'ios', 'watchos'].includes(value) ? value : 'unknown';
const osVersion = value => typeof value === 'string' && /^[0-9][0-9A-Za-z.+_-]{0,79}$/.test(value) ? value : 'unknown';

export function projectDiagnosticRecord(value) {
  if (!value || !events.has(value.event) || !time(value.at) || !uuid(value.runId)) return null;
  const source = value.fields && typeof value.fields === 'object' ? value.fields : value;
  const fields = {};
  for (const key of numericFields) {
    const candidate = typeof source[key] === 'string' && /^-?\d+(?:\.\d+)?$/.test(source[key]) ? Number(source[key]) : source[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && (key === 'exitCode' || candidate >= 0)) fields[key] = String(candidate);
  }
  for (const key of booleanFields) if (typeof source[key] === 'boolean' || ['true', 'false'].includes(source[key])) fields[key] = String(source[key]);
  for (const [key, allowed] of Object.entries(enumFields)) if (allowed.has(source[key])) fields[key] = source[key];
  if (Number.isInteger(Number(source.status)) && Number(source.status) >= 100 && Number(source.status) <= 599) fields.status = String(Number(source.status));
  for (const key of ['startedAt', 'lastAt']) if (time(source[key])) fields[key] = source[key];
  if (events.has(source.lastEvent)) fields.lastEvent = source.lastEvent;
  if (uuid(source.previousRunId)) fields.previousRunId = source.previousRunId;
  if (value.event === 'host.failure') Object.assign(fields, sanitizeErrorDiagnostic({ name: source.name, code: source.code, message: source.message }));
  return { at: value.at, event: value.event, runId: value.runId, platform: platform(value.platform),
    appVersion: diagnosticAppVersion(value.appVersion ?? value.version), osVersion: osVersion(value.osVersion), fields };
}

function projectSummary(input) {
  let value = input;
  if (typeof input === 'string') try { value = JSON.parse(input); } catch { value = {}; }
  value ??= {};
  const counts = {};
  for (const [event, count] of Object.entries(value.abnormalCountsLast7Days ?? {})) if (events.has(event) && Number.isSafeInteger(count) && count >= 0) counts[event] = count;
  return { platform: platform(value.platform), appVersion: diagnosticAppVersion(value.appVersion), osVersion: osVersion(value.osVersion),
    generatedAt: time(value.generatedAt) ? value.generatedAt : null,
    recentAbnormalRecords: (Array.isArray(value.recentAbnormalRecords) ? value.recentAbnormalRecords : []).slice(-20).map(projectDiagnosticRecord).filter(Boolean),
    abnormalCountsLast7Days: counts, retentionPolicy: { retentionDays: number(value.retentionPolicy?.retentionDays), maxBytes: number(value.retentionPolicy?.maxBytes) } };
}

function projectComponents(input) {
  return Object.keys(names).map(id => {
    const item = (Array.isArray(input) ? input : []).find(item => item?.id === id) ?? {};
    const result = { id, state: ['healthy', 'problem', 'disabled'].includes(item.state) ? item.state : 'problem',
      reasonCode: componentCodes.has(item.reasonCode) ? item.reasonCode : `${id.toUpperCase()}_UNAVAILABLE` };
    if (id === 'memory' && semanticCodes.has(item.semanticRecall?.state)) result.semanticRecall = { state: item.semanticRecall.state };
    return result;
  });
}

/** Fixed files and structural allowlists: never archive a data directory or crash dump. */
export function buildDiagnosticBundle({ records = [], summary, components, versions = {}, performance = {}, generatedAt = new Date().toISOString() } = {}) {
  const preview = diagnosticBundlePreview();
  const files = {
    'runtime-records.jsonl': (Array.isArray(records) ? records : []).map(projectDiagnosticRecord).filter(Boolean).map(row => JSON.stringify(row)).join('\n') + '\n',
    'diagnostics-summary.json': JSON.stringify(projectSummary(summary), null, 2),
    'components.json': JSON.stringify(projectComponents(components), null, 2),
    'versions.json': JSON.stringify({ appVersion: diagnosticAppVersion(versions.appVersion), runtimeVersion: diagnosticAppVersion(versions.runtimeVersion),
      memoryVersion: diagnosticAppVersion(versions.memoryVersion), platform: platform(versions.platform), osVersion: osVersion(versions.osVersion) }, null, 2),
    'performance.json': JSON.stringify(calculatePerformanceMetrics({ startupMs: performance.startup?.value,
      firstTokenMs: performance.firstToken?.value == null ? [] : [performance.firstToken.value], rssBytes: performance.memory?.value }), null, 2),
  };
  // Preserve the measured sample count, without taking any raw sample metadata.
  const metrics = JSON.parse(files['performance.json']);
  if (Number.isSafeInteger(performance.firstToken?.sampleCount) && performance.firstToken.sampleCount >= 0 && performance.firstToken.sampleCount <= 20) metrics.firstToken.sampleCount = performance.firstToken.sampleCount;
  files['performance.json'] = JSON.stringify(metrics, null, 2);
  const manifest = { format: 'weftmate-diagnostics', schemaVersion: 1, generatedAt: time(generatedAt) ? generatedAt : null,
    files: ['manifest.json', ...Object.keys(files)], includes: preview.includes, excludes: preview.excludes };
  return { buffer: zip({ 'manifest.json': JSON.stringify(manifest, null, 2), ...files }), manifest };
}

// Small standard ZIP envelope over Node's existing compression. Fixed ASCII names,
// UTF-8 contents, no file attributes/paths and no external archive dependency.
const crcTable = Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(content), compressed = deflateRawSync(data), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename); offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

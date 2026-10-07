/** Pure parsing helpers for the isolated text-delivery candidate. */
import { isAbsolute } from 'node:path';

const MAX_TEXT_BYTES = 128 * 1024;
const publicId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function documentFileName(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC');
  if (!name || Buffer.byteLength(name, 'utf8') > 160 || name.includes('..') ||
      !/^[\p{L}\p{N}][\p{L}\p{N} _.-]*\.(?:md|txt)$/u.test(name)) return null;
  const stem = name.slice(0, name.lastIndexOf('.'));
  if (/[ .]$/.test(stem) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(stem)) return null;
  return name;
}

function documentText(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES &&
    !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value;
}

/** Native text JSON, text arrays and the official run_code { logs, result } wrapper. */
export function toolResultValues(content) {
  const values = [];
  const visit = (value) => {
    if (typeof value === 'string') {
      try { visit(JSON.parse(value)); } catch { /* Non-JSON tool output is not success evidence. */ }
    } else if (Array.isArray(value)) {
      for (const part of value) visit(part);
    } else if (value && typeof value === 'object' && value.isError !== true) {
      if (value.type === 'text') {
        if (typeof value.text === 'string') visit(value.text);
      } else if (value.type === 'tool-result') visit(value.content);
      else if (Array.isArray(value.logs) && Object.hasOwn(value, 'result') &&
        Object.keys(value).every((key) => key === 'logs' || key === 'result')) visit(value.result);
      else values.push(value);
    }
  };
  visit(content);
  return values;
}

export function lastModelToolResult(messages, names, callId) {
  const toolNames = new Map();
  for (const message of messages ?? []) for (const call of message.tool_calls ?? [])
    if (typeof call.id === 'string') toolNames.set(call.id, call.function?.name);
  for (const message of [...(messages ?? [])].reverse()) {
    if (message.role !== 'tool') continue;
    const id = message.tool_call_id, name = message.name ?? toolNames.get(id);
    if (!names.includes(name) || callId !== undefined && id !== callId) continue;
    return { callId: id, name, value: toolResultValues(message.content).at(-1) ?? null };
  }
  return null;
}

export function documentFromWeftmodResult(value) {
  if (value?.status !== 'succeeded' || value.error !== null || typeof value.result?.path !== 'string' ||
      !documentText(value.result.after)) return null;
  const fileName = documentFileName(value.result.path.replaceAll('\\', '/').split('/').at(-1));
  return fileName ? { fileName, content: value.result.after, sourcePath: value.result.path,
    operation: value.result.operation ?? null } : null;
}

export function textDeliveryInput(value) {
  const fileName = documentFileName(value?.fileName), source = value?.source;
  if (value?.schemaVersion !== 1 || !fileName || !documentText(value.content) ||
      !source || !publicId(source.sessionId) || !publicId(source.taskId) ||
      typeof source.callId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(source.callId) ||
      typeof source.nativeLogPath !== 'string' || !isAbsolute(source.nativeLogPath) ||
      !Number.isSafeInteger(source.toolResultSeq) || source.toolResultSeq < 0)
    throw new Error('INVALID_TEXT_DELIVERY_SOURCE');
  return { schemaVersion: 1, fileName, content: value.content, source: {
    sessionId: source.sessionId, taskId: source.taskId, callId: source.callId,
    nativeLogPath: source.nativeLogPath, toolResultSeq: source.toolResultSeq } };
}

export function textDeliveryGoal(document) {
  return 'TEXT_ARTIFACT_DELIVERY 将下面 JSON 中的完整 content 保存为 fileName 指定的本任务文档成果，并按实际工具结果报告交付状态。\n' +
    JSON.stringify({ fileName: document.fileName, content: document.content });
}

export function documentFromTextDeliveryGoal(text) {
  const header = /^TEXT_ARTIFACT_DELIVERY [^\n]*\n/.exec(text ?? '');
  if (!header) return null;
  let value; try { value = JSON.parse(text.slice(header[0].length)); } catch { return null; }
  const fileName = documentFileName(value?.fileName);
  return fileName && documentText(value.content) ? { fileName, content: value.content } : null;
}

/** The desktop IPC bridge returns only these model-facing Save receipt fields. */
export function confirmedSaveResult(value, expected) {
  return !!(publicId(value?.artifactId) && publicId(expected?.taskId) && value.taskId === expected.taskId &&
    value.fileName === expected.fileName && documentFileName(value.fileName) &&
    Number.isSafeInteger(value.size) && value.size > 0 && value.size <= MAX_TEXT_BYTES && value.size === expected.size &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && value.sha256 === expected.sha256 &&
    value.state === 'observed');
}

/** Task-detail REST records retain the full command and verification evidence. */
export function observedTextArtifact(value, expected) {
  return !!(value?.kind === 'desktop.write_artifact' && publicId(value.commandId) && publicId(value.artifactId) &&
    publicId(expected?.taskId) && value.taskId === expected.taskId && value.sessionId === expected.sessionId &&
    value.fileName === expected.fileName && documentFileName(value.fileName) &&
    Number.isSafeInteger(value.size) && value.size > 0 && value.size <= MAX_TEXT_BYTES && value.size === expected.size &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && value.sha256 === expected.sha256 &&
    value.state === 'observed' && value.verification?.status === 'observed' &&
    value.verification.method === 'sha256_readback' && Number.isFinite(Date.parse(value.verification.observedAt)));
}

export function artifactMetadata(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(['commandId', 'requestId', 'kind', 'targetDeviceId', 'sessionId', 'taskId', 'artifactId',
    'fileName', 'size', 'sha256', 'state', 'verification', 'errorCode', 'createdAt', 'updatedAt']
    .filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

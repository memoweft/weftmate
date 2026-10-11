import { mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { constants, release } from 'node:os';

export const diagnosticPlatform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
export const diagnosticAppVersion = value => typeof value === 'string' && /^(?:\d+\.){1,3}\d+(?:[-+][A-Za-z0-9.-]{1,40})?$/.test(value) ? value : 'unknown';
export const diagnosticOsVersion = /^[0-9][0-9A-Za-z.+_-]{0,79}$/.test(release()) ? release() : 'unknown';

// Metadata only. Fields describe execution, never user/model/file content.
// runId: generated UUID; reason/action: lifecycle enums; exitCode: OS code;
// step/status/durationMs: cleanup timing; normal/cleanupComplete: shutdown result;
// previousRunId/startedAt/lastAt/lastEvent: preceding run; dumpCount/dumpBytes: local dump metadata.
const fields = new Set(['mode', 'version', 'pid', 'headless', 'memoryEnabled', 'localModelConfigured',
  'profileId', 'sessionId', 'priority', 'phase', 'ahead', 'durationMs', 'status', 'code', 'source', 'configured',
  'runId', 'reason', 'action', 'exitCode', 'step', 'normal', 'cleanupComplete', 'previousRunId',
  'startedAt', 'lastAt', 'lastEvent', 'dumpCount', 'dumpBytes', 'processType', 'shutdownDurationMs']);
const hostFile = /^host-\d{4}-\d\d-\d\d(?:-\d+)?\.jsonl$/;
const safeString = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);

// Console only: redaction cannot distinguish conversation/filename/account from ordinary prose.
// Disk errors use canonical technical templates below, never arbitrary redacted text.
export function redactSecretText(value) {
  return String(value ?? '')
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*[^\r\n]+/gi, '[REDACTED]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|credential)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]')
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, '[URL]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n<>"']+|(?:file:\/\/\/|\/(?:Users|home|tmp|var|mnt|Volumes)\/)[^\s<>"']+/g, '[PATH]')
    .replace(/\b[A-Za-z0-9_+\/-]{24,}={0,2}\b/g, '[REDACTED]')
    .slice(0, 400);
}
const errorNames = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'AbortError']);
const errorCodes = new Set([...Object.keys(constants.errno), 'ABORT_ERR', 'HOST_ERROR', 'ERR_INVALID_ARG_TYPE',
  'SERVICE_CLOSING', 'CLOSE_TIMEOUT', 'BACKUP_INTERRUPTED', 'BACKUP_SYMLINK', 'BACKUP_CORRUPT',
  'STORAGE_UNAVAILABLE', 'SESSION_BUSY', 'RUNTIME_UNAVAILABLE', 'CAPABILITY_UNAVAILABLE', 'MODEL_UNAVAILABLE',
  'ERR_INVALID_ARG_VALUE', 'ERR_MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_OUT_OF_RANGE', 'ERR_HTTP_HEADERS_SENT', 'ERR_STREAM_DESTROYED', 'ERR_SOCKET_CLOSED', 'ERR_IPC_CHANNEL_CLOSED']);
const safeDumps = data => (Array.isArray(data) ? data : []).slice(0, 5).filter(item =>
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.dmp$/i.test(item?.name) && Number.isFinite(item?.size) && item.size >= 0)
  .map(item => ({ name: item.name, size: item.size }));
function technicalMessage(value) {
  const text = redactSecretText(value);
  if (/^Cannot read properties of (?:undefined|null)(?:\s|$)/.test(text)) return /^Cannot read properties of null/.test(text) ? 'Cannot read properties of null' : 'Cannot read properties of undefined';
  if (/^Cannot set properties of (?:undefined|null)(?:\s|$)/.test(text)) return 'Cannot set properties of undefined or null';
  if (/^.+ is not a function$/.test(text)) return 'Value is not a function';
  if (/^.+ is not defined$/.test(text)) return 'Reference is not defined';
  if (/^Cannot find (?:module|package)\b/.test(text)) return 'Cannot find module';
  for (const code of Object.keys(constants.errno)) if (text.startsWith(`${code}:`)) return `${code}: system operation failed`;
  const exact = new Set(['fetch failed', 'Failed to fetch', 'Maximum call stack size exceeded', 'Invalid URL',
    'Invalid time value', 'Unexpected end of JSON input', 'The operation was aborted', 'write after end', 'socket hang up']);
  return exact.has(text) ? text : undefined;
}
function sourcePaths(appRoot) {
  const paths = new Set();
  if (!appRoot) return paths;
  function visit(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) visit(path);
      else if (item.isFile() && /\.(?:mjs|js|ts)$/.test(item.name)) paths.add(relative(appRoot, path).replaceAll('\\', '/'));
    }
  }
  try { visit(join(appRoot, 'src')); } catch { /* No source tree: omit all frames. */ }
  return paths;
}
export function sanitizeErrorDiagnostic(error, { appRoot, knownPaths = sourcePaths(appRoot) } = {}) {
  const result = { name: errorNames.has(error?.name) ? error.name : 'Error', code: errorCodes.has(error?.code) ? error.code : 'HOST_ERROR' };
  const message = technicalMessage(typeof error?.message === 'string' ? error.message : '');
  if (message) result.message = message;
  const frames = [];
  if (appRoot && typeof error?.stack === 'string') for (const line of error.stack.split('\n').slice(1)) {
    const match = /(?:\(|\s)((?:file:\/\/\/|[A-Za-z]:[\\/]|\/|src[\\/])[^\r\n]*?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) continue;
    try {
      const location = match[1].startsWith('file:') ? fileURLToPath(match[1]) : match[1];
      const path = relative(resolve(appRoot), resolve(appRoot, location)).replaceAll('\\', '/');
      if (knownPaths.has(path)) frames.push(`${path}:${Number(match[2])}:${Number(match[3])}`);
    } catch { /* Unknown paths/functions/arguments never become diagnostic data. */ }
    if (frames.length === 8) break;
  }
  if (frames.length) result.stackFrames = frames;
  return result;
}
export function createHostLog(root, { now = () => new Date(), maxBytes = 2 * 1024 * 1024, retentionDays = 7,
  maxTotalBytes = 32 * 1024 * 1024, appRoot, version, runId = randomUUID() } = {}) {
  const directory = join(root, 'logs');
  const knownPaths = sourcePaths(appRoot);
  const runs = new Map();
  function writeRow(event, data, errorData) {
    try {
      mkdirSync(directory, { recursive: true });
      const date = now(), day = date.toISOString().slice(0, 10);
      const cutoff = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - (retentionDays - 1) * 86400000).toISOString().slice(0, 10);
      for (const name of readdirSync(directory).filter(name => hostFile.test(name))) if (name.slice(5, 15) < cutoff) unlinkSync(join(directory, name));
      const metadata = Object.fromEntries(Object.entries(data).filter(([key, value]) => fields.has(key) &&
        (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || safeString(value))));
      if (['SIGTERM', 'SIGINT', 'SIGKILL', 'SIGHUP', 'SIGABRT', 'SIGSEGV', 'SIGBREAK', 'SIGQUIT'].includes(data.signal)) metadata.signal = data.signal;
      const rowRunId = typeof data.runId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.runId) ? data.runId : runId;
      const run = runs.get(rowRunId) ?? { recordIndex: 0, appVersion: diagnosticAppVersion(version ?? data.version) };
      runs.set(rowRunId, run);
      const row = { at: date.toISOString(), event: /^[a-z][a-z0-9._-]{0,80}$/.test(event) ? event : 'host.event', ...metadata, ...errorData,
        runId: rowRunId, recordIndex: ++run.recordIndex, platform: diagnosticPlatform,
        appVersion: run.appVersion, osVersion: diagnosticOsVersion };
      let encoded = JSON.stringify(row) + '\n';
      if (Buffer.byteLength(encoded) > maxBytes) return null;
      let index = 0, file;
      do { file = join(directory, `host-${day}${index ? `-${index}` : ''}.jsonl`); index++; }
      while ((() => { try { return statSync(file).size + Buffer.byteLength(encoded) + 1 > maxBytes; } catch { return false; } })());
      // Power loss can leave an unterminated row: isolate it so following valid rows recover.
      try {
        const size = statSync(file).size;
        if (size) { const fd = openSync(file, 'r'); const last = Buffer.alloc(1); try { readSync(fd, last, 0, 1, size - 1); } finally { closeSync(fd); } if (last[0] !== 10) encoded = '\n' + encoded; }
      } catch { /* Newly created file. */ }
      appendFileSync(file, encoded, { mode: 0o600, flush: event === 'host.exit' || event === 'host.start' });
      const files = readdirSync(directory).filter(name => hostFile.test(name)).map(name => ({ name, size: statSync(join(directory, name)).size }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
      let total = files.reduce((sum, row) => sum + row.size, 0);
      for (const item of files) { if (total <= maxTotalBytes) break; if (join(directory, item.name) !== file) { unlinkSync(join(directory, item.name)); total -= item.size; } }
      return row;
    } catch { return null; /* A full/unavailable disk must not crash the host. */ }
  }
  return { directory, retentionPolicy: { retentionDays, maxBytes: maxTotalBytes }, write: (event, data = {}) => writeRow(event, data),
    sanitizeError: error => sanitizeErrorDiagnostic(error, { appRoot, knownPaths }),
    failure: (source, error, data = {}) => writeRow('host.failure', { ...data, source }, sanitizeErrorDiagnostic(error, { appRoot, knownPaths })),
    previousUnclean: (data, dumps) => writeRow('host.previous_unclean_exit', data, { dumps: safeDumps(dumps) }) };
}

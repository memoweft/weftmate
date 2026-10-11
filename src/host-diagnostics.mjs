import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHostLog, diagnosticAppVersion, diagnosticOsVersion, diagnosticPlatform } from './host-log.mjs';

const dayMs = 86400000;
const hostName = /^host-\d{4}-\d\d-\d\d(?:-\d+)?\.jsonl$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const reasons = new Set(['user-quit', 'update-restart', 'system-shutdown', 'single-instance', 'startup-failure', 'unknown']);
const reasonText = { 'user-quit': '使用者退出', 'update-restart': '更新重启', 'system-shutdown': '系统关机或注销', 'single-instance': '已有程序正在运行', 'startup-failure': '启动失败', unknown: '原因未确定，可能是崩溃、强制结束或断电' };
function humanDate(value) {
  if (!iso(value)) return '未记录';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(new Date(value)).map(part => [part.type,part.value]));
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日 ${parts.hour}:${parts.minute}`;
}
const summaryEnums = {
  reason: new Set([...reasons, 'clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction']),
  action: new Set(['shutdown-confirmed', 'ui-rollback-requested', 'no-recovery-requested', 'window-reloaded', 'electron-managed',
    'retry', 'restart', 'retry-started', 'restart-succeeded', 'restart-failed', 'give-up']),
  processType: new Set(['renderer', 'GPU', 'Utility', 'Zygote', 'Sandbox-helper', 'Pepper-Plugin', 'Pepper-Plugin-Broker', 'auxiliary', 'runtime']),
  source: new Set(['startup', 'uncaughtException', 'unhandledRejection', 'harness-startup', 'main-startup', 'model-migration',
    'model-route-recovery', 'model-owner-backfill', 'personal-host-startup', 'harness-window-startup', 'crash-reporter',
    'startup-error-dialog', 'host-state-write', 'host-request-poll', 'dsh-surface-navigation', 'diagnostics-export',
    'shutdown', 'shutdown-backup', 'shutdown-desktop-session', 'shutdown-personal-access', 'shutdown-personal-browser',
    'shutdown-account-memory', 'shutdown-managed-ai-game', 'shutdown-desktop-pet', 'shutdown-perception', 'shutdown-devices',
    'shutdown-dsh-runtime', 'shutdown-model-observer', 'GPU', 'Utility', 'Zygote', 'Sandbox-helper', 'Pepper-Plugin', 'Pepper-Plugin-Broker', 'auxiliary']),
};
const isAnomaly = row => ['host.failure', 'host.previous_unclean_exit'].includes(row.event) ||
  ['host.process_gone', 'renderer.process_gone', 'child.process_gone', 'runtime.process_gone'].includes(row.event) && row.reason !== 'clean-exit' || row.event === 'host.exit' && !row.normal;

function atomicWrite(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(data) + '\n'); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path);
    // POSIX directory sync makes the rename durable; Windows does not expose directory fsync.
    try { const dir = openSync(join(path, '..'), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } } catch { /* File was flushed before atomic rename. */ }
    return true;
  } catch { return false; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} try { unlinkSync(temporary); } catch {} }
}

function crashDumps(directory, current) {
  const found = [];
  function visit(path) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile() && /\.dmp$/i.test(item.name)) {
        const stat = statSync(file);
        found.push({ file, name: item.name, size: stat.size, at: stat.mtime.toISOString() });
      }
    }
  }
  try { if (!lstatSync(directory).isSymbolicLink()) visit(directory); } catch { /* Missing/unreadable local dumps are optional. */ }
  found.sort((a, b) => b.at.localeCompare(a.at));
  let bytes = 0, count = 0;
  const kept = [];
  for (const item of found) {
    if (Date.parse(item.at) < current.getTime() - 7 * dayMs || count >= 5 || bytes + item.size > 100 * 1024 * 1024) {
      try { unlinkSync(item.file); } catch {} continue;
    }
    count++; bytes += item.size;
    if (uuid.test(item.name.slice(0, -4))) kept.push({ name: item.name, size: item.size, at: item.at });
  }
  return kept;
}

export function createHostDiagnostics(root, { version = 'unknown', appRoot, now = () => new Date() } = {}) {
  const runId = randomUUID();
  const log = createHostLog(root, { now, appRoot, version, runId });
  const marker = join(log.directory, 'current-run.json');
  const crashDirectory = join(root, 'Crashpad');
  let startedAt = null, previous = null, failed = false, begun = false, exited = false;
  let rows = [], recent = [], dumps = [];
  function readRows() {
    const result = [];
    const legacyIndices = new Map();
    for (const name of readdirSync(log.directory).filter(name => hostName.test(name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
      for (const line of readFileSync(join(log.directory, name), 'utf8').split('\n')) {
        try {
          const row = JSON.parse(line);
          if (iso(row.at) && /^[a-z][a-z0-9._-]{0,80}$/.test(row.event) && uuid.test(row.runId)) {
            // Old runs have no sequence. Assign one in file order so same-second
            // legacy failures survive the transition to the shared schema.
            if (!Number.isSafeInteger(row.recordIndex) || row.recordIndex < 1) row.recordIndex = (legacyIndices.get(row.runId) ?? 0) + 1;
            legacyIndices.set(row.runId, Math.max(legacyIndices.get(row.runId) ?? 0, row.recordIndex));
            result.push(row);
          }
        } catch { /* Truncated final line after power loss. */ }
      }
    }
    return result;
  }
  function remember(row) {
    if (!row) { failed = true; return null; }
    // Ordinary metadata must not accumulate in memory while the installed app
    // stays open for weeks. Only seven-day anomalies are needed for the summary.
    if (isAnomaly(row)) {
      recent = recent.filter(item => Date.parse(item.at) >= now().getTime() - 7 * dayMs);
      recent.push(row);
    }
    return row;
  }
  // Detached single-instance start/exit records may be written without owning the marker.
  function write(event, data = {}) { return remember(log.write(event, { ...data, runId })); }
  function begin(metadata = {}) {
    if (begun) return previous;
    begun = true; startedAt = now().toISOString();
    try {
      mkdirSync(log.directory, { recursive: true });
      rows = readRows();
      recent = rows.filter(isAnomaly);
      dumps = crashDumps(crashDirectory, now());
      let mark;
      try { mark = JSON.parse(readFileSync(marker, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') failed = true; }
      if (mark && uuid.test(mark.runId) && iso(mark.startedAt)) {
        const priorRows = rows.filter(row => row.runId === mark.runId);
        const last = priorRows.at(-1);
        // Retention can remove JSONL while the last exited marker still exists.
        // Its fsynced exit metadata must not become a false crash after a long gap.
        const exit = priorRows.findLast(row => row.event === 'host.exit') ??
          (mark.state === 'exited' && iso(mark.at) ? mark : null);
        const normal = Boolean(exit?.normal);
        const interruptedReason = priorRows.some(row => row.event === 'host.session_end' && row.reason === 'system-shutdown') ? 'system-shutdown' : 'unknown';
        const matchingDumps = dumps.filter(item => item.at >= mark.startedAt && item.at <= startedAt);
        previous = { runId: mark.runId, startedAt: mark.startedAt, at: exit?.at ?? last?.at ?? mark.startedAt,
          reason: exit && reasons.has(exit.reason) ? exit.reason : interruptedReason, normal,
          exitCode: Number.isFinite(exit?.exitCode) ? exit.exitCode : null,
          lastAt: last?.at ?? exit?.at ?? mark.startedAt, lastEvent: last?.event ?? (exit ? 'host.exit' : 'host.start'), dumps: matchingDumps,
          dumpMatch: 'time-window-inference' };
        // The durable exit log is authoritative if power fails between log fsync and marker update.
        if (!exit) remember(log.previousUnclean({ runId, previousRunId: previous.runId, startedAt: previous.startedAt,
          lastAt: previous.lastAt, lastEvent: previous.lastEvent, reason: interruptedReason, dumpCount: matchingDumps.length,
          dumpBytes: matchingDumps.reduce((sum, item) => sum + item.size, 0) }, matchingDumps));
      } else if (mark) failed = true;
      if (!atomicWrite(marker, { runId, startedAt, state: 'running' })) failed = true;
    } catch { failed = true; }
    write('host.start', { ...metadata, version, startedAt });
    rows = [];
    return previous;
  }
  function failure(source, error) {
    try { return begun ? remember(log.failure(source, error, { runId })) : null; } catch { failed = true; return null; }
  }
  function step(name, status, durationMs) { return write('host.shutdown_step', { step: name, status, durationMs: Math.max(0, durationMs) }); }
  function exit(reason, exitCode = 0, { cleanupComplete = true, shutdownDurationMs } = {}) {
    if (!begun || exited) return null;
    exited = true;
    const canonicalReason = reasons.has(reason) ? reason : 'unknown';
    const normal = exitCode === 0 && cleanupComplete && canonicalReason !== 'startup-failure';
    const row = write('host.exit', { reason: canonicalReason, exitCode, normal, cleanupComplete, shutdownDurationMs,
      durationMs: Math.max(0, now().getTime() - Date.parse(startedAt)) });
    // Never mark clean if the exit record could not be written.
    if (row && !atomicWrite(marker, { runId, startedAt, state: 'exited', at: row.at,
      reason: canonicalReason, exitCode, normal, cleanupComplete })) failed = true;
    return row;
  }
  function status() {
    const generatedAt = now().toISOString();
    const cutoff = Date.parse(generatedAt) - 7 * dayMs;
    const seen = new Set();
    const sevenDayAnomalies = recent.filter(row => {
      if (Date.parse(row.at) < cutoff) return false;
      const key = `${row.runId}:${row.recordIndex}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    const anomalies = sevenDayAnomalies.slice(-20);
    const uncleanCount7Days = new Set(sevenDayAnomalies.filter(row =>
      (row.event === 'host.previous_unclean_exit' || row.event === 'host.exit' && !row.normal))
      .map(row => row.previousRunId ?? row.runId)).size;
    // Only the same strict metadata/error projection produced by this module is copied.
    const safe = anomalies.map(row => {
      const result = { at: row.at, event: row.event, runId: row.runId, recordIndex: row.recordIndex };
      for (const key of ['exitCode', 'durationMs', 'shutdownDurationMs', 'dumpCount', 'dumpBytes']) if (Number.isFinite(row[key])) result[key] = row[key];
      for (const key of ['normal', 'cleanupComplete']) if (typeof row[key] === 'boolean') result[key] = row[key];
      if (['SIGTERM','SIGINT','SIGKILL','SIGHUP','SIGABRT','SIGSEGV','SIGBREAK','SIGQUIT'].includes(row.signal)) result.signal=row.signal;
      for (const [key, allowed] of Object.entries(summaryEnums)) if (allowed.has(row[key])) result[key] = row[key];
      if (uuid.test(row.previousRunId)) result.previousRunId = row.previousRunId;
      if (row.event === 'host.failure') {
        // Re-sanitize persisted message/name/code and exclude all untrusted free text.
        Object.assign(result, log.sanitizeError({ name: row.name, code: row.code, message: row.message,
          stack: ['Error', ...(Array.isArray(row.stackFrames) ? row.stackFrames.slice(0, 8).map(frame => `    at ${frame}`) : [])].join('\n') }));
      }
      const { at, event, runId, ...fields } = result;
      // Apple uses a metadata envelope and a string-valued whitelist dictionary.
      // Keep stack locations as individually addressable safe fields as well.
      const projectedFields = {};
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'stackFrames') value.forEach((frame, index) => { projectedFields[`stackFrame${index + 1}`] = frame; });
        else projectedFields[key] = String(value);
      }
      return { at, event, runId, platform: diagnosticPlatform,
        appVersion: diagnosticAppVersion(row.appVersion ?? row.version),
        osVersion: typeof row.osVersion === 'string' && /^[0-9][0-9A-Za-z.+_-]{0,79}$/.test(row.osVersion) ? row.osVersion : 'unknown',
        fields: projectedFields };
    });
    const abnormalCountsLast7Days = {};
    for (const row of sevenDayAnomalies) abnormalCountsLast7Days[row.event] = (abnormalCountsLast7Days[row.event] ?? 0) + 1;
    const lastReason = previous?.normal && previous.reason === 'unknown' ? '退出原因未记录' : reasonText[previous?.reason];
    const summary = JSON.stringify({ platform: diagnosticPlatform, appVersion: diagnosticAppVersion(version), osVersion: diagnosticOsVersion,
      generatedAt, recentAbnormalRecords: safe, abnormalCountsLast7Days, retentionPolicy: log.retentionPolicy }, null, 2);
    const summaryPreview = `WeftMate ${diagnosticAppVersion(version)}\n系统：${diagnosticPlatform} ${diagnosticOsVersion}\n本次启动（电脑时间）：${humanDate(startedAt)}\n上次退出：${previous ? (previous.normal ? '正常 · ' : '异常 · ') + lastReason : '暂无记录'}\n最近 7 天异常退出：${uncleanCount7Days}\n运行记录：保留 7 天，总大小上限 32 MiB\n${safe.map(row => `${humanDate(row.at)} · ${row.event}${row.fields.reason ? ` · ${reasonText[row.fields.reason] ?? row.fields.reason}` : ''}${row.fields.code ? ` · ${row.fields.code}` : ''}`).join('\n')}`;
    return { state: failed ? 'error' : 'ready', runId, startedAt, previous, uncleanCount7Days, summary, summaryPreview };
  }
  return { runId, directory: log.directory, crashDirectory, begin, write, failure, step, exit, status };
}

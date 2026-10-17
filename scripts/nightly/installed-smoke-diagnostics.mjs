const CODES = new Set(['PROJECT_READER_TIMEOUT', 'PROJECT_READER_INVALID', 'PROJECT_FILE_UNAVAILABLE',
  'PROJECT_UNSAFE_PATH', 'PROJECT_ROOT_CHANGED', 'PROJECT_FILE_CHANGED', 'PROJECT_INVALID_UTF8',
  'PROJECT_LINE_OUT_OF_RANGE', 'PROJECT_LINE_TOO_LONG', 'PROJECT_NATIVE_SELECTION_REQUIRED', 'PROJECT_UNAVAILABLE']);
const STAGES = new Set(['bootstrap_started', 'utility_imported', 'payload_read', 'compile_started', 'compile_completed', 'ready_emitted']);
const integer = value => Number.isSafeInteger(value) && value >= 0;
/** Original failure stays intact. Only fixed codes, enums and numeric metadata
 * are projected from process stderr; no arbitrary stderr or object is returned. */
export function installedSmokeFailureSummary({ error, failureView, stderr = [], firstWindowDiagnostics }) {
  const errorCodes = new Set(), readerFailures = [];
  for (const line of stderr.join('').split(/\r?\n/)) {
    const native = /handler for 'wm:desktop:project-create': Error: (PROJECT_[A-Z_]+)\b/.exec(line);
    if (native && CODES.has(native[1])) errorCodes.add(native[1]);
    const match = /^Project reader failure: (\{.*\})$/.exec(line);
    if (!match) continue;
    let value; try { value = JSON.parse(match[1]); } catch { continue; }
    if (!CODES.has(value?.code) || !['initialization', 'operation'].includes(value.phase)) continue;
    const row = { code: value.code, phase: value.phase };
    for (const key of ['invocation', 'initializationMs', 'stdoutBytes', 'stderrBytes', 'childElapsedMs', 'observationFailures']) if (integer(value[key])) row[key] = value[key];
    if (value.operationMs === null || integer(value.operationMs)) row.operationMs = value.operationMs;
    for (const key of ['spawnObserved', 'stdinFinished', 'readyObserved']) if (typeof value[key] === 'boolean') row[key] = value[key];
    if (value.lastChildStage === null || STAGES.has(value.lastChildStage)) row.lastChildStage = value.lastChildStage;
    readerFailures.push(row);
  }
  return { error, failureView, ...(firstWindowDiagnostics ? { firstWindowDiagnostics } : {}), ...(errorCodes.size || readerFailures.length ? { nativeProjectDiagnostics: {
    errorCodes: [...errorCodes], readerFailures: readerFailures.slice(-8) } } : {}) };
}

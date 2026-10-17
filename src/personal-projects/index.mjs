import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Electron can read ASAR bytes; system PowerShell cannot open an ASAR path.
// Capture the bundled program once and send it over the private stdin pipe.
// No executable script is extracted to a writable application-data directory.
const SCRIPT = readFileSync(fileURLToPath(new URL('./reader.ps1', import.meta.url))).toString('base64');
// This fixed program only needs Utility. Import it directly instead of making
// its first JSON command discover/prepare the machine's unrelated modules.
const BOOTSTRAP = Buffer.from([
  "$weftmateStageClock=$null; try { $weftmateStageClock=[Diagnostics.Stopwatch]::StartNew() } catch {};",
  "function Write-WeftmateReaderStage { param([string]$stage) try { if ($null -ne $weftmateStageClock) { [Console]::Error.WriteLine('WEFTMATE_PROJECT_READER_STAGE|'+$stage+'|'+$weftmateStageClock.ElapsedMilliseconds); [Console]::Error.Flush() } } catch {} };",
  "Write-WeftmateReaderStage 'bootstrap_started';",
  "Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop;",
  "Write-WeftmateReaderStage 'utility_imported';",
  "[Console]::InputEncoding = [Text.Encoding]::UTF8; $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json; Write-WeftmateReaderStage 'payload_read';",
  "& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.script)))) -RequestJson $payload.request -ReportReady -DiagnosticStage ${function:Write-WeftmateReaderStage}",
].join(' '), 'utf16le').toString('base64');
const POWERSHELL = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const QUERY_BYTES = 200;
// macOS source development uses the existing developer-tools Python (stdlib
// only). openat + O_NOFOLLOW keeps every directory/file tied to its handle.
const MAC_READER = process.platform === 'darwin'
  ? readFileSync(fileURLToPath(new URL('./reader-posix.py', import.meta.url)), 'utf8') : null;

function issue(code) {
  return Object.assign(new Error(code), { code });
}

function validRootPath(value) {
  return typeof value === 'string' && value.length <= 240 && /^[A-Za-z]:\\/.test(value) &&
    path.win32.isAbsolute(value) && !value.includes('\0') && !/[\\/]$/.test(value) &&
    !value.includes('\\\\') && !value.includes('/');
}

function validQuery(value) {
  return value === undefined || typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= QUERY_BYTES && !/[\p{Cc}\p{Cf}]/u.test(value);
}

async function invoke(input) {
  if (process.platform === 'darwin') return invokeMacReader(input);
if (process.platform !== 'win32') throw issue('PROJECT_WINDOWS_REQUIRED');
  return invokeProjectReader(input);
}

// The one-shot reader compiles its immutable native handle checks before it
// touches the project. Give initialization and the actual operation their own
// bounded phase; neither phase retries nor changes file/security limits.
const CHILD_STAGES = new Set(['bootstrap_started', 'utility_imported', 'payload_read', 'compile_started', 'compile_completed', 'ready_emitted']);
const SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'SIGBREAK', 'SIGHUP', 'SIGQUIT']);
let nextInvocation = 0;
export function invokeProjectReader(input, { spawnProcess = spawn, setTimer = setTimeout, clearTimer = clearTimeout,
  now = () => performance.now(), observe = event => console.info('Project reader observation:', JSON.stringify(event)) } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', BOOTSTRAP], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    let done = false, readyAt, phase = 'initialization';
    const startedAt = now();
    const invocation = ++nextInvocation;
    let observationFailures = 0, spawnObserved = false, stdinFinished = false, lastChildStage = null, childElapsedMs = null;
    let diagnosticLine = '', droppingLine = false;
    const elapsed = () => Math.max(0, Math.floor(now() - startedAt));
    const publish = (source, stage, fields = {}) => {
      try {
        const result = observe({ invocation, source, stage, parentElapsedMs: elapsed(), ...fields });
        if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => { observationFailures++; });
      } catch { observationFailures++; }
    };
    const stop = reason => {
      let returned = false, killed = false;
      try { killed = child.kill() === true; returned = true; }
      finally { publish('parent', 'kill_requested', { reason, returned, killed }); }
    };
    const childDiagnostic = line => {
      const match = /^WEFTMATE_PROJECT_READER_STAGE\|([a-z_]+)\|(\d+)$/.exec(line.trim());
      if (!match || !CHILD_STAGES.has(match[1]) || !Number.isSafeInteger(Number(match[2]))) return;
      lastChildStage = match[1]; childElapsedMs = Number(match[2]);
      // Child Stopwatch and parent monotonic time have separate origins.
      publish('child', lastChildStage, { childElapsedMs });
    };
    const expire = () => { stop('timeout'); finish(issue('PROJECT_READER_TIMEOUT')); };
    let timer = setTimer(expire, 30_000);
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimer(timer);
      if (error) {
        const readerEvidence={invocation,phase,initializationMs:Math.max(0,Math.floor((readyAt ?? now())-startedAt)),
          operationMs:readyAt === undefined ? null : Math.max(0,Math.floor(now()-readyAt)),stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr),
          spawnObserved,stdinFinished,readyObserved:readyAt!==undefined,lastChildStage,childElapsedMs,observationFailures};
        // Metadata only: no project paths, source text or credentials in logs.
        try { console.warn('Project reader failure:',JSON.stringify({code:error.code,...readerEvidence})); }
        catch { readerEvidence.observationFailures=++observationFailures; }
        reject(Object.assign(error,{readerEvidence}));
      }
      else resolve(result);
    }
    child.on('spawn', () => { spawnObserved = true; publish('parent', 'spawn_observed'); });
    child.stdin.on('finish', () => { stdinFinished = true; publish('parent', 'stdin_finished'); });
    child.on('error', () => finish(issue('PROJECT_FILE_UNAVAILABLE')));
    child.stdin.on('error', () => finish(issue('PROJECT_FILE_UNAVAILABLE')));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (phase === 'initialization' && stdout.includes('\n')) {
        const newline = stdout.indexOf('\n');
        if (stdout.slice(0, newline).trim() !== 'WEFTMATE_PROJECT_READER_READY') { stop('invalid_output'); finish(issue('PROJECT_READER_INVALID')); return; }
        stdout = stdout.slice(newline + 1); readyAt = now(); phase = 'operation';
        clearTimer(timer); timer = setTimer(expire, 15_000);
        publish('parent', 'ready_observed');
      }
      if (Buffer.byteLength(stdout, 'utf8') > 256 * 1024) { stop('invalid_output'); finish(issue('PROJECT_READER_INVALID')); }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 4_096) stderr = stderr.slice(0, 4_096);
      for (const character of chunk) {
        if (character === '\n') {
          if (!droppingLine) childDiagnostic(diagnosticLine);
          diagnosticLine = ''; droppingLine = false;
        } else if (!droppingLine) {
          diagnosticLine += character;
          if (diagnosticLine.length > 256) { diagnosticLine = ''; droppingLine = true; }
        }
      }
    });
    child.on('close', (code, signal) => {
      publish('parent', 'close_observed', { exitCode: Number.isInteger(code) ? code : null, signal: SIGNALS.has(signal) ? signal : null });
      if (code !== 0) return finish(issue('PROJECT_FILE_UNAVAILABLE'));
      if (phase !== 'operation') return finish(issue('PROJECT_READER_INVALID'));
      let value;
      try { value = JSON.parse(stdout.trim()); }
      catch { return finish(issue('PROJECT_READER_INVALID')); }
      if (value?.ok !== true) {
        return finish(issue(/^PROJECT_[A-Z0-9_]+$/.test(value?.code ?? '')
        ? value.code : 'PROJECT_FILE_UNAVAILABLE'));
      }
      finish(null, value.value);
    });
    child.stdin.end(JSON.stringify({script:SCRIPT,request:JSON.stringify(input)}));
  });
}

async function invokeMacReader(input) {
  if (!['win32', 'darwin'].includes(process.platform)) throw issue('PROJECT_WINDOWS_REQUIRED');
  return new Promise((resolve, reject) => {
    const mac = process.platform === 'darwin';
    const child = spawn(mac ? '/usr/bin/python3' : POWERSHELL, mac ? ['-I', '-c', MAC_READER] : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', BOOTSTRAP], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    let done = false;
    const timer = setTimeout(() => { child.kill(); finish(issue('PROJECT_READER_TIMEOUT')); }, 15_000);
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }
    child.on('error', () => finish(issue('PROJECT_FILE_UNAVAILABLE')));
    child.stdin.on('error', () => finish(issue('PROJECT_FILE_UNAVAILABLE')));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') > 256 * 1024) { child.kill(); finish(issue('PROJECT_READER_INVALID')); }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 4_096) stderr = stderr.slice(0, 4_096);
    });
    child.on('close', (code) => {
      if (code !== 0) return finish(issue('PROJECT_FILE_UNAVAILABLE'));
      let value;
      try { value = JSON.parse(stdout.trim()); }
      catch { return finish(issue('PROJECT_READER_INVALID')); }
      if (value?.ok !== true) {
        return finish(issue(/^PROJECT_[A-Z0-9_]+$/.test(value?.code ?? '')
        ? value.code : 'PROJECT_FILE_UNAVAILABLE'));
      }
      finish(null, value.value);
    });
    child.stdin.end(mac ? JSON.stringify(input) : JSON.stringify({script:SCRIPT,request:JSON.stringify(input)}));
  });
}

export async function inspectProjectRoot(rootPath) {
  const mac = process.platform === 'darwin';
  if (mac ? typeof rootPath !== 'string' || !path.posix.isAbsolute(rootPath) || rootPath.length > 4096 : !validRootPath(rootPath)) throw issue('PROJECT_UNSAFE_PATH');
  const value = await invoke({ action: 'inspect', rootPath });
  if (typeof value?.FinalPath !== 'string' || (mac ? !path.posix.isAbsolute(value.FinalPath) : !/^\\\\\?\\[A-Za-z]:\\/.test(value.FinalPath)) ||
      typeof value.Identity !== 'string' || !/^[A-F0-9]{8}:[A-F0-9]{16}$/.test(value.Identity)) {
    throw issue('PROJECT_READER_INVALID');
  }
  return { rootPath: (mac ? path.posix : path.win32).normalize(rootPath), rootFinalPath: value.FinalPath, rootIdentity: value.Identity };
}

export async function listProjectFiles(project, query = '') {
  if (!validQuery(query)) throw issue('INVALID_COMMAND');
  const value = await invoke({ action: 'list', rootPath: project.rootPath,
    expectedFinal: project.rootFinalPath, expectedIdentity: project.rootIdentity, query });
  if (!Array.isArray(value?.Files) || value.Files.length > 100 ||
      !Number.isSafeInteger(value.ScannedCount) || value.ScannedCount < 0 || value.ScannedCount > 2000 ||
      typeof value.Truncated !== 'boolean' || !Number.isSafeInteger(value.SkippedCount) ||
      value.Files.some((file) => typeof file.RelativePath !== 'string' || file.RelativePath.length > 1024 ||
        !Number.isSafeInteger(file.Size) || file.Size < 0 || file.Size > 8 * 1024 * 1024 ||
        !/^[A-F0-9]{8}:[A-F0-9]{16}$/.test(file.Identity ?? '') ||
        !/^\d{1,20}$/.test(file.LastWriteTime ?? ''))) throw issue('PROJECT_READER_INVALID');
  return { files: value.Files.map((file) => ({ relativePath: file.RelativePath, size: file.Size,
    identity: file.Identity, lastWriteTime: file.LastWriteTime })),
    scannedCount: value.ScannedCount, truncated: value.Truncated, skippedCount: value.SkippedCount };
}

export async function readProjectFile(project, file, startLine = 1) {
  if (!Number.isSafeInteger(startLine) || startLine < 1 || startLine > 1_000_000) throw issue('INVALID_COMMAND');
  const value = await invoke({ action: 'read', rootPath: project.rootPath,
    expectedFinal: project.rootFinalPath, expectedIdentity: project.rootIdentity,
    relativePath: file.relativePath, fileIdentity: file.identity,
    expectedSize: file.size, expectedWriteTime: file.lastWriteTime, startLine });
  if (value?.RelativePath !== file.relativePath || value.Identity !== file.identity ||
      value.Size !== file.size || value.LastWriteTime !== file.lastWriteTime ||
      !Number.isSafeInteger(value.LineStart) || value.LineStart !== startLine ||
      !Number.isSafeInteger(value.LineEnd) || value.LineEnd < startLine ||
      !Number.isSafeInteger(value.TotalLines) || value.TotalLines < value.LineEnd ||
      !/^[a-f0-9]{64}$/.test(value.FileSha256 ?? '') || typeof value.Text !== 'string' ||
      Buffer.byteLength(value.Text, 'utf8') > 32 * 1024 || typeof value.HasMore !== 'boolean' ||
      !/^\d{1,20}$/.test(value.LastWriteTime ?? '')) {
    throw issue('PROJECT_READER_INVALID');
  }
  return { relativePath: value.RelativePath, lineStart: value.LineStart, lineEnd: value.LineEnd,
    totalLines: value.TotalLines, fileSha256: value.FileSha256, text: value.Text, hasMore: value.HasMore };
}

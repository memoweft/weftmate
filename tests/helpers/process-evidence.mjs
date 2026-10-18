/** Isolated real-process runner. Evidence is local; native dumps are never copied. */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';

const meanings = new Map([
  [0, '正常退出'], [0xC0000409, '进程调用 abort / 快速失败'],
  [0xC0000005, '访问冲突'], [0xC000012D, '提交内存不足'], [1455, '提交内存不足'],
]);
export function describeExit(code, signal = null) {
  const unsigned = Number.isInteger(code) ? code >>> 0 : null;
  return { decimal: code ?? null, unsignedDecimal: unsigned,
    hexadecimal: unsigned === null ? null : `0x${unsigned.toString(16).toUpperCase().padStart(8, '0')}`,
    signal, meaning: signal ? `被信号 ${signal} 结束` : meanings.get(unsigned) || (unsigned === null ? '未取得退出码' : '非零退出码') };
}
export function redactEvidenceText(text, roots = []) {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const separator = '(?:[\\\\/]|%2f|%5c)+';
  let value = String(text);
  // Match the representation, not just the raw root: TAP/JSON double the
  // backslashes and file URLs percent-encode spaces, colons and separators.
  // Do this before user masking, which otherwise changes an explicit root.
  for (const root of [...roots].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const pattern = [...root].map(char => /[\\/]/.test(char) ? separator :
      `(?:${escape(char)}|${[...Buffer.from(char)].map(byte => '%' + byte.toString(16).padStart(2, '0')).join('')})`).join('');
    value = value.replace(new RegExp(`(?:file:${separator})?${pattern}`, /^[A-Z]:|^\\\\/i.test(root) ? 'gi' : 'g'), '%TEMP%');
  }
  value = value.replace(new RegExp(`([A-Z](?::|%3a)${separator}Users${separator})(?:(?![\\\\/]|%2f|%5c|[\\s"'<>]).)+`, 'gi'), '$1<user>');
  value = value.replace(new RegExp(escape(hostname()), 'gi'), '<host>');
  return value.replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[authorization]')
    .replace(/\b(?:api[_-]?key|token|password|secret|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, '[secret]')
    .replace(/([?&][^=\s]+)=([^\s&#]+)/g, '$1=[redacted]');
}
const powershell = (script, env = {}) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  windowsHide: true, encoding: 'utf8', timeout: 12_000, env: { ...process.env, ...env },
}).trim();
export function systemCommitMemory() {
  if (process.platform !== 'win32') return { available: false, reason: 'Windows commit counters unavailable' };
  try {
    const result = JSON.parse(powershell('$m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; @{limitBytes=[double]$m.CommitLimit; committedBytes=[double]$m.CommittedBytes; availableBytes=([double]$m.CommitLimit-[double]$m.CommittedBytes)} | ConvertTo-Json -Compress'));
    return { available: true, ...result };
  } catch { return { available: false, reason: 'commit counters could not be read' }; }
}

export function matchesOwnedProcess(candidate, { startedAt, executables, commandRoots }) {
  return Number.isFinite(Date.parse(candidate.createdAt)) && Date.parse(candidate.createdAt) >= startedAt
    && executables.some(file => file.toLowerCase() === String(candidate.executable).toLowerCase())
    && commandRoots.some(root => String(candidate.commandLine).toLowerCase().includes(root.toLowerCase()));
}
/** Get-Process supplies creation time/executable; CIM is used only for CommandLine. Recheck all three immediately before stopping. */
export function cleanupOwnedProcesses({ startedAt, executables, commandRoots }) {
  if (process.platform !== 'win32') return { cleaned: 0, available: false, reason: 'Windows cleanup unavailable' };
  if (!commandRoots.length || !executables.length || commandRoots.some(root => !isAbsolute(root))) throw Error('Cleanup requires explicit absolute isolated roots and executables');
  const script = `$spec=ConvertFrom-Json $env:WEFTMATE_PROCESS_EVIDENCE_SPEC; $count=0; $failed=0; Get-Process | ForEach-Object { $owned=$false; try { $p=$_; if ($p.Id -eq $PID) { return }; if ($p.StartTime.ToUniversalTime() -lt [DateTime]::Parse($spec.startedAt).ToUniversalTime()) { return }; if (-not ($spec.executables -contains $p.Path)) { return }; $line=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.Id)).CommandLine; foreach ($root in $spec.commandRoots) { if ($line -and $line.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0) { $owned=$true } }; if ($owned) { $fresh=Get-Process -Id $p.Id -ErrorAction Stop; $freshLine=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$fresh.Id)).CommandLine; if ($fresh.StartTime -eq $p.StartTime -and $fresh.Path -eq $p.Path -and $freshLine -eq $line) { $fresh | Stop-Process -Force -ErrorAction Stop; $count++ } } } catch { if ($owned -and (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { $failed++ } } }; @{cleaned=$count; failed=$failed; available=$true} | ConvertTo-Json -Compress`;
  try { return JSON.parse(powershell(script, { WEFTMATE_PROCESS_EVIDENCE_SPEC: JSON.stringify({ startedAt: new Date(startedAt).toISOString(), executables, commandRoots }) })); }
  catch { return { cleaned: 0, available: false, reason: 'owned-process cleanup could not be completed' }; }
}

export function createProcessEvidence({ outputDir, profileDirectory, commandRoots = [], executables = [], startedAt = Date.now(), tailBytes = 1024 * 1024, memoryReader = systemCommitMemory } = {}) {
  if (!outputDir) throw Error('Process evidence requires a local output directory');
  const output = resolve(outputDir), roots = [...new Set([profileDirectory, ...commandRoots].filter(Boolean).map(file => resolve(file)))];
  const allowed = new Set(executables.map(file => resolve(file)));
  const records = [], tracked = [];
  let failure = false, preservationError = false;
  const redact = text => redactEvidenceText(text, roots);
  const memory = () => { try { return memoryReader(); } catch { return { available: false, reason: 'commit counters could not be read' }; } };
  const save = () => { mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'process-results.json'), JSON.stringify({ localOnly: true, records }, null, 2)); };
  const preserveFailure = () => {
    failure = true;
    try {
      mkdirSync(output, { recursive: true });
      if (profileDirectory && existsSync(join(profileDirectory, 'logs'))) {
        const destination = join(output, 'logs'); mkdirSync(destination, { recursive: true });
        for (const file of readdirSync(join(profileDirectory, 'logs'))) {
          // Only the application's metadata log files. No token stores or arbitrary files.
          if (!/^host-\d{4}-\d{2}-\d{2}(?:[.-]\d+)?\.jsonl$/.test(file)) continue;
          const source = join(profileDirectory, 'logs', file);
          if (statSync(source).isFile()) writeFileSync(join(destination, file), redact(readFileSync(source, 'utf8')));
        }
      }
      const dumps = [];
      const walk = (directory, relativePath = '') => {
        if (!existsSync(directory)) return;
        for (const file of readdirSync(directory, { withFileTypes: true })) {
          if (file.isSymbolicLink()) continue;
          if (file.isDirectory()) walk(join(directory, file.name), join(relativePath, file.name));
          else if (/\.dmp$/i.test(file.name)) { const meta = statSync(join(directory, file.name)); dumps.push({ file: redact(basename(file.name)), bytes: meta.size, modifiedAt: meta.mtime.toISOString() }); }
        }
      };
      for (const directory of ['crashes', 'crash-dumps', 'Crashpad']) if (profileDirectory) walk(join(profileDirectory, directory));
      if (!profileDirectory || existsSync(profileDirectory) || !existsSync(join(output, 'crash-dumps.json')))
        writeFileSync(join(output, 'crash-dumps.json'), JSON.stringify({ localOnly: true, dumps, dumpContentsCopied: false }, null, 2));
      save();
    } catch { preservationError = true; }
    return { preserved: !preservationError, outputDirectory: output };
  };
  const track = (child, { label = 'process', executable } = {}) => {
    if (executable) allowed.add(resolve(executable));
    const stdout = [], stderr = [];
    const collect = (chunks, chunk) => { chunks.push(Buffer.from(chunk)); let bytes = chunks.reduce((sum, item) => sum + item.length, 0); while (bytes > tailBytes && chunks.length) { const first = chunks[0]; const excess = bytes - tailBytes; if (first.length <= excess) { chunks.shift(); bytes -= first.length; } else { chunks[0] = first.subarray(excess); break; } } };
    child.stdout?.on('data', chunk => collect(stdout, chunk)); child.stderr?.on('data', chunk => collect(stderr, chunk));
    let errorCode = null;
    let memoryAtExit = null;
    child.once('exit', () => { memoryAtExit = memory(); });
    child.once('error', error => { errorCode = error.code || 'SPAWN_ERROR'; });
    const done = new Promise(resolveDone => {
      const finish = (code, signal) => {
        const record = { label, ...describeExit(code, signal), spawnErrorCode: errorCode,
          closedAt: new Date().toISOString(), stdoutTail: redact(Buffer.concat(stdout).toString('utf8')),
          stderrTail: redact(Buffer.concat(stderr).toString('utf8')), tailBytes, systemCommit: memoryAtExit || memory() };
        records.push(record);
        if (code !== 0 || signal || errorCode) preserveFailure();
        try { save(); } catch { preservationError = true; }
        resolveDone(record);
      };
      if (child.exitCode !== null || child.signalCode !== null) finish(child.exitCode, child.signalCode);
      else child.once('close', finish);
    });
    const handle = { child, done }; tracked.push(handle); return handle;
  };
  return {
    track, preserveFailure,
    spawn(command, args, options = {}, metadata = {}) { return track(spawn(command, args, { windowsHide: true, ...options, stdio: ['pipe', 'pipe', 'pipe'] }), { ...metadata, executable: isAbsolute(command) ? command : undefined }); },
    runSync(command, args, options = {}, { label = 'process' } = {}) {
      const result = spawnSync(command, args, { windowsHide: true, ...options, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      const record = { label, ...describeExit(result.status, result.signal), spawnErrorCode: result.error?.code || null,
        stdoutTail: redact(Buffer.from(result.stdout || '').subarray(-tailBytes).toString('utf8')), stderrTail: redact(Buffer.from(result.stderr || '').subarray(-tailBytes).toString('utf8')), tailBytes, systemCommit: memory() };
      records.push(record); if (result.status !== 0 || result.error || result.signal) preserveFailure();
      try { save(); } catch { preservationError = true; }
      return result;
    },
    recordLaunchFailure(error, label = 'electron-launch') {
      // Playwright exposes its initial child's output and termination in the launch error,
      // before it can return an ElectronApplication that callers can track.
      const text = String(error?.stack || error), match = /exitCode=(-?\d+)/.exec(text), signal = /signal=(SIG[A-Z0-9]+)/.exec(text)?.[1] || null;
      const record = { label, ...describeExit(match ? Number(match[1]) : null, signal), spawnErrorCode: error?.code || 'LAUNCH_FAILED',
        closedAt: new Date().toISOString(), stdoutTail: '', stderrTail: redact(text.slice(-tailBytes)), tailBytes, systemCommit: memory() };
      records.push(record); preserveFailure(); return record;
    },
    async finalize({ failed = false } = {}) {
      if (failed || failure) preserveFailure();
      const cleanup = cleanupOwnedProcesses({ startedAt, executables: [...allowed], commandRoots: roots });
      // Wait for tracked parents after cleaning their owned process tree. A failure to close retains the profile at the call site.
      await Promise.race([Promise.all(tracked.map(item => item.done)), new Promise(r => { const timer = setTimeout(r, 2000); timer.unref(); })]);
      if (failed || failure) preserveFailure();
      try { save(); writeFileSync(join(output, 'cleanup.json'), JSON.stringify(cleanup, null, 2)); } catch { preservationError = true; }
      return { ...cleanup, preservationError, stillRunning: tracked.some(({ child }) => child.exitCode === null && child.signalCode === null)
        || (process.platform === 'win32' && (!cleanup.available || cleanup.failed > 0)) };
    },
    get records() { return records; },
  };
}

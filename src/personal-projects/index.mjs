import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Electron can read ASAR bytes; system PowerShell cannot open an ASAR path.
// Capture the bundled program once and send it over the private stdin pipe.
// No executable script is extracted to a writable application-data directory.
const SCRIPT = readFileSync(fileURLToPath(new URL('./reader.ps1', import.meta.url))).toString('base64');
const BOOTSTRAP = Buffer.from("[Console]::InputEncoding = [Text.Encoding]::UTF8; $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json; & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.script)))) -RequestJson $payload.request", 'utf16le').toString('base64');
const POWERSHELL = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const QUERY_BYTES = 200;

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
  if (process.platform !== 'win32') throw issue('PROJECT_WINDOWS_REQUIRED');
  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', BOOTSTRAP], {
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
    child.stdin.end(JSON.stringify({script:SCRIPT,request:JSON.stringify(input)}));
  });
}

export async function inspectProjectRoot(rootPath) {
  if (!validRootPath(rootPath)) throw issue('PROJECT_UNSAFE_PATH');
  const value = await invoke({ action: 'inspect', rootPath });
  if (typeof value?.FinalPath !== 'string' || !/^\\\\\?\\[A-Za-z]:\\/.test(value.FinalPath) ||
      typeof value.Identity !== 'string' || !/^[A-F0-9]{8}:[A-F0-9]{16}$/.test(value.Identity)) {
    throw issue('PROJECT_READER_INVALID');
  }
  return { rootPath: path.win32.normalize(rootPath), rootFinalPath: value.FinalPath, rootIdentity: value.Identity };
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

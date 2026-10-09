import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, open, realpath, rename } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
function Test-PrivateAcl($candidate, $sid, $kind, $inheritance) {
  if (-not $candidate.AreAccessRulesProtected) { return $false }
  $rules = @($candidate.Access)
  if ($rules.Count -ne 1) { return $false }
  $rule = $rules[0]
  $ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($ruleSid -ne $sid.Value -or
      $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
      (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne
        [System.Security.AccessControl.FileSystemRights]::FullControl)) { return $false }
  if ($kind -eq 'directory') {
    return (($rule.InheritanceFlags -band $inheritance) -eq $inheritance)
  }
  return ($rule.InheritanceFlags -eq [System.Security.AccessControl.InheritanceFlags]::None)
}
try {
  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
  $target = $env:WEFTMATE_PRIVATE_ACL_TARGET
  $kind = $env:WEFTMATE_PRIVATE_ACL_KIND
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $sid) { throw 'missing user SID' }
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  if ($kind -eq 'directory') {
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  }
  $acl = Get-Acl -LiteralPath $target
  if (-not (Test-PrivateAcl $acl $sid $kind $inheritance)) {
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($entry in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($entry) }
    $allow = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($allow)
    Set-Acl -LiteralPath $target -AclObject $acl
  }
  $verified = Get-Acl -LiteralPath $target
  if (-not (Test-PrivateAcl $verified $sid $kind $inheritance)) { throw 'ACL verification failed' }
} catch { exit 3 }
`;

function privateFailure() {
  const error = new Error('private storage permission verification failed');
  error.code = 'PRIVATE_STORAGE_UNAVAILABLE';
  return error;
}

function absolutePath(target) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw privateFailure();
  const resolved = path.resolve(target);
  if (process.platform === 'win32' && !/^[A-Za-z]:\\/.test(resolved)) throw privateFailure();
  return resolved;
}

async function inspectComponents(target, create) {
  const parsed = path.parse(target);
  let cursor = parsed.root;
  for (const component of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    let current;
    try { current = await lstat(cursor); }
    catch (error) {
      if (error?.code !== 'ENOENT' || !create) throw error;
      await mkdir(cursor, { mode: 0o700 });
      current = await lstat(cursor);
    }
    if (current.isSymbolicLink() || !current.isDirectory()) throw privateFailure();
  }
  const actual = await realpath(target);
  const normalize = (value) => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
  if (normalize(actual) !== normalize(target)) throw privateFailure();
}

const runFile = promisify(execFile);
const protectedPaths = new Map();
const protecting = new Map();
const identity = info => `${info.dev}:${info.ino}:${info.birthtimeMs}`;

async function protectWindows(target, kind) {
  const key = `${kind}:${target}`;
  if (protectedPaths.get(key) === identity(await lstat(target))) return;
  if (protecting.has(key)) return protecting.get(key);
  const work = (async () => {
    try {
      const systemPowerShell = path.join(process.env.SystemRoot ?? 'C:\\Windows',
        'System32', 'WindowsPowerShell', 'v1.0');
      await runFile(path.join(systemPowerShell, 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_ACL_SCRIPT], {
        env: { ...process.env,
          PSModulePath: path.join(systemPowerShell, 'Modules'),
          WEFTMATE_PRIVATE_ACL_TARGET: target, WEFTMATE_PRIVATE_ACL_KIND: kind },
        windowsHide: true,
        timeout: 15_000,
      });
      protectedPaths.set(key, identity(await lstat(target)));
    } catch { throw privateFailure(); }
  })().finally(() => protecting.delete(key));
  protecting.set(key, work);
  return work;
}

/** Protect only this directory, never its parent or existing descendants. */
export async function ensurePrivateDirectory(target) {
  const resolved = absolutePath(target);
  try {
    await inspectComponents(resolved, true);
    if (process.platform === 'win32') await protectWindows(resolved, 'directory');
    else {
      await chmod(resolved, 0o700);
      if (((await lstat(resolved)).mode & 0o777) !== 0o700) throw privateFailure();
    }
    await inspectComponents(resolved, false);
    return resolved;
  } catch { throw privateFailure(); }
}

/** Tighten and verify an existing regular file before it is read or disclosed. */
export async function ensurePrivateFile(target) {
  const resolved = absolutePath(target);
  try {
    await inspectComponents(path.dirname(resolved), false);
    const info = await lstat(resolved);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw privateFailure();
    const actual = await realpath(resolved);
    const normalize = (value) => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
    if (normalize(actual) !== normalize(resolved)) throw privateFailure();
    if (process.platform === 'win32') await protectWindows(resolved, 'file');
    else {
      await chmod(resolved, 0o600);
      if (((await lstat(resolved)).mode & 0o777) !== 0o600) throw privateFailure();
    }
    return resolved;
  } catch (error) {
    if (error?.code === 'ENOENT') throw error;
    throw privateFailure();
  }
}

/** Exclusive creation in a protected directory: Windows inherits its user-only ACL.
 * Existing files still go through ensurePrivateFile's asynchronous ACL migration.
 */
export async function openPrivateFile(target) {
  const resolved = absolutePath(target);
  await ensurePrivateDirectory(path.dirname(resolved));
  const handle = await open(resolved, 'wx', 0o600);
  if (process.platform === 'win32') protectedPaths.set(`file:${resolved}`, identity(await handle.stat()));
  return handle;
}

/** Atomic replacement preserves the verified file identity and inherited ACL. */
export async function renamePrivateFile(source, target) {
  const from = absolutePath(source), to = absolutePath(target);
  if (path.dirname(from) !== path.dirname(to)) throw privateFailure();
  await ensurePrivateFile(from);
  const verified = protectedPaths.get(`file:${from}`);
  await rename(from, to);
  protectedPaths.delete(`file:${from}`);
  if (verified !== undefined) protectedPaths.set(`file:${to}`, verified);
}

export function forgetPrivateFile(target) {
  protectedPaths.delete(`file:${absolutePath(target)}`);
}

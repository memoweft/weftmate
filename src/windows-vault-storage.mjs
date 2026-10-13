import { readFileSync, writeFileSync, renameSync, rmSync, openSync, fsyncSync, closeSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createDecipheriv } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const failure = () => Object.assign(new Error('本机加密存储尚未准备好，请稍后重新保存密钥。'), { code: 'CREDENTIAL_STORAGE_NOT_READY' });
export function durableReplace(file, bytes) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx', flush: true });
    renameSync(temporary, file);
  } catch (error) { try { rmSync(temporary, { force: true }); } catch {} throw error; }
}
/** Only our abandoned ciphertext temporaries, never another module's files. */
export function cleanupVaultTemporaries(directory, now = Date.now()) {
  let names; try { names = readdirSync(directory); } catch { return; }
  for (const name of names) {
    if (!/^weftmate-model\.enc\.\d+\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/.test(name)) continue;
    const file = join(directory, name);
    try { const info = lstatSync(file); if (info.isFile() && now - info.mtimeMs > 3600000) rmSync(file); } catch {}
  }
}
/** Authenticate an in-memory safeStorage probe with the persisted master key.
 * DPAPI unwrapping is process-local: stdin/stdout pipes only, no key arguments,
 * environment, files, logs, or raw child errors. Nothing encrypts via this seam. */
function persistedKeyMatches(wrappedKey, probe, timeoutMs) {
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $k=[Security.Cryptography.ProtectedData]::Unprotect($b[5..($b.Length-1)],$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); $o=[Console]::OpenStandardOutput(); $o.Write($k,0,$k.Length); [Array]::Clear($k,0,$k.Length)";
  const result = spawnSync(join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-Command',script], { windowsHide:true, input:wrappedKey, encoding:null, timeout:timeoutMs, maxBuffer:8192 });
  try {
    if (result.status !== 0 || result.stdout?.length !== 32 || probe.subarray(0,3).toString() !== 'v10') return false;
    const decipher=createDecipheriv('aes-256-gcm',result.stdout,probe.subarray(3,15));
    decipher.setAuthTag(probe.subarray(-16));
    const plain=Buffer.concat([decipher.update(probe.subarray(15,-16)),decipher.final()]);
    const matches=plain.toString() === 'weftmate-storage-persistence-check'; plain.fill(0); return matches;
  } catch { return false; }
  finally { result.stdout?.fill(0); result.stderr?.fill(0); }
}
export async function persistedWindowsStorageKey(safeStorage, sessionDirectory, { timeoutMs=15000 }={}) {
  const deadline=Date.now()+timeoutMs;
  let probe;
  try {probe=safeStorage.encryptString('weftmate-storage-persistence-check');} catch {throw failure();}
  try {
  while (Date.now()<deadline) {
    let key;
    try { key=JSON.parse(readFileSync(join(sessionDirectory,'Local State'),'utf8')).os_crypt?.encrypted_key; } catch {}
    if (typeof key==='string' && persistedKeyMatches(key,probe,Math.max(1,deadline-Date.now()))) {
      // Only Chromium writes Local State. We authenticate and flush its file;
      // no recovery material or unwrapped master is ever written by this module.
      const fd=openSync(join(sessionDirectory,'Local State'),'r+');
      try {fsyncSync(fd);} finally {closeSync(fd);}
      return;
    }
    if(Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,Math.min(100,deadline-Date.now())));
  }
  throw failure();
  } catch { throw failure(); } finally { probe.fill(0); }
}

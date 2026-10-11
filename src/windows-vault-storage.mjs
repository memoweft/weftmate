import { readFileSync, writeFileSync, renameSync, rmSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createDecipheriv } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const keyFile = directory => join(directory,'weftmate-storage-key.json');
const failure = () => Object.assign(new Error('本机加密存储尚未准备好，请稍后重新保存密钥。'), { code: 'CREDENTIAL_STORAGE_NOT_READY' });
export function durableReplace(file, bytes) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx', flush: true });
    renameSync(temporary, file);
  } catch (error) { try { rmSync(temporary, { force: true }); } catch {} throw error; }
}
export function readWrappedStorageKey(directory) {
  const value=JSON.parse(readFileSync(keyFile(directory),'utf8'));
  if(value.version!==1 || typeof value.wrappedKey!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.wrappedKey)
    || !Buffer.from(value.wrappedKey,'base64').subarray(0,5).equals(Buffer.from('DPAPI'))) throw failure();
  return value.wrappedKey;
}
export function persistWrappedStorageKey(directory,wrappedKey) {
  try { if(readWrappedStorageKey(directory)===wrappedKey) return; } catch {}
  const target=keyFile(directory);
  let previous;
  try {previous=readFileSync(target);} catch(error) {if(error.code!=='ENOENT')throw error;}
  // DPAPI can regenerate a master after a user/context change. Keep the old
  // protected material alongside retained unreadable ciphertext, never erase it.
  if(previous)durableReplace(`${target}.previous-${randomUUID()}`,previous);
  durableReplace(target,Buffer.from(JSON.stringify({version:1,wrappedKey})));
}
/** Before Electron initializes OSCrypt. This protected key is flushed BEFORE
 * any ciphertext commit; raw safeStorage bytes remain readable by old versions. */
export function restoreVaultLocalState(directory, sessionDirectory = directory) {
  if (process.platform !== 'win32') return;
  let wrappedKey; try { wrappedKey=readWrappedStorageKey(directory); } catch { return; }
  const file = join(sessionDirectory,'Local State');
  let state; try { state = JSON.parse(readFileSync(file,'utf8')); } catch { state = {}; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  if (state.os_crypt?.encrypted_key === wrappedKey) return;
  state.os_crypt = { ...state.os_crypt, encrypted_key: wrappedKey };
  durableReplace(file, Buffer.from(JSON.stringify(state)));
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
  while (Date.now()<deadline) {
    let key;
    try { key=JSON.parse(readFileSync(join(sessionDirectory,'Local State'),'utf8')).os_crypt?.encrypted_key; } catch {}
    if (typeof key==='string' && persistedKeyMatches(key,probe,Math.max(1,Math.min(3000,deadline-Date.now())))) {
      // Flush Chromium's already-written file as well, for previous binaries
      // that know only Local State. The recovery key is persisted next.
      const fd=openSync(join(sessionDirectory,'Local State'),'r+');
      try {fsyncSync(fd);} finally {closeSync(fd);}
      return key;
    }
    if(Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,Math.min(100,deadline-Date.now())));
  }
  throw failure();
}

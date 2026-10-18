import { readFileSync, writeFileSync, renameSync, rmSync, openSync, fsyncSync, closeSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createDecipheriv } from 'node:crypto';
import { execFile } from 'node:child_process';

const failure = () => Object.assign(new Error('本机加密存储尚未准备好，请稍后重新保存密钥。'), { code: 'CREDENTIAL_STORAGE_NOT_READY' });
const diagnosticCodes = new Set(['EACCES','EPERM','ENOENT','EIO','EINVAL','ENOSPC','ETIMEDOUT','ENOBUFS','EAGAIN','ENOMEM']);
const diagnosticSignals = new Set(['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGBREAK']);
const bounded = (value, maximum=180000, minimum=0) => typeof value==='number' && Number.isFinite(value)
  ? Math.max(minimum,Math.min(maximum,Math.trunc(value))) : null;
function diagnosticCode(error) { try { const code=error?.code;return diagnosticCodes.has(code) ? code : 'unknown'; } catch { return 'unknown'; } }
const diagnosticNow=()=>{try{return performance.now();}catch{return null;}};
const diagnosticElapsed=started=>{const now=diagnosticNow();return typeof started==='number'&&typeof now==='number'?bounded(now-started):null;};
function emitDiagnostic(observer, state, started) {
  try {
    const result=observer?.(Object.freeze({...state,availabilityChecks:bounded(state.availabilityChecks,100000),proofAttempts:bounded(state.proofAttempts,100000),elapsedMs:diagnosticElapsed(started)}));
    if(result && typeof result.then==='function') void Promise.resolve(result).catch(()=>{});
  } catch { /* Observation never changes readiness or its original failure. */ }
}
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
function startPersistedKeyProof(timeoutMs, diagnostic) {
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $k=[Security.Cryptography.ProtectedData]::Unprotect($b[5..($b.Length-1)],$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); $o=[Console]::OpenStandardOutput(); $o.Write($k,0,$k.Length); [Array]::Clear($k,0,$k.Length)";
  diagnostic.phase='proof-child';diagnostic.proofAttempts++;
  diagnostic.childTimeoutMs=bounded(timeoutMs);diagnostic.authResult='not-attempted';
  const started=diagnosticNow(),expiresAt=Date.now()+timeoutMs;
  let child,finished=false,settle;
  const completion=new Promise(resolve=>{settle=resolve;});
  try {
    child=execFile(join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-NonInteractive','-Command',script], { windowsHide:true, encoding:'buffer', timeout:timeoutMs, maxBuffer:8192 },
      (error,stdout,stderr)=>{
        finished=true;diagnostic.childElapsedMs=diagnosticElapsed(started);
        // execFile reports a timeout as a killed child, without ETIMEDOUT.
        const timedOut=error?.killed && error.signal==='SIGTERM' && Date.now()>=expiresAt;
        const result={status:error?(typeof error.code==='number'?error.code:null):0,signal:error?.signal??null,
          error:timedOut?{code:'ETIMEDOUT'}:error,stdout,stderr};
        recordProofResult(result,diagnostic);settle(result);
      });
    // A deadline/early exit may close stdin before Local State becomes visible.
    child.stdin.on('error',()=>{});
  } catch(error) {diagnostic.childError=diagnosticCode(error);throw error;}
  return {
    async matches(wrappedKey,probe) {
      diagnostic.phase='proof-child';
      if(!finished)child.stdin.end(wrappedKey);
      const result=await completion;
      return persistedKeyMatches(result,probe,diagnostic);
    },
    async dispose() {
      if(!finished)child.kill();
      const result=await completion;
      result.stdout?.fill(0);result.stderr?.fill(0);
    }
  };
}
function recordProofResult(result,diagnostic) {
  // Only status and lengths are observed. Child buffers never enter a report.
  try {
    diagnostic.childStatus=bounded(result.status,4294967295,-2147483648);
    const signal=result.signal;
    diagnostic.childSignal=signal===null || signal===undefined ? null : diagnosticSignals.has(signal) ? signal : 'unknown';
    diagnostic.childError=result.error ? diagnosticCode(result.error) : 'none';
    diagnostic.childTimedOut=diagnostic.childError==='ETIMEDOUT';
    diagnostic.childStdoutBytes=bounded(result.stdout?.length,16777216);
    diagnostic.childStderrBytes=bounded(result.stderr?.length,16777216);
  } catch { /* A diagnostic getter cannot change the original proof. */ }
}
function persistedKeyMatches(result,probe,diagnostic) {
  try {
    if (result.status !== 0 || result.stdout?.length !== 32) return false;
    const v10=probe.subarray(0,3).toString() === 'v10';diagnostic.probeVersion=v10?'v10':'other';
    if(!v10)return false;
    diagnostic.phase='proof-auth';
    const decipher=createDecipheriv('aes-256-gcm',result.stdout,probe.subarray(3,15));
    decipher.setAuthTag(probe.subarray(-16));
    const plain=Buffer.concat([decipher.update(probe.subarray(15,-16)),decipher.final()]);
    const matches=plain.toString() === 'weftmate-storage-persistence-check'; plain.fill(0);
    diagnostic.authResult=matches?'matched':'mismatched';return matches;
  } catch { diagnostic.authResult='failed';return false; }
  finally { result.stdout?.fill(0); result.stderr?.fill(0); }
}
export async function persistedWindowsStorageKey(safeStorage, sessionDirectory, { timeoutMs=15000, onDiagnostic }={}) {
  const deadline=Date.now()+timeoutMs;
  const started=diagnosticNow(),diagnostic={version:1,phase:'availability',outcome:'exception',availabilityChecks:0,lastAvailability:null,
    probeCreated:false,probeVersion:'not-checked',localState:'not-read',proofAttempts:0,childStatus:null,childSignal:null,childError:'none',
    childTimedOut:false,childTimeoutMs:null,childElapsedMs:null,childStdoutBytes:null,childStderrBytes:null,authResult:'not-attempted',
    fsyncAttempted:false,fsyncSucceeded:false,closeAttempted:false,closeSucceeded:false,exceptionCode:'none'};
  let probe,proof;
  try {
  while (Date.now()<deadline) {
    // Windows can report unavailable briefly after app.whenReady(). Keep the
    // same readiness budget, and never resolve initialization before the proof.
    diagnostic.exceptionCode='none';
    if (!probe) {
      diagnostic.phase='availability';diagnostic.availabilityChecks++;diagnostic.lastAvailability=null;
      const available=safeStorage.isEncryptionAvailable();diagnostic.lastAvailability=!!available;
      if(available){diagnostic.phase='probe';probe=safeStorage.encryptString('weftmate-storage-persistence-check');diagnostic.probeCreated=true;}
    }
    // Chromium batches Local State writes (about 10s on first run). Bootstrap
    // the SAME proof process while waiting, then supply the persisted key over
    // stdin. Cold PowerShell startup must not be added after that commit delay.
    if(probe && !proof && Date.now()<deadline)proof=startPersistedKeyProof(deadline-Date.now(),diagnostic);
    let key;
    try {
      diagnostic.phase='local-state-read';diagnostic.localState='not-read';
      const content=readFileSync(join(sessionDirectory,'Local State'),'utf8');
      diagnostic.phase='local-state-parse';
      key=JSON.parse(content).os_crypt?.encrypted_key;
      diagnostic.localState=typeof key==='string'?'string-key':key===undefined?'missing-key':'non-string-key';
    } catch(error) {
      diagnostic.localState=diagnostic.phase==='local-state-read'?'read-error':'parse-or-shape-error';
      diagnostic.exceptionCode=diagnosticCode(error);
    }
    if (proof && typeof key==='string') {
      const matches=await proof.matches(key,probe);
      await proof.dispose();proof=null;
      if(matches && Date.now()<deadline) {
        // Only Chromium writes Local State. We authenticate and flush its file;
        // no recovery material or unwrapped master is ever written by this module.
        diagnostic.phase='local-state-open';
        const fd=openSync(join(sessionDirectory,'Local State'),'r+');
        try {diagnostic.phase='local-state-fsync';diagnostic.fsyncAttempted=true;fsyncSync(fd);diagnostic.fsyncSucceeded=true;}
        finally {
          diagnostic.closeAttempted=true;
          try {closeSync(fd);diagnostic.closeSucceeded=true;}
          catch(error){diagnostic.phase='local-state-close';throw error;}
        }
        diagnostic.phase='complete';diagnostic.outcome='ready';
        return;
      }
    }
    if(Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,Math.min(100,deadline-Date.now())));
  }
  diagnostic.outcome='deadline';throw failure();
  } catch(error) {if(diagnostic.outcome!=='deadline')diagnostic.exceptionCode=diagnosticCode(error);throw failure();}
  finally {try{await proof?.dispose();}finally{probe?.fill(0);emitDiagnostic(onDiagnostic,diagnostic,started);}}
}

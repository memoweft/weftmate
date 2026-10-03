import { spawn } from 'node:child_process';
import { join } from 'node:path';

export const stage12SystemModulePath = () => join(process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'Modules');

export const STAGE12_DPAPI_DECODE_SCRIPT = '$cipher = [System.IO.File]::ReadAllText($env:WEFTMATE_STAGE12_MIMO_DPAPI_PATH, [System.Text.Encoding]::UTF8).Trim(); ' +
  "if($cipher.Length -lt 2 -or $cipher.Length % 2 -ne 0 -or $cipher -notmatch '^[0-9A-Fa-f]+$'){exit 2}; " +
  '$bytes = [byte[]]::new($cipher.Length / 2); ' +
  'for($i=0;$i -lt $bytes.Length;$i++){ $bytes[$i] = [Convert]::ToByte($cipher.Substring($i*2,2),16) }; ' +
  'Add-Type -AssemblyName System.Security; ' +
  '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); ' +
  '[Console]::Out.Write([System.Text.Encoding]::Unicode.GetString($plain))';

/** Test-fixture secret pipe: only the current Windows user can decrypt this DPAPI value. */
export async function decryptStage12Dpapi(path) {
  if (process.platform !== 'win32' || typeof path !== 'string' || !path) {
    throw new Error('Private key unavailable.');
  }
  const encoded = Buffer.from(STAGE12_DPAPI_DECODE_SCRIPT, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, PSModulePath: stage12SystemModulePath(),
      WEFTMATE_STAGE12_MIMO_DPAPI_PATH: path },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let secret = '';
  for await (const part of child.stdout) {
    secret += String(part);
    if (secret.length > 4096) { child.kill(); throw new Error('Private key unavailable.'); }
  }
  const code = await exited;
  if (code !== 0 || !secret.trim() || /[\r\n]/.test(secret)) throw new Error('Private key unavailable.');
  return secret;
}

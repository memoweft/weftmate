import { randomBytes, timingSafeEqual } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Harden an empty file before writing a secret, including on Windows where mode is insufficient.
export async function writePrivateSession(file, value) {
  const temporary = file + '.' + randomBytes(12).toString('hex') + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
        $ErrorActionPreference='Stop'
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl=[Security.AccessControl.FileSecurity]::new()
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true,$false)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'))
        [IO.File]::SetAccessControl($env:ACCEPTANCE_PRIVATE_SESSION,$acl)
      `], { env: { ...process.env, ACCEPTANCE_PRIVATE_SESSION: temporary }, windowsHide: true, stdio: 'pipe', timeout: 10000 });
    }
    await handle.writeFile(JSON.stringify(value));
    await handle.close();
    await rename(temporary, file);
  } finally {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function createControlAccess() {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from('Bearer ' + token);
  return {
    token,
    authorize(request, response) {
      // Reject even an empty Origin header before reading any script or credential body.
      if (Object.hasOwn(request.headers, 'origin')) {
        response.writeHead(403).end(); return false;
      }
      const actual = Buffer.from(request.headers.authorization ?? '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        response.writeHead(401).end(); return false;
      }
      return true;
    },
    publish(file, metadata) { return writePrivateSession(file, { ...metadata, controlToken: token }); }
  };
}

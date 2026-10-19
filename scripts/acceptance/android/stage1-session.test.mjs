import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, unlink, rmdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('stage1 controller protects the session token and rejects unauthorized script execution', { timeout: 25000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stage1-control-'));
  const file = join(directory, 'cloud-control-phone.json');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./stage1-session.mjs', import.meta.url)), directory, directory, '--phone-only'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.resume();
  try {
    let session;
    for (let i = 0; i < 120; i++) {
      session = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
      if (session) break;
      if (child.exitCode !== null) throw Error('ControllerExitedDuringStartup');
      await new Promise(r => setTimeout(r, 75));
    }
    assert.ok(session, 'session was published');
    let token = session.controlToken;
    if (process.platform === 'win32') {
      assert.equal(token, undefined, 'no plaintext token on disk');
      assert.ok(session.controlTokenProtected);
      const decrypted = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
        $ErrorActionPreference='Stop'
        Add-Type -AssemblyName System.Security
        $bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:STAGE1_TEST_ENVELOPE),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        [Console]::Write([Text.Encoding]::UTF8.GetString($bytes))
      `], { env: { ...process.env, STAGE1_TEST_ENVELOPE: session.controlTokenProtected }, encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.equal(decrypted.status, 0); token = decrypted.stdout;
    } else assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.match(token, /^[a-f0-9]{64}$/);
    const send = (body, headers = {}) => fetch('http://127.0.0.1:' + session.controlPort + '/', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000)
    });
    for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
      assert.equal((await send({ op: 'run', script: "await save('unauthorized', 'bad');" }, headers)).status, 401);
      assert.equal((await send({ op: 'run', script: 'invalid syntax !!!' }, headers)).status, 401);
      for (const op of ['email', 'code', 'close']) assert.equal((await send({ op, value: 'synthetic' }, headers)).status, 401);
    }
    const auth = { authorization: 'Bearer ' + token };
    for (const origin of ['', 'null', 'https://example.invalid']) {
      assert.equal((await send({ op: 'run', script: "await save('unauthorized', 'bad');" }, { ...auth, origin })).status, 403);
    }
    await assert.rejects(access(join(directory, 'unauthorized')));
    assert.equal((await (await send({ op: 'run', script: 'return 6 * 7;' }, auth)).json()).result, 42);
    assert.equal(output.includes(token), false, 'no plaintext token in stdout');
    assert.equal((await (await send({ op: 'close' }, auth)).json()).closed, true);
    if (child.exitCode === null) await once(child, 'exit');
  } finally {
    if (child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      else child.kill('SIGKILL');
      if (child.exitCode === null) await once(child, 'exit');
    }
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  }
});

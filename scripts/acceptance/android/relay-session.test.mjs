import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('controller rejects unauthenticated and browser requests before executing or compiling scripts', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acceptance-control-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./relay-session.mjs', import.meta.url)), dir, dir, '--phone-only'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.resume();
  const file = join(dir, 'cloud-control-phone.json');
  try {
    let session;
    for (let i = 0; i < 100; i++) {
      session = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
      if (session) break;
      if (child.exitCode !== null) throw Error('Controller exited during startup');
      await new Promise(r => setTimeout(r, 75));
    }
    assert.ok(session, 'controller published session');
    const send = (body, headers = {}) => fetch('http://127.0.0.1:' + session.controlPort + '/', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000)
    });
    for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
      assert.equal((await send({ op: 'run', script: "await save('unauthorized-executed', 'bad');" }, headers)).status, 401);
      assert.equal((await send({ op: 'run', script: 'invalid syntax !!!' }, headers)).status, 401);
      for (const op of ['email', 'code', 'close']) assert.equal((await send({ op, value: 'synthetic' }, headers)).status, 401);
    }
    assert.match(session.controlToken, /^[a-f0-9]{64}$/);
    const auth = { authorization: 'Bearer ' + session.controlToken };
    for (const origin of ['', 'null', 'https://example.invalid']) {
      assert.equal((await send({ op: 'run', script: "await save('unauthorized-executed', 'bad');" }, { ...auth, origin })).status, 403);
    }
    await assert.rejects(access(join(dir, 'unauthorized-executed')));
    assert.equal((await (await send({ op: 'run', script: 'return 6 * 7;' }, auth)).json()).result, 42);
    assert.equal((await (await send({ op: 'email', value: 'synthetic@example.invalid' }, auth)).json()).emailReady, true);
    assert.equal((await (await send({ op: 'code', value: '123456' }, auth)).json()).codeReady, true);
    if (process.platform === 'win32') {
      const acl = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$a=[IO.File]::GetAccessControl($env:CONTROL_TEST_FILE);$s=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;[Console]::Write(($a.AreAccessRulesProtected -and @($a.Access | Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $s}).Count -eq 0))'],
        { env: { ...process.env, CONTROL_TEST_FILE: file }, encoding: 'utf8', windowsHide: true, timeout: 5000 });
      assert.equal(acl.status, 0); assert.equal(acl.stdout, 'True', 'only current user has file access');
    } else {
      const { stat } = await import('node:fs/promises'); assert.equal((await stat(file)).mode & 0o777, 0o600);
    }
    assert.equal(output.includes(session.controlToken), false, 'token never appears in logs');
    assert.equal((await (await send({ op: 'close' }, auth)).json()).closed, true);
    await once(child, 'exit');
  } finally {
    if (child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      else child.kill('SIGKILL');
      await once(child, 'exit');
    }
    await rm(dir, { recursive: true, force: true });
  }
});

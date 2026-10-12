import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relevantProcesses, recoveryEnvironment } from '../src/personal-update/watchdog-commands.mjs';
const execute = promisify(execFile);
const fixture = gone => `function Get-Process { $p=[pscustomobject]@{ProcessName='WeftMate';Id=19;Gone=$false}; $p | Add-Member -MemberType ScriptProperty -Name HasExited -Value {$this.Gone}; $p | Add-Member -MemberType ScriptProperty -Name Path -Value {${gone ? '$this.Gone=$true;' : ''} return $null}; return $p }; `;
test('recovery does not inherit the old app crash-handler connection', () => {
  const env = { CHROME_CRASHPAD_PIPE_NAME: 'synthetic-pipe', CHROME_CRASHPAD_SERVER_URL: 'synthetic-url', PATH: 'synthetic-path' };
  assert.deepEqual(recoveryEnvironment(env), { PATH: 'synthetic-path', ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(env.CHROME_CRASHPAD_PIPE_NAME, 'synthetic-pipe');
});
test('a process exiting between native enumeration and Path lookup is absent, while an unreadable live process remains unknown', { skip: process.platform !== 'win32' }, async () => {
  const executor = gone => (command, args, options) => execute(command, [...args.slice(0, -1), fixture(gone) + args.at(-1)], options);
  assert.deepEqual(await relevantProcesses(['C:\\synthetic\\WeftMate.exe'], { exec: executor(true) }), []);
  await assert.rejects(relevantProcesses(['C:\\synthetic\\WeftMate.exe'], { exec: executor(false) }), { code: 'SYSTEM_QUERY_FAILED' });
});
test('GUI-launched system queries emit UTF-8 for a live executable in a Chinese path', { skip: process.platform !== 'win32' }, async () => {
  const target = 'C:\\合成目录\\WeftMate.exe';
  const prefix = "[Console]::OutputEncoding=[Text.Encoding]::GetEncoding(936); function Get-Process { [pscustomobject]@{ProcessName='WeftMate';Id=19;HasExited=$false;Path='C:\\合成目录\\WeftMate.exe'} }; ";
  const executor = (command, args, options) => execute(command, [...args.slice(0, -1), prefix + args.at(-1)], options);
  assert.deepEqual(await relevantProcesses([target], { exec: executor }), [{ ProcessId: 19, ExecutablePath: target }]);
});

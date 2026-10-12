import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relevantProcesses } from '../src/personal-update/watchdog-commands.mjs';
const execute = promisify(execFile);
const fixture = gone => `function Get-Process { $p=[pscustomobject]@{ProcessName='WeftMate';Id=19;Gone=$false}; $p | Add-Member -MemberType ScriptProperty -Name HasExited -Value {$this.Gone}; $p | Add-Member -MemberType ScriptProperty -Name Path -Value {${gone ? '$this.Gone=$true;' : ''} return $null}; return $p }; `;
test('a process exiting between native enumeration and Path lookup is absent, while an unreadable live process remains unknown', { skip: process.platform !== 'win32' }, async () => {
  const executor = gone => (command, args, options) => execute(command, [...args.slice(0, -1), fixture(gone) + args.at(-1)], options);
  assert.deepEqual(await relevantProcesses(['C:\\synthetic\\WeftMate.exe'], { exec: executor(true) }), []);
  await assert.rejects(relevantProcesses(['C:\\synthetic\\WeftMate.exe'], { exec: executor(false) }), { code: 'SYSTEM_QUERY_FAILED' });
});

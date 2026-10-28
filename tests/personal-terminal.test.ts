import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createTerminalManager } from '../src/personal-terminal/index.mjs';

const owner = 'synthetic-owner', device = 'synthetic-device';
function waitFor(check: () => boolean, describe: () => string = () => '', timeout = 12000) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const timer = setInterval(() => { if (check()) { clearInterval(timer); resolve(); }
      else if (Date.now() > deadline) { clearInterval(timer); reject(new Error(`terminal condition timed out: ${describe()}`)); } }, 20);
  });
}
const alive = (pid: number) => { try {
  process.kill(pid, 0);
  return process.platform !== 'linux' || !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
} catch { return false; } };

test('real PTY: input, UTF-8, resize, replay cursor, ownership and process-tree disposal', { timeout: 35000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'weftmate-terminal-'));
  const fixture = join(cwd, 'interactive.cjs');
  await writeFile(fixture, `process.env.FORCE_COLOR='1';
const child = require('node:child_process').spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore',windowsHide:true});
process.stdout.write('\\x1b[31mANSI_SENTINEL\\x1b[0m\\r\\n');
// Control records are strings: console's inspection colors must not decorate IDs or sizes.
console.log('READY '+process.pid+' '+child.pid+' '+process.cwd()+' '+process.stdout.isTTY);
process.stdin.setRawMode(true);process.stdin.resume();
process.stdout.on('resize',()=>console.log('SIZE '+process.stdout.columns+' '+process.stdout.rows));
process.stdin.on('data',b=>{const s=b.toString();console.log('INPUT '+s);if(s.includes('later'))setTimeout(()=>console.log('DISCONNECTED_OUTPUT'),100);});`);
  const manager = createTerminalManager({ shell: { file: process.execPath, args: [fixture] } });
  let parent = 0, child = 0;
  try {
    const terminal = await manager.create({ ownerId: owner, deviceId: device, conversationId: 'conversation-a', tabId: 'tab-a', cwd });
    let output = '', seq = 0;
    let stop = manager.subscribe(owner, device, terminal.terminalId, 0, e => { if (e.type === 'output') { output += e.data; seq = e.seq; } });
    await waitFor(() => /READY\s+\d+\s+\d+/.test(output), () => 'PTY readiness ' + JSON.stringify(output.replaceAll(cwd, '<workspace>')));
    const pids = output.match(/READY\s+(\d+)\s+(\d+)/)!; parent = Number(pids[1]); child = Number(pids[2]);
    assert.ok(alive(parent)); assert.ok(alive(child)); assert.match(output, /true/);
    assert.ok(output.includes('ANSI_SENTINEL'));
    assert.match(output, /\x1b\[[0-9;]*m/, 'real terminal output retains ANSI colors');
    assert.equal((await manager.create({ ownerId: owner, deviceId: device, conversationId: 'conversation-a', tabId: 'tab-a', cwd })).terminalId, terminal.terminalId);
    assert.throws(() => manager.info('another-owner', device, terminal.terminalId), /NOT_FOUND/);
    assert.throws(() => manager.input(owner, 'another-device', terminal.terminalId, 'bad'), /NOT_FOUND/);
    manager.input(owner, device, terminal.terminalId, '中文输入');
    await waitFor(() => output.includes('INPUT 中文输入'), () => 'UTF-8 input ' + JSON.stringify(output.replaceAll(cwd, '<workspace>')));
    manager.resize(owner, device, terminal.terminalId, 113, 31);
    await waitFor(() => output.includes('SIZE 113 31'), () => 'PTY resize ' + JSON.stringify(output.replaceAll(cwd, '<workspace>')));
    assert.throws(() => manager.resize(owner, device, terminal.terminalId, 0, 31), /INVALID_REQUEST/);
    manager.input(owner, device, terminal.terminalId, 'later'); stop();
    const cursor = seq; await new Promise(resolve => setTimeout(resolve, 200));
    let replay = ''; const replaySeqs: number[] = [];
    stop = manager.subscribe(owner, device, terminal.terminalId, cursor, e => { if (e.type === 'output') { replay += e.data; replaySeqs.push(e.seq); } });
    await waitFor(() => replay.includes('DISCONNECTED_OUTPUT'), () => 'cursor replay ' + JSON.stringify(replay));
    assert.ok(replaySeqs.every(seq => seq > cursor)); stop();
    await manager.destroy(owner, device, terminal.terminalId);
    await waitFor(() => !alive(parent) && !alive(child), () => `process tree: parent=${alive(parent)} child=${alive(child)}`);
    assert.throws(() => manager.info(owner, device, terminal.terminalId), /NOT_FOUND/);
  } finally {
    await manager.close();
    if (child && alive(child)) process.kill(child);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('real default shell keeps state, handles Chinese and reports exit; host close ends live shells', { timeout: 30000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'weftmate-shell-')), manager = createTerminalManager();
  try {
    const t = await manager.create({ ownerId: owner, deviceId: device, conversationId: 'conversation-b', tabId: 'tab-b', cwd });
    let output = '', exited = false;
    manager.subscribe(owner, device, t.terminalId, 0, e => { if (e.type === 'output') output += e.data; if (e.type === 'exit') exited = true; });
    manager.input(owner, device, t.terminalId, process.platform === 'win32' ? "Write-Output ('中文' + '验证'); (Get-Location).Path\r" : "printf '中文验证\\n'; pwd\n");
    await waitFor(() => output.includes('中文验证') && output.includes(cwd));
    manager.input(owner, device, t.terminalId, process.platform === 'win32' ? 'exit\r' : 'exit\n');
    await waitFor(() => exited);
    assert.equal(manager.info(owner, device, t.terminalId).state, 'exited');
    assert.throws(() => manager.input(owner, device, t.terminalId, 'no'), /SESSION_BUSY/);
    await manager.close();
    await assert.rejects(() => manager.create({ ownerId: owner, deviceId: device, conversationId: 'x', tabId: 'y', cwd }), /SERVICE_CLOSING/);
  } finally { await manager.close(); await rm(cwd, { recursive: true, force: true }); }
});

process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir, lstat, unlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { phoneRuntime } from '../../services/cloud/test/relay-phone-runtime.mjs';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';

const key = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"], { encoding: 'utf8', windowsHide: true }).trim();
assert.ok(key, 'Machine MiMo key required');
const root = await mkdtemp(join(tmpdir(), 'weftmate-mode1-mimo-')), out = resolve('tests/evidence/mode-1'); await mkdir(out, { recursive: true });
const report = { model: 'mimo-v2.6-flash', realDsh: true, syntheticAccount: true, actualTool: null, workCard: false, executed: false };
let host, runtime;
async function removeLinks(directory) { for (const row of await readdir(directory, { withFileTypes: true })) { const file = join(directory, row.name);
  if ((await lstat(file)).isSymbolicLink()) await unlink(file); else if (row.isDirectory()) await removeLinks(file); } }
try {
  runtime = await phoneRuntime(root, [], { apiKey: key, baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash' });
  host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend }); runtime.setHost(host); await runtime.start();
  const { origin, hostId } = await host.start(), grant = await host.issueSetupGrant();
  const response = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'SyntheticModeMiMo', password: 'Synthetic MiMo mode password', deviceName: 'synthetic-phone' }) });
  assert.equal(response.status, 201); const auth = await response.json(), cookie = response.headers.get('set-cookie').split(';')[0];
  const api = async (path, body) => { const res = await fetch(origin + '/personal/v1' + path, { method: body ? 'POST' : 'GET', headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const value = await res.json(); assert.ok(res.ok, JSON.stringify({ path, status: res.status, error: value.error })); return value; };
  const created = await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic' });
  const wait = async (read, label) => { const end = Date.now() + 120000; while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 250)); } throw Error('Timed out: ' + label); };
  const command = await wait(async () => { const value = (await api('/commands/' + created.command.commandId)).command; return value.state === 'accepted_by_dsh' && value; }, 'session');
  await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: command.sessionId,
    text: '请动手在项目文件夹中新建 mode-proof.txt，内容是 MODE1_SYNTHETIC。请实际调用写文件工具，这是要做的事，不是问操作方法。', intent: 'queue' });
  const row = await wait(async () => (await api(`/sessions/${command.sessionId}/approvals`)).approvals.find(a => a.intent === 'work-switch' && a.status === 'pending'), 'real model tool card');
  report.actualTool = row.toolName; report.workCard = true;
  assert.ok(['write', 'edit', 'pwsh', 'bash', 'shell', 'run_code', 'read', 'glob', 'grep'].includes(row.toolName), 'an actual computer tool must trigger the card');
  const task = await api(`/tasks/${row.taskId}`); assert.ok(Array.isArray(task.executionSteps));
  report.executionRecords = task.executionSteps.length;
  report.executed = task.executionSteps.some(e => e.callId === row.callId);
  assert.equal(report.executed, false);
  await api(`/sessions/${command.sessionId}/approvals/${row.approvalId}`, { requestId: randomUUID(), outcome: 'rejected' });
} finally {
  await runtime?.close(); await host?.close(); await writeFile(join(out, 'mimo-report.json'), JSON.stringify(report, null, 2));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()))); await removeLinks(root); await rm(root, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
export const run = promisify(execFile);
export const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
export const core = 'D:/AIProjects/MemoWeft/Core/py/src';
export const repository = resolve(import.meta.dirname, '../..');
export const evidence = join(repository, 'tests/evidence/ia-2b');
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await pause(200); }
  throw new Error('IA-2b isolated test timeout');
}
export async function harness(label, { memory = true, mainChat = false } = {}) {
  const base = await mkdtemp(join(tmpdir(), `weftmate-ia-2b-${label}-`)), profile = join(base, 'profile');
  await mkdir(profile); await mkdir(evidence, { recursive: true });
  await writeFile(join(profile, PERSONAL_HOST_MARKER), JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"], { windowsHide: true });
  const key = stdout.trim(); assert.ok(key);
  const username = `ia-${randomUUID()}`, password = `synthetic-${randomUUID()}`;
  const backend = Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name => [name, async () => ({})]));
  const prep = await createPersonalAccessService({ root: join(profile, 'personal-access'), port: 0, backend });
  let ownerId;
  try {
    const { origin } = await prep.start(), grant = await prep.issueSetupGrant();
    const response = await fetch(`${origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username, password, deviceName: 'IA-2b synthetic' }) });
    assert.equal(response.status, 201); ownerId = (await response.json()).account.ownerId;
  } finally { await prep.close(); }
  const config = join(base, 'memory.json');
  await writeFile(config, JSON.stringify({ python, pythonPath: core, baseUrl: 'http://127.0.0.1:1/v1', model: '@current', authRef: 'ia2b-mimo' }));
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(name) || ['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name)) delete env[name];
  env.WEFTMATE_BASELINE_TRACE = join(base, 'requests.jsonl');
  let app, page, launches = 0;
  async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    return page.evaluate(async ({ path, body, method }) => {
      const me = await (await fetch('/personal/v1/auth/me')).json();
      const response = await fetch(`/personal/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, { path, body, method });
  }
  async function launch() {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [join(repository, 'tests/integration/ia-2b-bootstrap.mjs'),
      `--user-data-dir=${profile}`, '--personal-host', '--access-port=0', ...(memory ? [`--personal-memory-config=${config}`] : [])], cwd: repository, env, timeout: 90000 });
    let errors = '';
    app.process().stderr.on('data', part => { errors += String(part); appendFileSync(join(base, 'host.log'), String(part).replaceAll(key, '[redacted]')); });
    app.process().stdout.on('data', part => appendFileSync(join(base, 'host.log'), String(part).replaceAll(key, '[redacted]')));
    launches++;
    try { page = await app.firstWindow({ timeout: 90000 }); await page.waitForURL('**/personal/v1/ui'); }
    catch (error) { await writeFile(join(base, 'launch-error.log'), errors); console.error(errors.replaceAll(key, '[redacted]').slice(-8000)); throw error; }
    await localUiSession(page, { username, password }, 'IA-2b test', {mainChat});
    await app.evaluate(async (_, apiKey) => globalThis.m2ExitSeedCredentials({ 'ia2b-mimo': apiKey }), key);
    assert.equal((await api('/backups/settings', { enabled: false, directory: join(base, 'Backups') }, 'PATCH')).status, 200);
  }
  async function command(body) {
    const result = await api('/commands', body); assert.equal(result.status, 202, JSON.stringify(result.body));
    return until(async () => {
      const current = (await api(`/commands/by-request/${body.requestId}`)).body.command;
      if (['rejected','uncertain'].includes(current.state)) throw new Error(`Command ${current.state}: ${current.errorCode}`);
      return current.state === 'accepted_by_dsh' && current;
    });
  }
  async function complete(command) {
    return until(async () => {
      const value = await api(`/tasks/${command.commandId}`), task = value.body.task ?? value.body;
      if (['failed','aborted'].includes(task.replyEvidence?.status)) throw new Error(JSON.stringify(task.replyEvidence));
      return task.replyEvidence?.status === 'completed' && task;
    });
  }
  async function close() { if (app) { const current = app; app = null; await current.close(); } }
  async function usage() {
    const rows = (await readFile(env.WEFTMATE_BASELINE_TRACE, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
    return rows.filter(row => row.phase === 'end' && row.usage).map(row => row.usage);
  }
  try {
    await launch();
    const requestId = randomUUID();
    assert.equal((await api('/account/models', { requestId, name: 'ia2b-mimo', baseUrl: 'https://api.xiaomimimo.com/v1', modelId: 'mimo-v2.6-flash', apiKey: key })).status, 202);
    await until(async () => (await api(`/account/models/by-request/${requestId}`)).body.operation?.status === 'succeeded');
    const modelProfileId = (await api('/models')).body.models.find(row => row.name === 'ia2b-mimo').id;
    const hostId = (await api('/status')).body.hostId;
    if (memory) { await api('/settings/models', { backgroundModelProfileId: modelProfileId }, 'PATCH'); await until(async () => ['ready','degraded'].includes((await api('/memory/status')).body.state)); }
    return { base, profile, ownerId, modelProfileId, hostId, api, command, complete, launch, close, usage,
      get app() { return app; }, get page() { return page; }, get launches() { return launches; } };
  } catch (error) { await close(); throw error; }
}

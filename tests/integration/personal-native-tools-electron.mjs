/** Synthetic model, real Electron + DSH + personal/v1; all data stays in a fresh fixture. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'weftmate-synthetic-stop-stage11-native-tools-'));
const profile = join(root, 'profile'); mkdirSync(profile);
writeFileSync(join(profile, '.weftmate-personal-host-profile.json'), JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { toolCalls: [], schemas: [], artifacts: [], fixtureRoot: root };
let child, origin, output = '', auth, count = 0;
function respond(response, model, tool, args) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: randomUUID(),
    object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  frame(tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + randomUUID(), type: 'function',
    function: { name: tool, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'Native deliverables verified.' });
  frame({}, tool ? 'tool_calls' : 'stop'); response.end('data: [DONE]\n\n');
}
const model = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/first') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><title>First page</title><body><h1>Native browser</h1><p>Public rendered fixture.</p><a href="http://page-b.weftmate.invalid:${model.address().port}/next">Next page</a></body></html>`); return;
  }
  if (req.method === 'GET' && req.url === '/next') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><title>Next page</title><body><p>Followed native browser link.</p></body></html>'); return;
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'synthetic-stop-model' }] })); return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404); res.end(); return;
  }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(body.model, 'synthetic-stop-model');
  const names = (body.tools ?? []).map(tool => tool.function?.name ?? tool.name);
  if (!names.length || body.tool_choice === 'none') { respond(res, body.model); return; }
  const isChild = body.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('NATIVE_CHILD_READ'));
  if (isChild) {
    report.childSchemas = names;
    const executed = body.messages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? []).map(call => call.function.name);
    if (!executed.includes('read')) respond(res, body.model, 'read', { file_path: 'report.md' });
    else if (!executed.includes('write')) respond(res, body.model, 'write', { file_path: 'child-result.md', content: '# Child result\nNative delegation verified.\n' });
    else {
      report.childReadVerified = body.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('Written by DSH write'));
      respond(res, body.model);
    }
    return;
  }
  report.schemas = names;

  const invoke = (name, args) => {
    report.toolCalls.push(name);
    if (names.includes('run_code') && !names.includes(name)) respond(res, body.model, 'run_code', {
      code: `return await tools.${name}(${JSON.stringify(args)});`, description: 'Create native deliverables' });
    else respond(res, body.model, name, args);
  };
  const executed = body.messages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? []).map(call => call.function.name)
  count++;
  if (!executed.includes('write')) invoke('write', { file_path: 'report.md', content: '# Native report\nWritten by DSH write.\n' });
  else if (!executed.includes('pwsh')) invoke('pwsh', { command: "Set-Content -LiteralPath shell-one.txt -Value 'one'; Set-Content -LiteralPath shell-two.txt -Value 'two'",
    description: 'Create two files with the native shell' });
  else if (!executed.includes('read')) invoke('read', { file_path: 'report.md' });
  else {
    const reads = body.messages.filter(message => message.role === 'tool').map(message => {
      try { return JSON.parse(message.content); } catch { return null; }
    }).filter(value => value?.snapshotId && value?.links);
    if (!executed.includes('browser')) invoke('browser', { action: 'open', url: `http://page-a.weftmate.invalid:${model.address().port}/first` });
    else if (reads.length === 1 && executed.filter(name => name === 'browser').length === 1) invoke('browser', { action: 'follow', snapshotId: reads[0].snapshotId, linkId: reads[0].links[0].linkId });
    else if (!executed.includes('subagent')) invoke('subagent', { description: 'Read generated report', prompt: 'NATIVE_CHILD_READ: Read report.md and verify its text.', run_in_background: false });
    else respond(res, body.model);
  }
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
async function until(check, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await pause(100); }
  throw new Error(`Native fixture timeout: ${output.slice(-1500)}`);
}
function manage(action, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { child.off('message', listener); reject(new Error('Management timed out')); }, 20000);
    const listener = frame => {
      if (frame?.type !== 'weftmate:manage-result' || frame.requestId !== requestId) return;
      child.off('message', listener); clearTimeout(timer);
      frame.ok ? resolve(frame.result) : reject(new Error(frame.code));
    };
    child.on('message', listener); child.send({ type: 'weftmate:manage', requestId, action, ...fields });
  });
}
async function request(method, route, body) {
  const response = await fetch(origin + '/personal/v1/' + route, { method,
    headers: { origin, 'content-type': 'application/json', ...(auth ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const value = await response.json(); assert.ok(response.ok, JSON.stringify(value));
  return { value, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function command(kind, hostId, fields) {
  const { value } = await request('POST', 'commands', { requestId: randomUUID(), kind, targetDeviceId: hostId, ...fields });
  return until(async () => {
    const { value: read } = await request('GET', `commands/${value.command.commandId}`);
    if (['pending', 'dispatching'].includes(read.command.state)) return;
    assert.equal(read.command.state, 'accepted_by_dsh', JSON.stringify(read.command)); return read.command;
  });
}
try {
  const electron = (await import('electron')).default;
  child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--personal-host', '--access-port=0'], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1', WEFTMATE_SYNTHETIC_STOP_FIXTURE: '1', WEFTMATE_SYNTHETIC_BROWSER_PORT: String(model.address().port) } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-128 * 1024); });
  origin = await until(() => /personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]);
  const oldNative = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
  await manage('model.configure-synthetic-stop-fixture', { baseUrl: `http://127.0.0.1:${model.address().port}/v1` });
  await until(() => [...output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)].some(match => match[1] !== oldNative));
  const grant = await manage('account.setup');
  const setup = await request('POST', 'auth/setup', { grant: grant.grant, username: 'eval-native-tools',
    password: 'synthetic-' + randomUUID(), deviceName: 'Native fixture' });
  auth = { cookie: setup.cookie, 'x-weftmate-csrf': setup.value.csrfToken };
  const hostId = (await request('GET', 'status')).value.hostId;
  const session = await command('session.create', hostId, { modelProfileId: 'synthetic-stop-fixture' });
  const source = await command('session.message', hostId, { sessionId: session.sessionId, text: 'Create and verify three files with native tools.' });
  const events = await until(async () => {
    const value = (await request('GET', `sessions/${session.sessionId}/events?afterSeq=-1&limit=200`)).value;
    report.events = value.events;
    return value.events.some(event => event.type === 'turn.ended') ? value.events : null;
  });
  report.events = events
  report.details = []
  for (const event of events.filter(event => event.type === 'step.completed' || event.type === 'artifact.created')) report.details.push((await request('GET', `sessions/${session.sessionId}/events/${event.seq}/detail`)).value)
  const artifacts = events.filter(event => event.type === 'artifact.created').flatMap(event => event.data.artifacts ?? [event.data]);
  assert.deepEqual(artifacts.map(artifact => artifact.fileName).sort(), ['child-result.md', 'report.md', 'shell-one.txt', 'shell-two.txt']);
  for (const artifact of artifacts) {
    const preview = (await request('GET', `artifacts/${artifact.artifactId}/preview`)).value;
    assert.equal(preview.artifact.taskId, source.commandId); assert.ok(preview.text.trim());
  }
  report.modelToolRequests = report.toolCalls
  report.toolCalls = events.filter(event => event.type === 'step.started').map(event => event.data.toolName)
  assert.deepEqual(report.toolCalls, ['write', 'pwsh', 'read', 'browser', 'browser', 'subagent']);
  assert.equal(report.childReadVerified, true, 'the real native subagent reads in the parent conversation directory');
  assert.ok(report.childSchemas.includes('web_fetch'));
  assert.equal(report.childSchemas.includes('browser'), false, 'native children use web_fetch; rendered browser delivery belongs to the portal conversation');
  for (const name of ['read', 'write', 'edit', 'grep', 'glob', 'web_fetch', 'todo_write', 'subagent', 'browser'])
    assert.ok(report.schemas.includes(name), `Missing native tool ${name}`);
  assert.ok(report.schemas.every(name => !/^personal_(?:open|save|list|read|browser)/.test(name)));
  const cwd = join(profile, 'conversations', session.sessionId);
  assert.match(readFileSync(join(cwd, 'report.md'), 'utf8'), /Written by DSH write/);
  assert.equal(events.find(event => event.type === 'turn.ended').data.reason, 'completed');
  report.artifacts = artifacts; report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
  try {
    const native = [...output.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/g)].at(-1)[1];
    const rpc = async (method, payload) => (await (await fetch(native + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }) })).json()).result;
    const listed = await rpc('session.list', {});
    report.nativeChildren = [];
    for (const item of listed.value?.items ?? []) if (item.origin === 'subagent') report.nativeChildren.push({ item,
      history: await rpc('session.history', { sessionId: item.sessionId }) });
  } catch (diagnosticError) { report.diagnosticError = diagnosticError.message; }
}
finally {
  if (child && child.exitCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve)); child.send({ type: 'weftmate:quit' });
    await Promise.race([closed, pause(15000)]);
    if (child.exitCode === null) { child.kill(); await closed; }
  }
  await new Promise(resolve => model.close(resolve));
  writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

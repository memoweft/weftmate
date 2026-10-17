import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createModelScheduler } from '../src/model-scheduler.mjs';
import { createInstalledSmokeResponder, installedSmokePrompt, installedSmokeRequestKind } from '../scripts/nightly/installed-smoke-provider.mjs';

// Core 2112aa8 dsh_bridge/__init__.py:508-524: local formation also streams.
// hermes/batch_adapter.py:1071-1090,1505-1514 supplies this JSON evidence envelope.
const memory = (stream = true) => ({ stream, response_format: { type: 'json_object' }, messages: [
  { role: 'system', content: 'Interpret source evidence as stable cognitions. Return schema_version 8 JSON.' },
  { role: 'user', content: JSON.stringify({ current_cognitions: [], evidence: [{ id: 'synthetic-evidence', text: installedSmokePrompt }] }) },
] });
const project = () => ({ stream: true, tools: ['load_tools', 'read', 'write'].map(name => ({ type: 'function', function: { name } })),
  messages: [{ role: 'system', content: 'Synthetic project assistant' }, { role: 'user', content: installedSmokePrompt }] as any[] });
function accept(input, reply, content) {
  const call = reply.tool_calls[0];
  input.messages.push(reply, { role: 'tool', tool_call_id: call.id, content });
}
const name = reply => reply.tool_calls?.[0]?.function.name ?? 'final';

for (const after of ['load_tools', 'read']) test(`streamed memory between project ${after} and its continuation cannot consume the next tool`, async () => {
  const respond = createInstalledSmokeResponder(), chat = project(), trace = [];
  let reply = await respond(chat); trace.push(['project', name(reply)]);
  assert.equal(name(reply), 'load_tools'); accept(chat, reply, '{"loaded":["read","write"]}');
  if (after === 'read') {
    reply = await respond(chat); trace.push(['project', name(reply)]);
    assert.equal(name(reply), 'read'); accept(chat, reply, '<path>brief.md</path>\n<content>1: FX21 synthetic project file</content>');
  }
  const background = await respond(memory()); trace.push(['memory', name(background)]);
  reply = await respond(chat); trace.push(['project', name(reply)]);
  console.log(JSON.stringify({ interleave: after, trace, backgroundReply: background.content }));
  assert.equal(name(reply), after === 'read' ? 'write' : 'read');
  assert.equal(background.tool_calls, undefined, 'formation must never receive native execution tools');
  assert.deepEqual(JSON.parse(background.content), { schema_version: 8, result: 'no_change' });
});

for (const stream of [true, false]) test(`memory quoting the work instruction receives only schema JSON (stream=${stream})`, async () => {
  const respond = createInstalledSmokeResponder(), input = memory(stream);
  assert.equal(installedSmokeRequestKind(input), 'memory');
  const reply = await respond(input);
  assert.equal(reply.tool_calls, undefined);
  assert.deepEqual(JSON.parse(reply.content), { schema_version: 8, result: 'no_change' });
  assert.deepEqual(respond.describe(input), { source: 'memory', reply: 'no_change' });
});

test('unrelated streamed requests and a second conversation cannot advance another project', async () => {
  const respond = createInstalledSmokeResponder(), first = project(), second = project();
  accept(first, await respond(first), '{"loaded":["read","write"]}');
  const other = { stream: true, messages: [{ role: 'user', content: 'Synthetic unrelated greeting' }] };
  assert.equal((await respond(other)).tool_calls, undefined);
  assert.equal(name(await respond(second)), 'load_tools');
  assert.equal(name(await respond(first)), 'read');
  assert.deepEqual(respond.describe(other), { source: 'other', reply: 'text' });
});

test('unacknowledged assistant claims and unrelated tool text cannot authorize the write response', async () => {
  const respond = createInstalledSmokeResponder(), input = project();
  accept(input, await respond(input), '{"loaded":["read","write"]}');
  input.messages.push({ role: 'assistant', content: 'FX21 synthetic project file 已读取' },
    { role: 'tool', tool_call_id: 'unrelated', content: 'FX21 synthetic project file' });
  assert.equal(name(await respond(input)), 'read');
  const failed = await respond(input);
  accept(input, failed, 'brief.md: read failed');
  await assert.rejects(respond(input), /INSTALLED_SMOKE_TOOL_RESULT_INVALID:read/);
});

test('real memory scheduler and project HTTP requests share one provider without sharing tool progress', async () => {
  const respond = createInstalledSmokeResponder(), received = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"total_slots":1}'); return; }
    let body = ''; for await (const part of req) body += part;
    const input = JSON.parse(body), message = await respond(input);
    received.push(respond.describe(input));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = { id: 'synthetic', model: 'synthetic', baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1` };
  const scheduler = await createModelScheduler({ profileFor: () => profile, credentialFor: () => 'synthetic', isIdle: async () => true,
    backgroundRoute: () => null, backgroundReady: async () => true });
  const send = async (url, input) => {
    const r = await fetch(url + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic' }, body: JSON.stringify(input) });
    assert.equal(r.status, 200); return (await r.json()).choices[0].message;
  };
  try {
    const chat = project(), memoryUrl = scheduler.memoryBaseUrl(profile.id, 'synthetic-owner', 'synthetic-session');
    accept(chat, await send(profile.baseUrl, chat), '{"loaded":["read","write"]}');
    assert.equal((await send(memoryUrl, memory())).tool_calls, undefined);
    const read = await send(profile.baseUrl, chat); assert.equal(name(read), 'read');
    accept(chat, read, '<path>brief.md</path>\n<content>1: FX21 synthetic project file</content>');
    assert.equal((await send(memoryUrl, memory())).tool_calls, undefined);
    const write = await send(profile.baseUrl, chat); assert.equal(name(write), 'write');
    accept(chat, write, '<path>approved.md</path>\n<content>Created file</content>');
    assert.equal(name(await send(profile.baseUrl, chat)), 'final');
    assert.deepEqual(received, [
      { source: 'project', reply: 'load_tools' }, { source: 'memory', reply: 'no_change' },
      { source: 'project', reply: 'read' }, { source: 'memory', reply: 'no_change' },
      { source: 'project', reply: 'write' }, { source: 'project', reply: 'text' },
    ]);
    console.log(JSON.stringify({ reproduction: 'shared-provider-via-real-scheduler', received }));
  } finally { await scheduler.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('project tool sequence depends on its acknowledged results, not request count', async () => {
  const respond = createInstalledSmokeResponder(), chat = project();
  const first = await respond(chat);
  assert.equal(name(await respond(chat)), 'load_tools');
  accept(chat, first, '{"loaded":["read","write"]}');
  const read = await respond(chat); assert.equal(name(read), 'read');
  assert.equal(name(await respond(chat)), 'read', 'no write until a real read result is present');
  accept(chat, read, '<path>brief.md</path>\n<content>1: FX21 synthetic project file</content>');
  const write = await respond(chat); assert.equal(name(write), 'write');
  accept(chat, write, '<path>approved.md</path>\n<content>Created file</content>');
  assert.equal(name(await respond(chat)), 'final');
});

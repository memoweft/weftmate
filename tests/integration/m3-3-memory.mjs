import { mkdirSync as prepareEvidenceDirectory } from 'node:fs';
import { evidencePath } from '../helpers/evidence-path.mjs';
/** Read-only external Core checkout, synthetic HTTP interpretation, isolated data. */
import assert from 'node:assert/strict';
import { createPersonalMemoryManager } from '../../src/personal-memory/index.mjs';
import { boundaryForCompletedTurn } from '../../src/plugins/weftmate-personal-memory.mjs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
prepareEvidenceDirectory(evidencePath('m3-3'), { recursive: true });


const source = resolve(process.env.M3_3_MEMORY_SOURCE || '../memoweft/py/src');
const python = resolve(process.env.M3_3_MEMORY_PYTHON || '../memoweft/py/.venv/bin/python');
const root = await realpath(await mkdtemp(join(tmpdir(), 'weftmate-m3-3-memory-')));
const owner = 'owner-00000000-0000-4000-8000-000000000001';
let formationRequests = 0, chatRequests = 0, manager;
const report = { core: 'real Python Core and host RPC v2', model: 'synthetic HTTP',
  coreCommit: execFileSync('git', ['-C', resolve(source, '../..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  pythonVersion: execFileSync(python, ['--version'], { encoding: 'utf8' }).trim(),
  systemPythonEligible: false, mimoRequests: 0, completed: false };
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  let data; try { data = JSON.parse(body.messages.at(-1).content); } catch { /* Ordinary conversation. */ }
  let content;
  if (data?.evidence) {
    formationRequests++;
    const e = data.evidence[0];
    // The current local Core asks for exact character spans. This is the
    // interpretation response only; Core validates/applies it and owns recall.
    content = JSON.stringify({ schema_version: 8, result: 'cognitions', cognitions: [{
      action: 'form', target: 'owner_self', statement_kind: 'naming', formed_by: 'stated', proposition: e.text,
      entity: { canonical_name: '小禾', kind: 'person' }, supports: [{ evidence_id: e.id, start: 0, end: e.text.length }],
    }] });
  } else {
    chatRequests++;
    assert.match(JSON.stringify(body.messages), /记忆：以后请叫我小禾/);
    content = '你希望我称呼你为小禾。';
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const route = () => ({ profileId: 'synthetic', baseUrl, model: 'synthetic', credential: 'synthetic', routeFingerprint: null, modelTier: 'local' });
const create = () => createPersonalMemoryManager({ root, enabled: true, python, pythonPath: source, baseUrl,
  model: '@current', credential: () => 'synthetic', processingRoute: route, defaultProcessingRoute: route });
try {
  manager = create();
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { id: 'synthetic-user', source: { kind: 'user' }, content: [{ type: 'text', text: '以后请叫我小禾。' }] } },
    { seq: 3, type: 'assistant/message', data: { message: { id: 'synthetic-assistant', content: [{ type: 'text', text: '收到' }] } } },
    { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ];
  report.ingest = await manager.ingest(owner, boundaryForCompletedTurn({ id: 'synthetic-source', header: { agentPreset: 'personal-shared-chat' }, events }, events.at(-1)));
  assert.equal(report.ingest.state, 'accepted');
  const end = Date.now() + 45000;
  let recalled;
  do {
    recalled = await manager.recall(owner, { query: '怎么称呼我？', sessionId: 'synthetic-new-session', modelTier: 'local' });
    if (recalled.memories?.length) break;
    await new Promise(r => setTimeout(r, 100));
  } while (Date.now() < end);
  assert.equal(recalled.memories.length, 1, 'A pending boundary cannot stand in for formed memory');
  assert.match(recalled.contextText, /小禾/);
  report.worldRevision = recalled.worldRevision; report.formalMemories = recalled.memories.length;
  const answer = await fetch(baseUrl + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'system', content: recalled.contextText }, { role: 'user', content: '怎么称呼我？' }] }) }).then(r => r.json());
  assert.match(answer.choices[0].message.content, /小禾/); report.newConversationAnswer = answer.choices[0].message.content;
  await manager.close(); manager = create();
  const restored = await manager.recall(owner, { query: '怎么称呼我？', sessionId: 'synthetic-after-restart', modelTier: 'local' });
  assert.equal(restored.memories.length, 1); assert.match(restored.contextText, /小禾/);
  report.restoredAfterRestart = true;
  report.health = await manager.status(owner); report.completed = true;
} catch (error) {
  report.failure = { code: error.code || error.name, message: String(error.message).replaceAll(root, '<synthetic-temp>') };
  process.exitCode = 1;
} finally {
  report.formationRequests = formationRequests; report.chatRequests = chatRequests;
  await manager?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  await rm(root, { recursive: true, force: true });
  await writeFile(evidencePath('m3-3/memory.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ completed: report.completed, formationRequests, chatRequests }));
}

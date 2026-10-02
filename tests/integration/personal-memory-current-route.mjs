/** Real Core route against an isolated fake ModelSwitcher; never reaches port 8081. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';

if (process.env.WEFTMATE_REAL_MEMORY_ROUTE_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_MEMORY_ROUTE_E2E=1 for this fake-upstream Core route test.');
}
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
let loaded = true;
let postCount = 0;
let modelListCount = 0;
let switchCount = 0;
const modelPid = 424242; // A fixed fake process identity, never a live model PID.
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') { modelListCount++; res.writeHead(500).end(); return; }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end(); return;
  }
  postCount++;
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = JSON.parse(body);
  assert.equal(json.model, '@current');
  assert.equal(json.stream, false);
  if (!loaded) { res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NO_CURRENT_MODEL' } })); return; }
  res.writeHead(200, { 'content-type': 'application/json',
    'X-ModelSwitcher-Model': 'synthetic-loaded-profile' });
  res.end(JSON.stringify({ choices: [{ message: { content: '合成记忆解释' }, finish_reason: 'stop' }],
    usage: { total_tokens: 1 } }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const py = `import json
from memoweft.integrations.dsh_bridge import default_one_shot_route
route = default_one_shot_route(model_tier='local', api_key_override='synthetic')
try:
    result = route([{'role':'user','content':'synthetic'}])
    print(json.dumps({'state':'ready','model':result['model'],'content':result['content']}))
except Exception:
    print(json.dumps({'state':'unavailable'}))`;
const runPython = promisify(execFile);
async function call() {
  const { stdout } = await runPython(python, ['-c', py], { windowsHide: true, timeout: 10_000,
    env: { ...process.env, PYTHONPATH: pythonPath,
      MEMOWEFT_BASE_URL: `http://127.0.0.1:${port}/v1`, MEMOWEFT_WORLD_MODEL: '@current' } });
  return JSON.parse(stdout);
}
try {
  const before = { switchCount, modelPid };
  const first = await call();
  assert.deepEqual(first, { state: 'ready', model: 'synthetic-loaded-profile', content: '合成记忆解释' });
  assert.deepEqual({ switchCount, modelPid }, before);
  loaded = false;
  assert.deepEqual(await call(), { state: 'unavailable' });
  assert.equal(postCount, 2);
  assert.equal(modelListCount, 0, '404 for @current must never choose a catalog model');
  assert.deepEqual({ switchCount, modelPid }, before);
  console.log('[personal-memory-current-route] resolved header model; no-switch identity; 404 unavailable; no catalog fallback');
} finally { server.close(); await once(server, 'close'); }

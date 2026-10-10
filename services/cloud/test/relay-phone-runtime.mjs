/** Real production DSH/backend seam, with an isolated scripted HTTP model. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DshWebRuntime } from '../../../src/dsh-web-runtime.ts';
import { createPersonalAccessBackend } from '../../../src/personal-access-backend.mjs';

export async function phoneRuntime(root, logs) {
  const project = join(root, 'project'); await mkdir(project);
  const input = join(project, 'input.txt'), output = join(project, 'result.txt');
  const content = 'CI_R1_SYNTHETIC_FILE_CONTENT\n'; await writeFile(input, content);
  const requests = [];
  const model = createServer((req, res) => {
    if (req.url === '/props') return res.end(JSON.stringify({ default_generation_settings: { n_ctx: 32768 } }));
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    let raw = ''; req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      const body = JSON.parse(raw); requests.push(body);
      const user = body.messages.findLast(m => m.role === 'user');
      const isTask = JSON.stringify(user?.content).includes('CI_R1_FILE_TASK');
      const calls = body.messages.flatMap(m => m.tool_calls ?? []);
      const step = calls.filter(c => c.id.startsWith('ci-r1-')).length;
      const tools = [
        { name: 'read', arguments: JSON.stringify({ file_path: input }) },
        { name: 'write', arguments: JSON.stringify({ file_path: output, content }) },
        { name: 'read', arguments: JSON.stringify({ file_path: output }) },
      ];
      const tool = isTask && tools[step];
      if (tool) assert.ok(body.tools.some(t => t.function?.name === tool.name), 'native tool is available');
      const delta = tool ? { tool_calls: [{ index: 0, id: `ci-r1-${step}`, type: 'function', function: tool }] }
        : { content: isTask ? 'CI_R1_FILE_TASK_COMPLETED' : 'CI_R1_FIRST_INPUT_ACK' };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  const home = join(root, 'dsh-home'); await mkdir(home);
  const patch = join(home, 'model.yml');
  await writeFile(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      relay-fixture:\n        api: openai-completions\n        apiKeyEnv: FIXTURE_API_KEY\n        baseURL: http://127.0.0.1:${model.address().port}/v1\n        models:\n          - id: synthetic\n            contextWindow: 32768\n            maxTokens: 4096\n- id: credentials\n  disabled: true\n- insert:\n    - id: weftmate-safe-credentials\n      name: ./plugins/weftmate-credentials.mjs\n    - id: weftmate-personal-model-idle\n      name: ./plugins/weftmate-personal-model-idle.mjs\n- id: api-gateway\n  disabled: true\n- insert:\n    - id: weftmate-personal-api-gateway\n      name: ./plugins/weftmate-personal-api-proxy.mjs\n    - id: weftmate-personal-reply-evidence\n      name: ./plugins/weftmate-personal-reply-evidence.mjs\n`);
  let host, origin;
  const runtime = new DshWebRuntime({ homeDir: home, workspaceDir: project,
    ...(process.env.WEFTMATE_DSH_CHECKOUT ? { checkoutPath: process.env.WEFTMATE_DSH_CHECKOUT } : { runtimePath: join(process.cwd(), 'vendor/dsh-runtime') }),
    personalHostApiProxy: true, patchFiles: [patch],
    credentialRequestHandler: async ({ operation }) => operation === 'resolve' ? { value: 'synthetic-only-key' } : { configured: true, writable: true },
    personalDesktopRequestHandler: async request => {
      if (request.action === 'approval_policy') return host.getApprovalPolicy(request);
      if (['register_approval', 'read_approval', 'resolve_approval'].includes(request.action)) return host.trackToolApproval(request);
      if (['authorize_execution', 'finish_execution', 'observe_execution_job'].includes(request.action)) return host.trackToolExecution(request);
      if (request.action === 'register_file') return host.registerNativeFile(request);
      throw new Error('Unexpected native action: ' + request.action);
    },
    personalConversationContextHandler: request => host.getConversationContext(request),
    personalApprovalRuntimeClosedHandler: ({ runtimeId }) => host?.invalidateToolApprovals({ runtimeId, outcome: 'unavailable', reasonCode: 'RUNTIME_UNAVAILABLE' }),
    log: line => logs.push(line),
  });
  const bindings = new Map();
  const profile = { id: 'synthetic', name: '合成中继模型', model: 'synthetic', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, provider: 'openai-compatible' };
  const gateway = async (path, options = {}) => {
    const response = await fetch(origin + '/weftmate/api/v1' + path, { headers: { 'content-type': 'application/json' }, ...options });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(JSON.stringify(data)), { code: data.error?.code ?? data.error });
    return data;
  };
  const backend = createPersonalAccessBackend({ currentOrigin: () => origin, referenceScan: () => ({ state: 'ready' }),
    profiles: () => [profile], hasCredential: () => true, routeForProfile: () => ({ provider: 'relay-fixture' }),
    listSessions: () => gateway('/sessions'), resolveSession: async () => ({ profile }), ensureKnownSession: async () => {},
    gateway, queue: fn => fn(), bindSession: (id, profileId) => bindings.set(id, profileId),
    sessionProfileId: id => bindings.get(id), sessionProfileIds: () => Object.fromEntries(bindings),
    replyEvidence: input => runtime.readPersonalReplyEvidence(input), sessionWorkspaceRoot: join(root, 'workspaces'),
    inferenceVerified: () => true,
  });
  return { backend, project, input, output, content, requests, setHost: value => { host = value; },
    start: async () => { origin = await runtime.start(); },
    close: async () => { await runtime.close(); await new Promise(r => { model.close(r); model.closeAllConnections(); }); },
    readOutput: () => readFile(output, 'utf8') };
}

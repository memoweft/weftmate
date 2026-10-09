/** Production desktop + access service, synthetic native session state only. */
import { app, session } from 'electron';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { readNativeTaskStopState } from '../../src/runtime/dsh-adapter/task-stop-state.mjs';

const root = process.env.FX12_PROFILE;
if (!root?.startsWith(process.env.TEMP)) throw new Error('FX12 requires a temporary profile');
app.setPath('userData', root);
app.getLoginItemSettings = () => ({ openAtLogin: false });
if (process.env.FX12_BASELINE) {
  const sources = JSON.parse(readFileSync(process.env.FX12_BASELINE, 'utf8')).modules;
  registerHooks({ load(url, context, nextLoad) {
    return sources[url] ? { format: 'module', shortCircuit: true, source: sources[url] } : nextLoad(url, context);
  } });
}
const { createPersonalAccessService } = await import('../../src/personal-access/index.mjs');
const { createPersonalDesktop } = await import('../../src/personal-desktop.mjs');
const { servePersonalAccessUi, setPersonalAccessUiResourceReader } = await import('../../src/personal-access-ui/index.mjs');
if (process.env.FX12_BASELINE) {
  const resources = JSON.parse(readFileSync(process.env.FX12_BASELINE, 'utf8')).resources;
  setPersonalAccessUiResourceReader(async resource => resources[resource] === undefined ? null : Buffer.from(resources[resource]));
}
void app.whenReady().then(async () => {
const records = new Map();
let sequence = 0, nativeStartedAt = Date.now(), stopCalls = 0, nativeReads = 0, sends = 0;
const ctx = {
  sessions: { get: id => records.get(id)?.agent?.session },
  agents: { get: id => records.get(id)?.agent },
  get: () => ({ readFrom: async id => ({ meta: { id, agentPreset: 'personal-remote' }, events: records.get(id)?.native ?? [] }),
    list: async () => [...records.keys()].map(id => ({ id, agentPreset: 'personal-remote' })) }),
};
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready', capabilities: { chat: { available: true, inferenceVerified: true } } }),
  listModels: async () => [{ id: 'local', name: '合成模型', model: 'synthetic', configured: true }],
  preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }) => { records.set(sessionId, { history: [], native: [], running: false }); return { sessionId }; },
  sendMessage: async ({ sessionId, text }) => {
    sends++;
    const receiptId = `receipt-${++sequence}`, row = records.get(sessionId), at = new Date().toISOString();
    const turn = sequence;
    row.history.push({ seq: row.history.length, type: 'turn.started', at, data: { turn } },
      { seq: row.history.length + 1, type: 'user.message', at, data: { receiptId, text } },
      { seq: row.history.length + 2, type: 'task.started', at, data: { turn, receiptId } },
      { seq: row.history.length + 3, type: 'step.started', at, data: { taskId: `turn-${turn}`, turn, stepId: `read-${turn}`, toolName: 'read', summary: '读取文件：synthetic.txt' } },
      { seq: row.history.length + 4, type: 'step.completed', at, data: { taskId: `turn-${turn}`, turn, stepId: `read-${turn}`, toolName: 'read', summary: '读取文件：synthetic.txt', state: 'completed' } });
    row.native = [{ seq: 0, type: 'turn/start', data: { turn } },
      { seq: 1, type: 'user/message', data: { source: { kind: 'user', rpcId: receiptId } } }];
    row.running = true;
    row.agent = { status: 'running', session: { id: sessionId, header: { id: sessionId, agentPreset: 'personal-remote' }, events: row.native }, inbox: { hasPending: false } };
    return { accepted: true, receiptId, turn };
  },
  cancelSession: async () => { throw new Error('session-wide cancel forbidden'); },
  describeSession: async sessionId => ({ sessionId, title: records.get(sessionId)?.label || '合成停止核对',
    agentPreset: 'personal-remote', running: records.get(sessionId)?.running, modelProfileId: 'local' }),
  readEvents: async ({ sessionId, afterSeq = -1 }) => ({ events: records.get(sessionId).history.filter(e => e.seq > afterSeq),
    nextSeq: records.get(sessionId).history.at(-1)?.seq ?? -1, hasMore: false }),
  readSourceEvents: async ({ sessionId }) => ({ events: records.get(sessionId).history }),
  getTaskStopState: async input => { nativeReads++; return readNativeTaskStopState(ctx, nativeStartedAt, input); },
  stopTask: async ({ receiptIds }) => { stopCalls++; return { outcomes: receiptIds.map(receiptId => ({ receiptId, status: 'unconfirmed' })) }; },
};
let service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend, uiHandler: servePersonalAccessUi });
const info = await service.start(), grant = await service.issueSetupGrant();
const setup = await fetch(`${info.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: info.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: grant.grant, username: 'FX12Fixture', password: 'synthetic orphan stop password', deviceName: 'Synthetic preparation' }) });
if (setup.status !== 201) throw new Error(`setup ${setup.status}`);
const login = await fetch(`${info.origin}/personal/v1/auth/login`, { method: 'POST', headers: { origin: info.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'FX12Fixture', password: 'synthetic orphan stop password', deviceName: 'FX12 Electron' }) });
const [cookieName, value] = login.headers.get('set-cookie').split(';')[0].split('=');
await session.fromPartition('persist:weftmate-desktop').cookies.set({ url: info.origin, name: cookieName, value, path: '/', httpOnly: true });
const desktop = createPersonalDesktop({ origin: info.origin, isQuitting: () => true });
await desktop.ready;
globalThis.fx12 = { ...info,
  show: id => desktop.show(id),
  orphan(id, scenario) {
    const row = records.get(id); row.running = false; row.label = scenario;
    if (scenario === 'runtime-restart') row.agent = null;
    else {
      row.agent.status = 'idle';
      if (scenario === 'missing-turn') row.native.length = 0;
      if (scenario === 'model-switch-failed') row.native.push({ seq: 2, time: Date.now(), type: 'turn/end', data: { turn: row.native[0].data.turn, reason: { kind: 'error' } } });
      // Upstream disconnect deliberately leaves no native turn/end; actual idle confirms closure.
    }
  },
  async restartAccess() {
    await service.close(); nativeStartedAt = Date.now();
    service = await createPersonalAccessService({ root: join(root, 'access'), port: Number(new URL(info.origin).port), backend, uiHandler: servePersonalAccessUi });
    await service.start();
  },
  metrics: () => ({ stopCalls, nativeReads, sends }),
  close: async () => { await desktop.close(); await service.close(); },
};
}).catch(error => { console.error(error); app.exit(1); });

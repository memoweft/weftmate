/** Isolated real Electron main with a deliberately unacknowledged synthetic backend. */
import { app, session } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.HF2_PROFILE;
if (!root || !root.startsWith(process.env.TEMP)) throw new Error('HF2 requires a temporary profile');
app.setPath('userData', root);
app.getLoginItemSettings = () => ({ openAtLogin: false });
let syncSpawns = 0, asyncSpawns = 0, writes = [];
const originalSync = cp.execFileSync, originalAsync = cp.execFile, originalRename = fsp.rename;
cp.execFileSync = (...args) => { syncSpawns++; return originalSync(...args); };
cp.execFile = (...args) => { asyncSpawns++; return originalAsync(...args); };
fsp.rename = async (...args) => {
  await originalRename(...args);
  if (String(args[1]).endsWith('store.json')) writes.push(Date.now());
};
syncBuiltinESMExports();
if (process.env.HF2_BASELINE) {
  const sources = JSON.parse(fs.readFileSync(process.env.HF2_BASELINE, 'utf8'));
  registerHooks({ load(url, context, nextLoad) {
    if (sources[url]) return { format: 'module', shortCircuit: true, source: sources[url] };
    return nextLoad(url, context);
  } });
}
const repository = resolve(import.meta.dirname, '../..');
const { createPersonalAccessService } = await import(pathToFileURL(join(repository, 'src/personal-access/index.mjs')));
const { createPersonalDesktop } = await import(pathToFileURL(join(repository, 'src/personal-desktop.mjs')));
const { servePersonalAccessUi } = await import(pathToFileURL(join(repository, 'src/personal-access-ui/index.mjs')));
void app.whenReady().then(async () => {
const sessions = new Map(), controllers = [], stops = [];
let receiptNumber = 0, finished = false;
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [{ id: 'local', name: 'HF2 Synthetic', model: 'synthetic', configured: true }],
  preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }) => { sessions.set(sessionId, []); return { sessionId }; },
  sendMessage: async ({ sessionId, text }) => {
    const receiptId = `receipt-${++receiptNumber}`, at = new Date().toISOString();
    const events = sessions.get(sessionId);
    if (!events.length) events.push({ seq: 0, type: 'turn.started', at, data: { turn: 1 } });
    events.push({ seq: events.length, type: 'user.message', at, data: { receiptId, text } });
    events.push({ seq: events.length, type: 'task.started', at, data: { receiptId, turn: 1 } });
    const controller = new AbortController(); controllers.push(controller);
    void fetch(process.env.HF2_MODEL_URL, { method: 'POST', body: '{}', signal: controller.signal }).catch(() => {});
    return { accepted: true, receiptId, turn: 1 };
  },
  cancelSession: async () => { throw new Error('session-wide cancellation forbidden'); },
  describeSession: async sessionId => sessions.has(sessionId)
    ? { sessionId, agentPreset: 'personal-remote', running: !finished, modelProfileId: 'local' } : null,
  readEvents: async ({ sessionId, afterSeq = -1 }) => ({ events: (sessions.get(sessionId) ?? []).filter(e => e.seq > afterSeq),
    nextSeq: sessions.get(sessionId)?.at(-1)?.seq ?? -1, hasMore: false }),
  readSourceEvents: async ({ sessionId }) => ({ events: sessions.get(sessionId) ?? [], current: true }),
  getTaskReplyEvidence: async () => ({ status: finished ? 'aborted' : 'waiting', turn: 1,
    assistantChunks: 0, textChunks: 0, reasoningChunks: 0, assistantMessages: 0, toolSaveObserved: false }),
  stopTask: async ({ receiptIds }) => { stops.push(Date.now()); return { outcomes: receiptIds.map(receiptId =>
    ({ receiptId, status: 'unconfirmed' })) }; },
};
const service = await createPersonalAccessService({ root: join(root, 'personal-access'), port: 0, backend, uiHandler: servePersonalAccessUi });
const info = await service.start(), grant = await service.issueSetupGrant();
const setup = await fetch(`${info.origin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: info.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: grant.grant, username: 'HF2Fixture', password: 'synthetic correct horse battery staple', deviceName: 'Synthetic preparation' }) });
if (setup.status !== 201) throw new Error(`setup ${setup.status}`);
const login = await fetch(`${info.origin}/personal/v1/auth/login`, { method: 'POST', headers: { origin: info.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'HF2Fixture', password: 'synthetic correct horse battery staple', deviceName: 'HF2 Electron' }) });
if (login.status !== 200) throw new Error(`login ${login.status}`);
const [name, value] = login.headers.get('set-cookie').split(';')[0].split('=');
await session.fromPartition('persist:weftmate-desktop').cookies.set({ url: info.origin, name, value, path: '/', httpOnly: true });
const desktop = createPersonalDesktop({ origin: info.origin, isQuitting: () => true });
await desktop.ready;
const histogram = monitorEventLoopDelay({ resolution: 10 });
globalThis.hf2 = {
  ...info, show: id => desktop.show(id),
  begin() { writes = []; stops.length = 0; syncSpawns = 0; asyncSpawns = 0; histogram.enable(); histogram.reset(); this.startedAt = Date.now(); },
  metrics() { return { elapsedMs: Date.now() - this.startedAt, p99Ms: histogram.percentile(99) / 1e6,
    maxMs: histogram.max / 1e6, storeWrites: writes.length, writeBins10s: Array.from({ length: 7 }, (_, bin) =>
      writes.filter(at => Math.floor((at - this.startedAt) / 10_000) === bin).length), syncSpawns, asyncSpawns,
    stopCalls: stops.length, storeBytes: fs.statSync(join(root, 'personal-access/store.json')).size }; },
  finish() { finished = true; for (const controller of controllers) controller.abort();
    for (const events of sessions.values()) events.push({ seq: events.length, type: 'turn.ended', at: new Date().toISOString(), data: { turn: 1, reason: 'aborted' } }); },
  async close() { histogram.disable(); this.finish(); await desktop.close(); await service.close(); },
};

}).catch(error => { console.error(error); app.exit(1); });

import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startFixture } from './ux-4-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { evidencePath } from '../helpers/evidence-path.mjs';

const root = resolve(import.meta.dirname, '../..');
const parent = evidencePath('chat-terminal-handoff');
await mkdir(parent, { recursive: true });
const out = await mkdtemp(join(parent, 'run-'));
const report = { synthetic: true, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  checks: [], transport: [], native: [], samples: [], errors: [] };
const sessions = new Map(), waiters = new Set(), timers = new Set();
let fixture, app, phase = 'setup', requestIndex = 0;
const later = (ms, action) => { const timer = setTimeout(() => { timers.delete(timer); action(); }, ms); timers.add(timer); };
const check = (name, value) => report.checks.push({ name, value });
try {
  fixture = await startFixture();
  const create = fixture.backend.createSession, describe = fixture.backend.describeSession, read = fixture.backend.readEvents;
  const wake = (sessionId, seq) => { for (const waiter of waiters) if (waiter.sessionId === sessionId && seq > waiter.seq) waiter.resolve(); };
  fixture.backend.createSession = async input => {
    const result = await create(input);
    sessions.set(input.sessionId, { turn: 0, watermark: -1, live: null, running: false, completedAt: null });
    return result;
  };
  fixture.backend.describeSession = async id => ({ ...await describe(id), running: sessions.get(id)?.running === true });
  fixture.backend.readEvents = async input => {
    const state = sessions.get(input.sessionId);
    if (!state) return read(input);
    const all = fixture.logs.get(input.sessionId), forward = input.afterSeq !== undefined;
    const eligible = all.filter(event => forward ? event.seq > input.afterSeq : input.beforeSeq === undefined || event.seq < input.beforeSeq);
    const limit = input.limit || 50, events = forward ? eligible.slice(0, limit) : eligible.slice(-limit);
    const hasMore = forward && eligible.length > limit;
    return { events, nextSeq: hasMore ? events.at(-1).seq : Math.max(input.afterSeq ?? -1, state.watermark),
      nextBeforeSeq: events[0]?.seq ?? null, hasMore, hasOlder: !forward && eligible.length > limit,
      liveEvents: state.live ? [state.live] : [], liveSeq: state.watermark };
  };
  fixture.backend.waitForEvents = async ({ sessionId, seq, timeoutMs, signal }) => {
    const trace = { kind: 'native-wait', sessionId, seq, phase, at: Date.now() }; report.native.push(trace);
    let resolveWait;
    const pending = new Promise(resolve => { resolveWait = resolve; });
    const entry = { sessionId, seq, resolve: resolveWait }, abort = () => resolveWait();
    waiters.add(entry); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(resolveWait, timeoutMs);
    try {
      if (signal?.aborted || (sessions.get(sessionId)?.watermark ?? -1) > seq) return;
      await pending;
    } finally { clearTimeout(timer); waiters.delete(entry); signal?.removeEventListener('abort', abort); trace.finishedAt = Date.now(); trace.aborted = !!signal?.aborted; }
  };
  fixture.backend.sendMessage = async input => {
    const state = sessions.get(input.sessionId); assert.ok(state);
    const turn = ++state.turn, receiptId = `synthetic-round-${turn}`, second = turn === 2;
    const log = fixture.logs.get(input.sessionId);
    const append = (seq, type, data) => { log.push({ seq, type, data, at: new Date().toISOString(), sessionId: input.sessionId }); state.watermark = seq; wake(input.sessionId, seq); };
    state.running = true; state.completedAt = null;
    report.native.push({ kind: 'message-accepted', turn, text: input.text, at: Date.now() });
    append(second ? 71 : 4, 'task.queued', { taskId: receiptId, receiptId, text: input.text });
    append(second ? 72 : 5, 'turn.started', { turn });
    later(200, () => {
      append(second ? 74 : 7, 'task.started', { taskId: `turn-${turn}`, turn, receiptId });
      append(second ? 77 : 12, 'user.message', { text: input.text, receiptId });
      report.native.push({ kind: 'model-start', turn, at: Date.now() });
    });
    later(1200, () => {
      state.watermark = second ? 100 : 40;
      state.live = { seq: second ? 78 : 13, type: 'assistant.delta', sessionId: input.sessionId, at: new Date().toISOString(),
        data: { text: '', modelThinking: `合成回合${turn}的思考。`, thinkingActive: true, streaming: true, turn } };
      report.native.push({ kind: 'first-thinking-event', turn, at: Date.now() }); wake(input.sessionId, state.watermark);
    });
    later(2800, () => {
      state.live = null;
      append(second ? 128 : 68, 'assistant.message', { text: second ? '合成第二轮已经完成。' : '合成第一轮问候已经完成。', streamSeq: second ? 78 : 13, thinkingMs: 2600 });
      append(second ? 129 : 69, 'task.ended', { taskId: `turn-${turn}`, turn, reason: 'completed', receiptId });
      append(second ? 130 : 70, 'turn.ended', { turn, reason: 'completed' });
      state.running = false; state.completedAt = Date.now();
      report.native.push({ kind: 'durable-terminal', turn, seq: state.watermark, at: state.completedAt });
    });
    return { accepted: true, receiptId };
  };
  const env = { ...process.env, REVIEW_PROFILE: join(out, 'profile'), REVIEW_ORIGIN: fixture.origin, REVIEW_LIBRARY_TOKEN: fixture.libraryDesktopToken };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), cwd: root,
    args: ['tests/helpers/chat-first-send-electron.mjs'], env, timeout: 30000 });
  app.process().stdout?.resume(); app.process().stderr?.resume();
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  const requests = new WeakMap();
  page.on('request', request => {
    const url = new URL(request.url());
    if (!/\/personal\/v1\/(chats\/[^/]+\/(events|changes)|sessions\/[^/]+\/events|commands)/.test(url.pathname)) return;
    const row = { id: ++requestIndex, phase, at: Date.now(), method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams) };
    requests.set(request, row); report.transport.push(row);
  });
  page.on('response', async response => {
    const row = requests.get(response.request()); if (!row) return;
    row.status = response.status(); row.responseAt = Date.now();
    try { const body = await response.json(); row.finishedAt = Date.now();
      row.summary = { nextSeq: body.nextSeq, nextCursor: body.nextCursor, syncCursor: body.syncCursor, liveRevision: body.liveRevision,
        waitOutcome: body.waitOutcome, hasMore: body.hasMore, commandState: body.command?.state,
        events: (body.events || body.upserts || body.items || []).map(event => ({ seq: event.seq, type: event.type, turn: event.data?.turn, sourceSeq: event.sourceRef?.seq })) };
    } catch { row.bodyUnavailable = true; } finally { row.finishedAt = Date.now(); }
  });
  page.on('requestfailed', request => { const row = requests.get(request); if (row) { row.finishedAt = Date.now(); row.failure = request.failure()?.errorText; } });
  await page.route('**/personal/v1/ui/app.js', async route => route.fulfill({ contentType: 'text/javascript', body:
    (await readFile(join(root, 'src/personal-access-ui/app.js'), 'utf8')).replace('ui.loadAttachmentHasher =', 'globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =') }));
  await page.waitForURL('**/personal/v1/ui');
  await localUiSession(page, fixture.credentials, 'TERMINAL-HANDOFF synthetic', { mainChat: true });
  await page.waitForFunction(() => globalThis.__WeftUiStarted && testCore.state.sessions.length > 0);
  check('native change waits are available', await page.evaluate(() => testCore.state.personalCapabilities.replyWait === 1));
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await page.waitForFunction(() => testCore.state.newConversation && !testCore.state.selectedSessionId);
  await page.evaluate(() => {
    globalThis.handoffSamples = [];
    const tick = () => { handoffSamples.push({ at: performance.now(), epoch: Date.now(), generation: testCore.state.historyGeneration,
      session: testCore.state.selectedSessionId, chat: testCore.state.selectedChatId, afterSeq: testCore.state.afterSeq,
      turnStatus: testCore.state.turnStatus, liveRefreshing: testCore.state.liveRefreshing,
      historyAllowed: testCore.historyReadAllowed(), historyRead: testCore.state.historyReadResult?.kind,
      events: [...testCore.state.historyEvents.values()].map(event => ({ seq: event.seq, type: event.type, turn: event.data?.turn, live: event.data?.live })),
      operation:{text:document.getElementById('operation-status').textContent,hidden:document.getElementById('operation-status').hidden,
        height:document.getElementById('operation-status').getBoundingClientRect().height,reviewHeight:document.getElementById('reset-operation').getBoundingClientRect().height},
      transcript: document.getElementById('transcript').textContent }); globalThis.handoffFrame = requestAnimationFrame(tick); }; tick();
  });
  const input = page.getByRole('textbox', { name: '输入消息', exact: true });
  phase = 'first-send'; await input.fill('你好'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => testCore.state.turnStatus === 'completed' && document.getElementById('transcript').textContent.includes('合成第一轮问候已经完成。'));
  const bound = await page.evaluate(() => ({ sessionId: testCore.state.selectedSessionId, chatId: testCore.state.selectedChatId }));
  const durable = await fixture.request(`/sessions/${bound.sessionId}/chat`);
  report.boundIdentity = bound;
  check('the first public send binds the durable logical chat', !!bound.chatId && bound.chatId === durable.chatId);
  await page.screenshot({ path: join(out, 'first-completed.png') });
  phase = 'idle-wait';
  const idleAt = Date.now(), chatId = await page.evaluate(() => testCore.state.selectedChatId);
  const pendingWait = () => report.transport.some(row => row.path.includes(`/${chatId}/changes`) && row.query?.waitMs && !row.finishedAt);
  while (!pendingWait() && Date.now() - idleAt < 7000) await page.waitForTimeout(30);
  check('a change wait is active before the second send', pendingWait());
  phase = 'second-send'; await input.fill('123'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => testCore.state.turnStatus === 'completed' && document.getElementById('transcript').textContent.includes('合成第二轮已经完成。'), null, { timeout: 10000 }).catch(() => {});
  check('second terminal and body reach state and UI', await page.evaluate(() => testCore.state.turnStatus === 'completed' && testCore.state.historyEvents.has(130) && document.getElementById('transcript').textContent.includes('合成第二轮已经完成。')));
  check('thinking clears only after receiving the native terminal', await page.evaluate(() => testCore.state.historyEvents.has(130) && !document.querySelector('#transcript .inline-progress-text.is-running')));
  await page.screenshot({ path: join(out, 'second-observed.png') });
  report.samples = await page.evaluate(() => { cancelAnimationFrame(handoffFrame); return handoffSamples; });
  report.backend = [...sessions].map(([sessionId, state]) => ({ sessionId, turn: state.turn, watermark: state.watermark, running: state.running, completedAt: state.completedAt }));
  check('exactly two messages were accepted', report.native.filter(row => row.kind === 'message-accepted').length === 2);
  check('backend durably ended both native turns', report.native.filter(row => row.kind === 'durable-terminal').length === 2);
  check('both normal sends have no bottom notice or reserved space',report.samples.every(sample=>sample.operation.hidden && !sample.operation.text && sample.operation.height===0 && sample.operation.reviewHeight===0));
  const ended = report.native.find(row => row.kind === 'durable-terminal' && row.turn === 2)?.at;
  check('the UI does not invent completion before the second native end', !report.samples.some(sample => sample.events.some(event => event.type === 'turn.started' && event.turn === 2) && sample.epoch < ended && sample.turnStatus === 'completed'));
  check('no renderer errors', report.errors.length === 0);
  assert.deepEqual(report.checks.filter(row => !row.value), [], 'Terminal handoff invariants');
} catch (error) { report.error = error.stack; throw error; }
finally {
  for (const timer of timers) clearTimeout(timer);
  if (app) { const page = await app.firstWindow(); report.samples = await page.evaluate(() => { if (globalThis.handoffFrame) cancelAnimationFrame(handoffFrame); return globalThis.handoffSamples || []; }).catch(() => report.samples);
    await page.screenshot({ path: join(out, 'last-state.png') }).catch(() => {}); }
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close(); await fixture?.close();
}
console.log(JSON.stringify({ out, checks: report.checks }));

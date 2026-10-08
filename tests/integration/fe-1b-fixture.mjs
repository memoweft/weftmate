/** Real personal authentication, synthetic UI projections; all data lives in a fresh OS temp dir. */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';

export const fixtureTime = '2026-10-08T06:00:00.000Z';
export async function startFe1bFixture() {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-fe1b-'));
  const password = `synthetic-${randomUUID()}-password`;
  const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession']
    .map(method => [method, async () => method === 'listModels' ? [] : {}]));
  const service = await createPersonalAccessService({ root, port: 0, backend });
  const { origin: upstreamOrigin } = await service.start();
  const grant = await service.issueSetupGrant();
  const registered = await fetch(`${upstreamOrigin}/personal/v1/auth/setup`, { method: 'POST', headers: { origin: upstreamOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ grant: grant.grant, username: 'Fe1bFixture', password, deviceName: 'Synthetic preparation' }) });
  if (registered.status !== 201) throw new Error(`Registration failed: ${registered.status}`);
  const ownerId = (await registered.json()).account.ownerId;
  const ids = { report: 'session-11111111-1111-4111-8111-111111111111', running: 'session-22222222-2222-4222-8222-222222222222', approve: 'session-33333333-3333-4333-8333-333333333333' };
  const now = fixtureTime;
  const approval = { approvalId: '12345678-1234-4234-8234-123456789abc', sessionId: ids.approve, taskId: 'cmd-demo', sourceCommandId: 'cmd-demo',
    sourceReceiptId: 'rpc:demo.1', turn: 1, callId: 'call:demo.1', rootCallId: 'root:demo.1', toolName: 'weftmod_script',
    reason: '整理合成临时目录，删除三个不再需要的测试文件。', riskCategories: ['execute', 'delete'], createdAt: now, status: 'pending' };
  const artifact = { artifactId: 'report-new', fileName: '项目进展.md', contentType: 'text/markdown', size: 128, createdAt: now };
  const source = { key: 'file:notes.md', kind: 'file', name: 'notes.md', location: 'notes.md', uses: [{ id: 'turn-1/read-1', callId: 'read-1', summary: '读取项目记录 · notes.md', path: `/sessions/${ids.report}/events/3/detail`, seq: 3 }] };
  const memoryItem = { id: 'fe1b-memory', kind: 'cognition', text: '使用中文说明，并保留必要的英文技术术语。', currentState: 'active', lifecycle: {}, sourceCount: 1 };
  const step = (state = 'completed') => ({ seq: 3, type: state === 'running' ? 'step.started' : 'step.completed', at: now,
    data: { taskId: 'turn-1', stepId: 'read-1', toolName: 'read_file', summary: '读取项目记录 · notes.md', state, detailRef: { seq: 3 } } });
  const sessions = [{ sessionId: ids.report, title: '整理项目进展', sendAvailable: true, createdAt: now, modelDisplayName: '合成模型' },
    { sessionId: ids.running, title: '准备下周的安排', sendAvailable: true, running: true, createdAt: now, modelDisplayName: '合成模型' },
    { sessionId: ids.approve, title: '整理临时文件', sendAvailable: true, createdAt: now, modelDisplayName: '合成模型' }];
  const histories = { [ids.report]: [{ seq: 1, type: 'user.message', at: now, data: { text: '整理这周的项目进展，写一份简洁的报告。' } }, step(),
    { seq: 4, type: 'artifact.created', at: now, data: artifact }, { seq: 5, type: 'assistant.message', at: now, data: { text: '# 项目进展\n\n已整理本周的记录。\n\n- 完成手机审批模式\n- 统一会话与来源阅读\n\n报告已保存，点文件即可查看。' } }],
    [ids.running]: [{ seq: 1, type: 'user.message', at: now, data: { text: '帮我安排下周的工作，先整理现有的计划。' } }, { seq: 2, type: 'turn.started', at: now, data: { turn: 1 } }, step('running')],
    [ids.approve]: [{ seq: 1, type: 'user.message', at: now, data: { text: '整理临时文件，删除之前让我确认。' } }, { seq: 2, type: 'approval.requested', at: now, data: { approvalId: approval.approvalId, taskId: 'cmd-demo', summary: approval.reason } }] };
  const requests = [], commands = new Map(); let mode = 'auto';
  const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const proxy = createServer(async (req, res) => { try {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname;
    const synthetic = path === '/personal/v1/sessions' || path.startsWith('/personal/v1/sessions/') || path.startsWith('/personal/v1/tasks/cmd-demo') ||
      path.startsWith('/personal/v1/artifacts/report-new') || path.startsWith('/personal/v1/commands') || path.startsWith('/personal/v1/memory/') || path === '/personal/v1/settings/approvals';
    if (synthetic) {
      const auth = await fetch(`${upstreamOrigin}/personal/v1/auth/me`, { headers: { cookie: req.headers.cookie || '' } });
      const me = await auth.json(); if (!auth.ok || me.account?.ownerId !== ownerId) return json(res, { error: { code: 'UNAUTHORIZED' } }, 401);
      let body; if (req.method !== 'GET') { if (req.headers['x-weftmate-csrf'] !== me.csrfToken) return json(res, { error: { code: 'FORBIDDEN' } }, 403);
        let raw = ''; for await (const chunk of req) raw += chunk; body = raw ? JSON.parse(raw) : {}; }
      requests.push({ method: req.method, path: req.url, ...(body ? { body } : {}) });
      if (path === '/personal/v1/sessions') return json(res, { sessions });
      const id = path.split('/')[4];
      if (path === '/personal/v1/commands' && body) {
        const command = { ...body, commandId: `command-${commands.size + 1}`, state: 'observed', receiptId: `rpc:send.${commands.size + 1}`, createdAt: now };
        commands.set(body.requestId, command);
        const events = histories[body.sessionId];
        if (body.kind === 'session.message') events.push({ seq: (events.at(-1)?.seq || 0) + 1, type: 'user.message', at: now, data: { text: body.text, requestId: body.requestId, commandId: command.commandId, receiptId: command.receiptId } });
        else if (body.kind === 'session.cancel') { const row = sessions.find(row => row.sessionId === body.sessionId); row.running = false; events.push({ seq: events.at(-1).seq + 1, type: 'turn.completed', at: now, data: { status: 'cancelled' } }); }
        return json(res, { command }, 201);
      }
      if (path.startsWith('/personal/v1/commands/by-request/')) { const value = commands.get(decodeURIComponent(path.split('/').at(-1))); return value ? json(res, { command: value }) : json(res, { error: { code: 'NOT_FOUND' } }, 404); }
      if (path.startsWith('/personal/v1/commands/')) { const value = [...commands.values()].find(value => value.commandId === id); return value ? json(res, { command: value }) : json(res, { error: { code: 'NOT_FOUND' } }, 404); }
      if (path === '/personal/v1/memory/status') return json(res, { ownerId, state: 'ready', worldRevision: 10, capabilities: { list: true, source: true, inject: true }, pendingBoundaryCount: 0, blockedBoundaryCount: 0, discardedBoundaryCount: 0 });
      if (path === '/personal/v1/memory/items') return json(res, { ownerId, worldRevision: 10, searchScope: 'account_snapshot', items: [memoryItem], nextCursor: null, hasMore: false });
      if (path.endsWith('/sources')) return json(res, { ownerId, worldRevision: 10, sources: [{ evidenceId: 'fe1b-evidence', relation: '形成来源', currentnessState: 'current', contentAvailable: true, recordedAt: now, rawContent: '合成偏好：使用中文解释。' }] });
      if (path.startsWith('/personal/v1/memory/items/')) return json(res, { ownerId, worldRevision: 10, item: memoryItem, capabilities: {} });
      if (path.endsWith('/attachments')) return json(res, { attachments: [] });
      if (path.endsWith('/approval-mode') || path === '/personal/v1/settings/approvals') { if (body) mode = body.mode; return json(res, { mode, defaultMode: mode, allowedCategories: [] }); }
      if (path.endsWith('/events')) { const events = histories[id] || [], after = Number(url.searchParams.get('afterSeq') ?? -1); return json(res, { events: events.filter(event => event.seq > after), nextSeq: events.at(-1)?.seq ?? -1, hasMore: false, hasOlder: false }); }
      if (path.endsWith('/detail')) return json(res, { text: JSON.stringify({ arguments: { file_path: 'notes.md' }, output: '本周已经完成两项界面工作。' }, null, 2) });
      if (path.endsWith('/resources')) return json(res, { outputs: [artifact], sources: [source], nextSeq: 6, hasMore: false });
      if (path.endsWith('/approvals')) return json(res, { approvals: id === ids.approve ? [approval] : [], hasMore: false, nextBefore: null });
      if (path.includes('/approvals/')) { Object.assign(approval, { status: 'answered', decisionOutcome: body.outcome, decisionRequestId: body.requestId, decisionScope: body.scope, answeredAt: now }); return json(res, { requestId: body.requestId, approval }); }
      if (path.endsWith('/questions')) return json(res, { questions: [], hasMore: false, nextBefore: null });
      if (path.startsWith('/personal/v1/tasks/')) return json(res, { taskId: 'cmd-demo', sessionId: ids.approve, source: { commandId: 'cmd-demo', kind: 'session.message', sessionId: ids.approve, receiptId: 'rpc:demo.1' }, artifacts: [], control: { state: 'active', canStop: false, canSupplement: false } });
      if (path.endsWith('/preview')) return json(res, { text: '# 项目进展\n\n两项界面工作已完成。\n\n| 工作 | 状态 |\n| --- | --- |\n| 审批模式 | 完成 |\n| 来源阅读 | 完成 |' });
      return json(res, { error: { code: 'NOT_FOUND' } }, 404);
    }
    const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string' && !['host', 'connection', 'content-length', 'origin'].includes(key)) headers.set(key, value);
    headers.set('origin', upstreamOrigin);
    const upstream = await fetch(new URL(req.url, upstreamOrigin), { method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}), redirect: 'manual' });
    const forwarded = Object.fromEntries(upstream.headers); delete forwarded['content-length']; delete forwarded['content-encoding'];
    const cookies = upstream.headers.getSetCookie(); if (cookies.length) forwarded['set-cookie'] = cookies;
    res.writeHead(upstream.status, forwarded); if (upstream.body) Readable.fromWeb(upstream.body).pipe(res); else res.end();
  } catch (error) { console.error(error.message); if (!res.headersSent) json(res, { error: { code: 'FIXTURE_FAILURE' } }, 500); else res.end(); } });
  await new Promise(done => proxy.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  return { root, origin, ownerId, ids, requests, commands, credentials: { origin, username: 'Fe1bFixture', password }, async close() { proxy.closeAllConnections(); await new Promise(done => proxy.close(done)); await service.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const fixture = await startFe1bFixture();
  const loginPath = join(fixture.root, 'login.json'); await writeFile(loginPath, JSON.stringify(fixture.credentials));
  console.log(JSON.stringify({ root: fixture.root, port: Number(new URL(fixture.origin).port), loginPath }));
  process.stdin.resume(); process.stdin.on('data', async value => { if (String(value).trim() === 'q') { await fixture.close(); process.exit(0); } });
}

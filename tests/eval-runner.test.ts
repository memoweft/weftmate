import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { runEvaluation, loadScenarios, checkOne, parseArgs, safePath, validateScenario } from '../scripts/eval.mjs';

const scenario = (id, turns, checks, extra = {}) => ({ id, category: 'action', title: id,
  setup: { files: [{ path: 'input.txt', content: 'fixture' }], memories: [], devices: ['fake host'] },
  turns, checks, timeoutSec: 3, notes: 'isolated fixture', ...extra });

async function fakeHost(t, options = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'weftmate-eval-test-'));
  const calls = [], sessions = new Map(), commands = new Map(), timers = new Set(), accounts = new Map();
  const ownedScratch = new Set();
  let serial = 0;
  const schedule = (action, ms) => { const timer = setTimeout(() => { timers.delete(timer); action(); }, ms); timers.add(timer); };
  const event = (session, type, data) => {
    session.seq += 3; // Public cursors are not counts and need not be contiguous.
    session.events.push({ seq: session.seq, type, at: new Date().toISOString(), data });
  };
  const complete = (session, reason = 'completed') => {
    if (!session.running) return;
    event(session, 'assistant.message', { text: reason === 'blocked' ? '拒绝后保留' : '完成 49 小禾 周五 海报 买菜' });
    event(session, 'turn.ended', { reason, turn: session.turn });
    session.running = false;
  };
  const send = (session, body, cmd) => {
    session.turn++;
    session.running = true;
    session.root = cmd.commandId;
    event(session, 'user.message', { text: body.text });
    event(session, 'turn.started', { turn: session.turn });
    if (body.text.startsWith('write ')) {
      const dir = body.text.slice(6);
      ownedScratch.add(dir);
      schedule(() => { writeFile(join(dir, 'output.txt'), 'saved 49').then(() => complete(session)); }, 30);
    } else if (body.text === 'approve' || body.text === 'reject' || body.text === 'unexpected') {
      session.approvals.push({ approvalId: `00000000-0000-0000-0000-${String(serial).padStart(12, '0')}`,
        taskId: cmd.commandId, status: 'pending', toolName: 'shell', reason: 'delete test file' });
    } else if (body.text !== 'hang' && body.text !== 'stop me') schedule(() => complete(session), 30);
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.replace('/personal/v1', '');
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ path, method: req.method, body, query: Object.fromEntries(url.searchParams), headers: req.headers });
      const respond = (data, status = 200, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(data));
      };
      if (path === '/auth/state') return respond({ configured: false, registrationAvailable: true });
      if (path === '/auth/register' || path === '/auth/setup') {
        assert.equal(req.headers.origin, origin);
        assert.match(body.username, /^eval-/);
        assert.ok(body.password.length >= 15);
        if (path === '/auth/setup') assert.equal(body.grant, 'test-grant');
        accounts.set(body.username, body.password);
        return respond({ account: { username: body.username }, csrfToken: 'csrf' }, 201, { 'Set-Cookie': 'wm_personal_session=registered; Path=/personal/v1; HttpOnly' });
      }
      if (path === '/auth/login') {
        assert.equal(accounts.get(body.username), body.password);
        return respond({ account: { username: body.username }, csrfToken: 'csrf' }, 200, { 'Set-Cookie': 'wm_personal_session=logged-in; Path=/personal/v1; HttpOnly' });
      }
      assert.equal(req.headers.cookie, 'wm_personal_session=logged-in');
      if (req.method === 'POST') { assert.equal(req.headers.origin, origin); assert.equal(req.headers['x-weftmate-csrf'], 'csrf'); }
      if (path === '/status') return respond({ hostId: 'host-fake' });
      if (path === '/models') return respond({ models: [ { id: 'qwen', name: 'Qwen', model: 'fake-qwen', configured: true }, { id: 'mimo', name: 'MiMo', model: 'fake-mimo', configured: true } ] });
      if (path.endsWith('/chat/completions')) return respond({ choices: [{ message: { content: options.invalidJudge ? 'not json' : JSON.stringify({ pass: !options.judgeFail, reason: 'checked by fake judge' }) } }] });
      if (path === '/sessions') return respond({ sessions: [...sessions.keys()].map(sessionId => ({ sessionId, sendAvailable: true })) });
      if (path === '/commands') {
        const cmd = { ...body, commandId: `cmd-${++serial}`, state: options.rejectCommand && body.kind === 'session.message' ? 'rejected' : 'accepted_by_dsh' };
        if (body.kind === 'session.create') {
          cmd.sessionId = `session-${serial}`;
          sessions.set(cmd.sessionId, { events: [], approvals: [], seq: -1, turn: 0, running: false });
        }
        commands.set(cmd.commandId, cmd);
        if (body.kind === 'session.message' && cmd.state !== 'rejected') send(sessions.get(body.sessionId), body, cmd);
        if (body.kind === 'session.cancel') complete(sessions.get(body.sessionId), 'aborted');
        return respond({ command: cmd }, 202);
      }
      if (path.startsWith('/commands/')) return respond({ command: commands.get(path.split('/').at(-1)) });
      if (path.startsWith('/tasks/')) {
        if (options.noTasks) return respond({ error: { code: 'NOT_FOUND' } }, 404);
        const root = commands.get(path.split('/')[2]);
        const session = sessions.get(root.sessionId);
        if (path.endsWith('/stop')) { complete(session, 'aborted'); session.canResume = true; return respond({ task: { control: { canResume: true } } }, 202); }
        if (path.endsWith('/resume')) {
          assert.equal(session.canResume, true);
          const cmd = { ...root, commandId: `cmd-${++serial}`, text: body.text };
          commands.set(cmd.commandId, cmd);
          send(session, { text: 'resumed' }, cmd);
          return respond({ task: {}, command: cmd }, 202);
        }
        return respond({ control: { canResume: session.canResume ?? false } });
      }
      const id = path.split('/')[2], session = sessions.get(id);
      if (path.endsWith('/events')) {
        if (options.stallEvents) return; // Simulates a hung HTTP request, not just an empty event page.
        const after = Number(url.searchParams.get('afterSeq'));
        const available = session.events.filter(e => e.seq > after);
        const page = available.slice(0, 1);
        return respond({ events: page, nextSeq: page.at(-1)?.seq ?? after, hasMore: available.length > page.length });
      }
      if (path.endsWith('/approvals')) return respond({ approvals: session.approvals, hasMore: false, nextBefore: null });
      if (path.includes('/approvals/')) {
        const approval = session.approvals.find(a => a.approvalId === path.split('/').at(-1));
        assert.equal(approval.status, 'pending');
        assert.ok(['allowed-once', 'rejected'].includes(body.outcome));
        approval.status = 'answered'; approval.decisionOutcome = body.outcome;
        schedule(() => { approval.status = 'resolved'; complete(session, body.outcome === 'rejected' ? 'blocked' : 'completed'); }, 15);
        return respond({ approval, requestId: body.requestId });
      }
      respond({ error: { code: 'NOT_FOUND' } }, 404);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: error.message } }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections(); await new Promise(r => server.close(r));
    await rm(scratch, { recursive: true, force: true });
    for (const dir of ownedScratch) await rm(dir, { recursive: true, force: true });
  });
  const run = async (scenarioList, extra = {}) => {
    const report = await runEvaluation({ host: origin, out: join(scratch, `out-${serial}`), model: 'qwen', pollMs: 5, scenarioList, ...extra });
    for (const result of report.results) if (result.scratchDir) ownedScratch.add(result.scratchDir);
    return report;
  };
  return { run, calls, scratch, origin };
}

test('12 checked-in scenarios: 6 action, 4 memory, 2 manual; argument and schema validation', async () => {
  const scenarios = await loadScenarios('eval/scenarios/*.yaml');
  assert.equal(scenarios.length, 12);
  assert.equal(scenarios.filter(s => s.category === 'action').length, 6);
  assert.equal(scenarios.filter(s => s.category === 'memory').length, 4);
  assert.equal(scenarios.filter(s => s.manual && s.category === 'cross-device').length, 2);
  assert.equal((await loadScenarios('eval/scenarios/*.yaml', 'memory-03-switch-model')).length, 1);
  await assert.rejects(loadScenarios('eval/scenarios/*.yaml', 'missing'), /No scenarios/);
  assert.equal(parseArgs(['--host', 'http://localhost:1', '--only', 'x', '--model', 'mimo']).model, 'mimo');
  assert.throws(() => parseArgs(['--model']), /missing value/);
  assert.throws(() => validateScenario(scenario('bad', [{ user: 'hi', after: { model: 'mimo' } }], [])), /requires/);
});

test('register/login, create/send, cursor-based polling, file and reply checks, reports and local-only credentials', async t => {
  const host = await fakeHost(t);
  const out = join(host.scratch, 'results');
  const report = await host.run([scenario('files', [{ user: 'write {{testDir}}' }], [
    { type: 'file_exists', path: 'output.txt' }, { type: 'file_contains', path: 'output.txt', text: 'saved 49' },
    { type: 'file_absent', path: 'absent.txt' }, { type: 'reply_contains', text: '49' },
    { type: 'reply_matches', pattern: '完成.*49' }, { type: 'turn_status', status: 'completed' }, { type: 'llm_judge', prompt: 'completed' },
  ])], { out });
  assert.equal(report.results[0].status, 'passed');
  assert.equal(report.results[0].turns[0].reply, '完成 49 小禾 周五 海报 买菜');
  assert.equal(report.results[0].checks.at(-1).status, 'skipped');
  assert.equal(report.summary.passRate, 1);
  assert.ok(host.calls.some(c => c.path === '/auth/register'));
  assert.ok(host.calls.some(c => c.path === '/auth/login'));
  assert.ok(host.calls.some(c => c.query.afterSeq === '2'));
  assert.ok(host.calls.some(c => c.query.afterSeq === '5'));
  const credentials = JSON.parse(await readFile(join(out, 'credentials.json'), 'utf8'));
  const json = await readFile(join(out, 'results.json'), 'utf8');
  assert.ok(!json.includes(credentials.password));
  assert.match(await readFile(join(out, 'report.md'), 'utf8'), /全部场景通过覆盖率：1\/1/);
  assert.equal(await readFile(join(out, '.gitignore'), 'utf8'), '*\n');
  await host.run([scenario('again', [{ user: 'hello' }], [{ type: 'turn_status', status: 'completed' }])], { out });
  assert.equal(host.calls.filter(c => c.path === '/auth/register').length, 1);
  assert.equal(host.calls.filter(c => c.path === '/auth/login').length, 2);
});

test('approve and reject declared steps, separate per-turn snapshots; unexpected approval fails closed', async t => {
  const host = await fakeHost(t);
  const report = await host.run([
    scenario('decisions', [{ user: 'approve', approvals: [{ outcome: 'allowed-once', reasonMatches: 'delete' }] },
      { user: 'reject', approvals: [{ outcome: 'rejected' }] }], [
      { type: 'approval_seen', turn: 1, outcome: 'allowed-once' }, { type: 'turn_status', turn: 1, status: 'completed' },
      { type: 'approval_seen', turn: 2, outcome: 'rejected' }, { type: 'turn_status', turn: 2, status: ['blocked', 'aborted'] },
      { type: 'reply_contains', turn: 2, text: '保留' },
    ]), scenario('unexpected', [{ user: 'unexpected' }], []),
    scenario('approval-missing', [{ user: 'hello', approvals: [{ outcome: 'allowed-once' }] }], []),
  ]);
  assert.equal(report.results[0].status, 'passed');
  assert.equal(report.results[1].status, 'failed');
  assert.match(report.results[1].reason, /Unexpected approval/);
  assert.match(report.results[2].reason, /Expected approval was not observed/);
  assert.equal(host.calls.filter(c => c.path.includes('/approvals/') && c.method === 'POST').length, 2);
  assert.ok(host.calls.some(c => c.body?.kind === 'session.cancel'));
});

test('stop observes aborted, waits for resumability then resumes the root task', async t => {
  const host = await fakeHost(t);
  const report = await host.run([scenario('stop', [{ user: 'stop me', stopAfterMs: 5 }, { user: 'continue', resume: true }], [
    { type: 'turn_status', turn: 1, status: 'aborted' }, { type: 'file_absent', turn: 1, path: 'output.txt' },
    { type: 'turn_status', status: 'completed' },
  ])]);
  assert.equal(report.results[0].status, 'passed');
  assert.ok(host.calls.some(c => c.path.endsWith('/stop')));
  assert.ok(host.calls.some(c => c.path.endsWith('/resume')));
});

test('memory provenance unsupported, new session and model switch; manual scenes do not contact devices', async t => {
  const host = await fakeHost(t);
  const report = await host.run([scenario('memory', [{ user: 'remember', after: { newSession: true, model: '$alternate' } }, { user: 'hello' }], [
    { type: 'reply_contains', text: '小禾' }, { type: 'memory_used' }, { type: 'turn_status', status: 'completed' },
  ], { category: 'memory' }), scenario('cross', [{ user: 'manual' }], [], { category: 'cross-device', manual: true })]);
  assert.equal(report.results[0].status, 'unsupported');
  assert.match(report.results[0].reason, /no per-reply memory provenance/);
  assert.equal(report.results[0].turns[1].modelProfileId, 'mimo');
  assert.equal(report.results[1].status, 'manual');
  assert.equal(report.summary.passRate, null);
  assert.equal(report.summary.coverage, 0);
  assert.deepEqual(host.calls.filter(c => c.body?.kind === 'session.create').map(c => c.body.modelProfileId), ['qwen', 'mimo']);
});

test('judge defaults to the active model with same, supports selected profile, malformed/failing verdict fails', async t => {
  const host = await fakeHost(t);
  const s = scenario('judge', [{ user: 'hi' }], [{ type: 'llm_judge', prompt: 'Should complete' }]);
  assert.equal((await host.run([s], { judgeModel: 'same' })).results[0].status, 'passed');
  assert.equal((await host.run([s], { judgeModel: 'mimo' })).results[0].checks[0].judgeModel, 'mimo');
  const calls = host.calls.filter(c => c.path.endsWith('/chat/completions'));
  assert.equal(calls[0].body.model, 'fake-qwen'); assert.equal(calls[1].body.model, 'fake-mimo');
  const bad = await fakeHost(t, { invalidJudge: true });
  assert.equal((await bad.run([s], { judgeModel: 'same' })).results[0].status, 'failed');
  const fail = await fakeHost(t, { judgeFail: true });
  assert.equal((await fail.run([s], { judgeModel: 'same' })).results[0].status, 'failed');
});

test('empty event polling and hung HTTP both time out, cancellation is requested and the report survives', async t => {
  for (const stallEvents of [false, true]) {
    const host = await fakeHost(t, { stallEvents });
    const started = Date.now();
    const report = await host.run([scenario('timeout', [{ user: 'hang' }], [], { timeoutSec: 0.15 })]);
    assert.equal(report.results[0].status, 'failed'); assert.equal(report.results[0].timedOut, true);
    assert.match(report.results[0].reason, /timed out/);
    assert.ok(Date.now() - started < 2000);
    assert.ok(host.calls.some(c => c.body?.kind === 'session.cancel'));
  }
});

test('unavailable models/task controls unsupported; rejected commands fail instead of hanging', async t => {
  const host = await fakeHost(t);
  const missing = await host.run([scenario('missing', [{ user: 'hi' }], [])], { model: 'unconfigured' });
  assert.equal(missing.results[0].status, 'unsupported');
  const noTasks = await fakeHost(t, { noTasks: true });
  assert.equal((await noTasks.run([scenario('no-stop', [{ user: 'stop me', stopAfterMs: 1 }], [])])).results[0].status, 'unsupported');
  const rejected = await fakeHost(t, { rejectCommand: true });
  assert.match((await rejected.run([scenario('rejected', [{ user: 'hi' }], [])])).results[0].reason, /Message rejected/);
});

test('every deterministic check fails correctly; traversal and symlinks cannot read external files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-eval-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'present.txt'), 'actual');
  const context = { scratchDir: root, turns: [{ reply: 'actual reply', status: 'completed', approvals: [] }] };
  for (const check of [ { type: 'file_exists', path: 'missing' }, { type: 'file_absent', path: 'present.txt' },
    { type: 'file_contains', path: 'present.txt', text: 'wrong' }, { type: 'reply_contains', text: 'wrong' },
    { type: 'reply_matches', pattern: '^wrong$' }, { type: 'turn_status', status: 'aborted' }, { type: 'approval_seen' } ]) {
    assert.equal((await checkOne(check, context)).status, 'failed', check.type);
  }
  for (const path of ['../outside', '/etc/passwd', 'C:\\daily.txt', 'folder\\file']) assert.throws(() => safePath(root, path));
  // Windows 用 junction（目录联接点）覆盖同一拒绝分支，无需提升权限。
  const linkedTarget = process.platform === 'win32' ? join(root, 'linked-target') : join(root, 'present.txt');
  if (process.platform === 'win32') await mkdir(linkedTarget);
  await symlink(linkedTarget, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'file');
  assert.match((await checkOne({ type: 'file_contains', path: 'link', text: 'actual' }, context)).reason, /Symlink/);
  assert.equal((await checkOne({ type: 'file_absent', path: 'link' }, context)).status, 'failed');
});

test('isolated owner setup uses setup grant, only eval credentials can be reused', async t => {
  const host = await fakeHost(t);
  const setupFile = join(host.scratch, 'setup.json');
  await writeFile(setupFile, JSON.stringify({ url: `${host.origin}/personal/v1/ui#setup=test-grant` }));
  assert.equal((await host.run([scenario('owner', [{ user: 'hello' }], [])], { setupFile })).results[0].status, 'passed');
  assert.ok(host.calls.some(c => c.path === '/auth/setup'));
  const out = join(host.scratch, 'unsafe'); await mkdir(out);
  await writeFile(join(out, 'credentials.json'), JSON.stringify({ username: 'daily-owner', password: 'no', host: host.origin }));
  const report = await host.run([scenario('refuse', [{ user: 'hello' }], [])], { out });
  assert.match(report.results[0].reason, /eval- account/);
  assert.equal(host.calls.filter(c => c.path === '/auth/login').length, 1);
});

test('CLI glob and --only generate a manual report without any host connection', async t => {
  const out = await mkdtemp(join(tmpdir(), 'weftmate-eval-cli-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['scripts/eval.mjs', '--host', 'http://127.0.0.1:1', '--scenarios', 'eval/scenarios/*.yaml', '--only', 'cross-01-desktop-approval', '--out', out], { cwd: resolve('.') });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, output);
  const report = JSON.parse(await readFile(join(out, 'results.json'), 'utf8'));
  assert.equal(report.summary.manual, 1);
  assert.equal(report.summary.passRate, null);
  assert.match(await readFile(join(out, 'report.md'), 'utf8'), /需人工/);
});

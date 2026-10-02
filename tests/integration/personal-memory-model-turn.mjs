/** Opt-in real DSH account-memory turn acceptance; follows one already-loaded formal local model. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { listFormalLocalModels, readUserModelSwitcherKey } from '../../src/local-model-config.mjs';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_MEMORY_MODEL_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_MEMORY_MODEL_E2E=1 only after confirming the 8081 model window.');
}
const controlOnly = process.env.WEFTMATE_MEMORY_CONTROL_ONLY === '1';
const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const python = 'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe';
const pythonPath = 'D:/AIProjects/MemoWeft/Core/py/src';
if (!existsSync(python)) throw new Error('MemoWeft Core Python runtime is unavailable');
const formalIds = new Set((await listFormalLocalModels()).map((item) => item.modelId));
assert.equal(formalIds.size, 9, 'formal local catalog must contain the nine host-managed profiles');
const execFileAsync = promisify(execFile);
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
async function modelPid() {
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = '(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess';
  const { stdout } = await execFileAsync(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 10_000,
    env: { ...process.env, PSModulePath: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') },
  });
  const value = Number(stdout.trim());
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('loaded model PID is unavailable');
  return value;
}
const switcherKey = await readUserModelSwitcherKey();
async function modelStatus(waitForIdle = false) {
  const deadline = Date.now() + (waitForIdle ? 30_000 : 1);
  do {
    const response = await fetch('http://127.0.0.1:8081/switch/status', {
      headers: { authorization: `Bearer ${switcherKey}` }, signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) throw new Error('ModelSwitcher status unavailable');
    const value = await response.json();
    if (!formalIds.has(value.currentModelId) || value.switching === true ||
        value.probe?.health !== true) throw new Error('one formal catalog model was not kept loaded and healthy');
    if (value.activeLeases === 0 && value.queuedLeases === 0 && value.maintenanceQueued === 0) {
      return { currentModelId: value.currentModelId, lastSwitch: JSON.stringify(value.lastSwitch ?? null),
        pid: await modelPid() };
    }
    if (!waitForIdle) throw new Error('ModelSwitcher is busy before the isolated test');
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error('ModelSwitcher remained busy after the isolated test');
}
const modelBefore = await modelStatus();
const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-model-turn-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
const config = join(root, 'memory-config.json');
const hostStateFile = join(profile, 'dsh-home', 'weftmate-host-state.json');
const memoryIpc = () => {
  const value = JSON.parse(readFileSync(hostStateFile, 'utf8')).accountMemoryIpc;
  assert.ok(value && Number.isSafeInteger(value.recallAttempts) &&
    Number.isSafeInteger(value.rejectedBindings) && Number.isSafeInteger(value.recallRequests) &&
    Number.isSafeInteger(value.recallWithContext) && Number.isSafeInteger(value.ingestRequests));
  return value;
};
const finiteCodes = ['MEMORY_TIMEOUT', 'MEMORY_UNAVAILABLE', 'MEMORY_OWNER_UNAVAILABLE',
  'MEMORY_DESTINATION_BLOCKED', 'MODEL_UNAVAILABLE', 'UPSTREAM_HTTP_ERROR',
  'API_ERROR', 'NETWORK_ERROR', 'STREAM_ERROR', 'CONTEXT_LENGTH_EXCEEDED'];
const finiteCode = (value) => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return finiteCodes.find((code) => new RegExp(`\\b${code}\\b`).test(raw)) ?? 'unclassified';
};
const responseClass = (value) => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (/text\/event-stream|data:\s*\[DONE\]|chat\.completion\.chunk/i.test(raw)) return 'openai_stream';
  if (/chat\.completion|choices.{0,80}message/i.test(raw)) return 'openai_completion';
  if (/UPSTREAM_HTTP_ERROR|HTTP [45]\d\d|status.?[45]\d\d/i.test(raw)) return 'http_error';
  if (/Unexpected token|invalid json|parse error/i.test(raw)) return 'parse_error';
  return 'unclassified';
};
function diagnosticSnapshot(ended, events) {
  const allowedTypes = ['turn.started', 'turn.ended', 'user.message', 'assistant.message', 'error'];
  const eventTypes = Object.fromEntries(allowedTypes.map((type) => [type,
    events.filter((event) => event.type === type).length]));
  const errorCodes = events.filter((event) => event.type === 'error').map((event) =>
    finiteCode(event.data?.errorCode ?? event.data?.code));
  return { terminalReasonKind: ['completed', 'aborted', 'error', 'blocked'].includes(ended?.data?.reason)
    ? ended.data.reason : 'unavailable', terminalErrorCode: finiteCode(ended?.data?.errorCode ?? ended?.data?.code),
    projectedTerminalFields: ['reason', 'errorCode', 'code'].filter((key) => Object.hasOwn(ended?.data ?? {}, key)),
    eventTypes, errorCodes, outputErrorCode: finiteCode(output),
    accountMemoryIpc: controlOnly ? 'disabled' : memoryIpc(),
    modelResponseClass: responseClass(output) };
}
function archivedTerminalFacts() {
  const rootDir = join(profile, 'dsh-home', 'sessions');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name === 'session.jsonl.zstd'
      ? [join(dir, entry.name)] : []);
  try {
    const facts = [];
    for (const archive of walk(rootDir)) {
      const lines = zstdDecompressSync(readFileSync(archive)).toString('utf8').split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type !== 'turn/end') continue;
        const reason = event.data?.reason;
        facts.push({ kind: ['completed', 'aborted', 'error', 'blocked'].includes(reason?.kind)
          ? reason.kind : 'unclassified', errorCode: finiteCode(reason),
        modelResponseClass: responseClass(reason) });
      }
    }
    return facts.slice(-4);
  } catch { return [{ kind: 'archive_unavailable' }]; }
}
if (!controlOnly) writeFileSync(config, JSON.stringify({ python, pythonPath, baseUrl: 'http://127.0.0.1:8081/v1',
  model: '@current', authRef: 'personal-local-occamy-miniplus-v21' }));
const child = spawn(process.execPath, [join(repository, 'scripts', 'run-personal-host.mjs'),
  '--user-data-dir', profile, '--access-port', '0',
  ...(!controlOnly ? ['--personal-memory-config', config] : [])], {
  cwd: repository, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  env: { ...process.env },
});
let output = '';
let completed = false;
for (const stream of [child.stdout, child.stderr]) stream.on('data', (part) => {
  output = (output + String(part)).slice(-128 * 1024);
});
async function waitFor(pattern, startAt = 0, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = pattern.exec(output.slice(startAt));
    if (match) return match;
    const failed = /management failed code=([A-Z_]+)/.exec(output.slice(startAt));
    if (failed) throw new Error(`isolated management failed: ${failed[1]}`);
    if (child.exitCode !== null) throw new Error('isolated host exited');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('isolated host readiness timeout');
}
async function stop() {
  if (child.exitCode !== null) return child.exitCode === 0;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.stdin.write('q\n');
  const managed = await Promise.race([closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 20_000))]);
  if (!managed && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => killer.once('close', resolve));
    await closed;
  }
  return child.exitCode === 0;
}
async function register(origin, username) {
  const response = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'synthetic memory model password 123', deviceName: 'Fixture' }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  return { ownerId: body.account.ownerId, csrf: body.csrfToken,
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function get(origin, account, path) {
  const response = await fetch(`${origin}${path}`, { headers: { cookie: account.cookie } });
  assert.equal(response.status, 200, `read failed at ${path}`);
  return response.json();
}
async function coreRecall(ownerId, query, itemId, color) {
  const db = join(profile, 'personal-access', 'accounts', ownerId, 'memory-home',
    'memoweft', 'memoweft.sqlite3');
  const code = `import hashlib,json,sys
from memoweft.integrations.trust.query_service import QueryService
value=QueryService(sys.argv[1],subject_id=sys.argv[2]).preview_recall(sys.argv[3])
preview=value['preview']
rendered=preview['rendered_recall']
print(json.dumps({'worldRevision':value['world_revision'],
  'selectedTarget':['cognition',sys.argv[4]] in preview['selected_item_ids'],
  'renderedColor':sys.argv[5] in rendered,
  'selectedCount':len(preview['selected_item_ids']),
  'renderedDigest':hashlib.sha256(rendered.encode('utf-8')).hexdigest()[:12]}))`;
  const { stdout } = await execFileAsync(python, ['-c', code, db, ownerId, query, itemId, color], {
    windowsHide: true, timeout: 15_000, env: { ...process.env, PYTHONPATH: pythonPath },
  });
  const result = JSON.parse(stdout.trim());
  assert.ok(Number.isSafeInteger(result.worldRevision) &&
    typeof result.selectedTarget === 'boolean' && typeof result.renderedColor === 'boolean' &&
    Number.isSafeInteger(result.selectedCount) && /^[a-f0-9]{12}$/.test(result.renderedDigest));
  return result;
}
async function memoryAction(origin, account, itemId, action, expectedWorldRevision, text) {
  const requestId = randomUUID();
  const response = await fetch(`${origin}/personal/v1/memory/items/cognition/${itemId}/${action}`, {
    method: 'POST', headers: { origin, cookie: account.cookie, 'x-weftmate-csrf': account.csrf,
      'content-type': 'application/json' },
    body: JSON.stringify({ requestId, expectedWorldRevision, ...(text ? { text } : {}) }),
    signal: AbortSignal.timeout(40_000),
  });
  assert.equal(response.status, 200, `${action} must be accepted by Core`);
  const { receipt } = await response.json();
  assert.equal(receipt.requestId, requestId);
  assert.equal(receipt.state, 'applied', `${action} must change the current cognition`);
  assert.ok(receipt.worldRevision > expectedWorldRevision);
  return receipt;
}
async function post(origin, account, body) {
  const response = await fetch(`${origin}/personal/v1/commands`, { method: 'POST',
    headers: { origin, cookie: account.cookie, 'x-weftmate-csrf': account.csrf,
      'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 202);
  return (await response.json()).command;
}
async function settle(origin, account, commandId, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { command } = await get(origin, account, `/personal/v1/commands/${commandId}`);
    if (!['pending', 'dispatching'].includes(command.state)) {
      assert.equal(command.state, 'accepted_by_dsh');
      return command;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('DSH command receipt timeout');
}
async function create(origin, account, hostId, profileId) {
  const command = await post(origin, account, { requestId: randomUUID(), kind: 'session.create',
    targetDeviceId: hostId, modelProfileId: profileId });
  return (await settle(origin, account, command.commandId)).sessionId;
}
async function turn(origin, account, hostId, sessionId, text) {
  const command = await post(origin, account, { requestId: randomUUID(), kind: 'session.message',
    targetDeviceId: hostId, sessionId, text, mode: 'queue' });
  await settle(origin, account, command.commandId);
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    let afterSeq = -1;
    const events = [];
    for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
      const page = await get(origin, account,
        `/personal/v1/sessions/${sessionId}/events?afterSeq=${afterSeq}&limit=200`);
      events.push(...page.events);
      if (!page.hasMore) break;
      if (page.nextSeq <= afterSeq || pageIndex === 9) throw new Error('DSH history exceeded bounded acceptance window');
      afterSeq = page.nextSeq;
    }
    const ended = events.filter((event) => event.type === 'turn.ended').at(-1);
    if (ended) {
      if (['aborted', 'error', 'blocked'].includes(ended.data.reason)) {
        console.error('[personal-memory-model-turn] diagnostic ' + JSON.stringify(diagnosticSnapshot(ended, events)));
      }
      assert.ok(!['aborted', 'error', 'blocked'].includes(ended.data.reason),
        'model turn must end without tools or errors');
      const text = events.filter((event) => event.type === 'assistant.message')
        .map((event) => event.data.text).join(' ').slice(0, 512);
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('DSH turn did not finish within the bounded window');
}
try {
  const origin = (await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/))[1];
  const position = output.length;
  child.stdin.write('{"action":"model.configure-local-catalog"}\n');
  const catalog = await waitFor(/localCatalog count=9 added=(\d+) reused=(\d+) reloads=(\d+) verification=catalog_only inferenceVerified=false/, position);
  assert.equal(Number(catalog[1]) + Number(catalog[2]), 9);
  const pluginPatch = readFileSync(join(profile, 'dsh-home', 'profiles', 'weftmate', 'cordis.patch.yml'), 'utf8');
  assert.equal(pluginPatch.match(/id: weftmate-personal-memory/g)?.length ?? 0, 1,
    'the real DSH composition must load account memory exactly once');
  assert.equal(existsSync(join(profile, 'dsh-home', 'profiles', 'weftmate', 'plugins',
    'weftmate-personal-memory.mjs')), true);
  if (controlOnly) assert.equal(JSON.parse(readFileSync(hostStateFile, 'utf8')).accountMemoryIpc,
    undefined, 'control host must keep account memory disabled');
  const [a, b] = await Promise.all([register(origin, 'SyntheticMemoryModelA'),
    register(origin, 'SyntheticMemoryModelB')]);
  const status = await get(origin, a, '/personal/v1/status');
  assert.equal((await get(origin, b, '/personal/v1/status')).ownerId, b.ownerId);
  const profileId = `personal-local-${modelBefore.currentModelId}`;
  const aFirst = await create(origin, a, status.hostId, profileId);
  if (controlOnly) {
    const reply = await turn(origin, a, status.hostId, aFirst,
      '这是合成记忆验收。我喜欢合成蓝色茶杯。请只简短回复收到，不调用工具。');
    assert.ok(reply.length > 0 && reply.length <= 512);
    const modelAfter = await modelStatus(true);
    assert.deepEqual(modelAfter, modelBefore, 'control turn must preserve the loaded model');
    console.log('[personal-memory-model-turn] control completed with account memory disabled; model unchanged');
    completed = true;
  } else {
  const ipcBefore = memoryIpc();
  const firstReply = await turn(origin, a, status.hostId, aFirst,
    '这是合成记忆验收。我喜欢合成蓝色茶杯。请只简短回复收到，不调用工具。');
  assert.ok(firstReply.length > 0 && firstReply.length <= 512);
  const afterFirst = memoryIpc();
  assert.ok(afterFirst.recallAttempts > ipcBefore.recallAttempts,
    'actual DSH pre-step must send a recall attempt over IPC');
  assert.ok(afterFirst.recallRequests > ipcBefore.recallRequests &&
    afterFirst.rejectedBindings === ipcBefore.rejectedBindings,
    'actual DSH pre-step must reach the owner-bound main IPC');
  const ingestionDeadline = Date.now() + 20_000;
  while (memoryIpc().ingestRequests <= ipcBefore.ingestRequests && Date.now() < ingestionDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(memoryIpc().ingestRequests > ipcBefore.ingestRequests,
    'actual DSH completed turn must reach the owner-bound ingest IPC');
  let formed;
  const worldDeadline = Date.now() + 150_000;
  while (Date.now() < worldDeadline) {
    const { items } = await get(origin, a, '/personal/v1/memory/items?kind=cognition&query=合成蓝色茶杯');
    formed = items.find((item) => item.currentState === 'current' &&
      item.text.includes('合成蓝色茶杯'));
    if (formed) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(formed, 'real Core worker must form A memory before the new turn');
  const aNext = await create(origin, a, status.hostId, profileId);
  const bNext = await create(origin, b, status.hostId, profileId);
  const beforeRecall = memoryIpc();
  const question = '请从本次会话可用的账户记忆中找出我喜欢的合成茶杯颜色，只回答颜色的两个汉字；若没有相关记忆，只回答未知。不调用工具。';
  const firstCoreRecall = await coreRecall(a.ownerId, question, formed.id, '合成蓝色茶杯');
  if (!firstCoreRecall.selectedTarget || !firstCoreRecall.renderedColor) {
    console.error('[personal-memory-model-turn] initial-core-recall ' + JSON.stringify(firstCoreRecall));
  }
  assert.ok(firstCoreRecall.selectedTarget && firstCoreRecall.renderedColor,
    'Core preview must select and render the formed A cognition for the exact DSH question');
  const aReply = await turn(origin, a, status.hostId, aNext, question);
  const afterA = memoryIpc();
  assert.ok(afterA.recallWithContext > beforeRecall.recallWithContext,
    'A new DSH pre-step must receive nonempty owner-scoped memory context');
  const bReply = await turn(origin, b, status.hostId, bNext, question);
  const afterB = memoryIpc();
  assert.ok(afterB.recallRequests > afterA.recallRequests);
  assert.equal(afterB.recallWithContext, afterA.recallWithContext,
    'B pre-step must not receive A context');
  const bCoreRecall = await coreRecall(b.ownerId, question, formed.id, '合成蓝色茶杯');
  assert.equal(bCoreRecall.selectedTarget, false, 'B Core preview must not select A cognition');
  assert.equal(bCoreRecall.renderedColor, false, 'B Core preview must not render A preference');
  if (!/蓝色/.test(aReply)) console.error('[personal-memory-model-turn] initial-answer ' +
    JSON.stringify({ coreSelected: firstCoreRecall.selectedTarget,
      coreRenderedColor: firstCoreRecall.renderedColor, hostContext: afterA.recallWithContext > beforeRecall.recallWithContext,
      answerClass: aReply.includes('未知') ? 'unknown' : 'other' }));
  assert.ok(/蓝色/.test(aReply), 'A new DSH turn should use its own account memory');
  assert.equal(bReply.includes('蓝色'), false, 'B must not receive A account memory');
  assert.equal((await get(origin, b, '/personal/v1/memory/items?kind=cognition&query=合成蓝色茶杯')).items.length, 0);
  const originalPath = `/personal/v1/memory/items/cognition/${formed.id}`;
  const original = await get(origin, a, originalPath);
  assert.equal(original.item.currentState, 'current');
  assert.equal(original.availableActions.correct.available, true);
  const corrected = await memoryAction(origin, a, formed.id, 'correct',
    original.worldRevision, '我喜欢合成紫色茶杯。');
  let replacement;
  const correctionDeadline = Date.now() + 20_000;
  while (Date.now() < correctionDeadline) {
    const { items, worldRevision } = await get(origin, a,
      '/personal/v1/memory/items?kind=cognition&query=合成紫色茶杯');
    replacement = items.find((item) => item.currentState === 'current' && item.id !== formed.id &&
      item.text.includes('合成紫色茶杯'));
    if (replacement && worldRevision >= corrected.worldRevision &&
        (await get(origin, a, originalPath)).item.currentState === 'not_current') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(replacement, 'Core must expose the corrected current cognition');
  assert.equal((await get(origin, a, originalPath)).item.currentState, 'not_current',
    'the original cognition must be superseded');
  assert.equal((await get(origin, a,
    '/personal/v1/memory/items?kind=cognition&query=合成蓝色茶杯')).items.some((item) =>
      item.currentState === 'current'), false, 'no old-color cognition may remain current');
  const correctedSession = await create(origin, a, status.hostId, profileId);
  const correctedCoreRecall = await coreRecall(a.ownerId, question, replacement.id, '合成紫色茶杯');
  if (!correctedCoreRecall.selectedTarget || !correctedCoreRecall.renderedColor) {
    console.error('[personal-memory-model-turn] corrected-core-recall ' + JSON.stringify(correctedCoreRecall));
  }
  assert.ok(correctedCoreRecall.selectedTarget && correctedCoreRecall.renderedColor,
    'Core preview must select and render the corrected cognition');
  const beforeCorrectedRecall = memoryIpc();
  const correctedReply = await turn(origin, a, status.hostId, correctedSession, question);
  const afterCorrectedRecall = memoryIpc();
  assert.ok(afterCorrectedRecall.recallWithContext > beforeCorrectedRecall.recallWithContext,
    'A new DSH pre-step must receive nonempty corrected memory context');
  assert.ok(/紫色/.test(correctedReply), 'A new turn must use the corrected preference');
  assert.equal(correctedReply.includes('蓝色'), false,
    'A new turn must not reuse the superseded preference');
  const replacementPath = `/personal/v1/memory/items/cognition/${replacement.id}`;
  const currentReplacement = await get(origin, a, replacementPath);
  assert.equal(currentReplacement.item.currentState, 'current');
  assert.equal(currentReplacement.availableActions.mute.available, true);
  const muted = await memoryAction(origin, a, replacement.id, 'mute',
    currentReplacement.worldRevision);
  const muteDeadline = Date.now() + 20_000;
  let mutedDetail;
  while (Date.now() < muteDeadline) {
    mutedDetail = await get(origin, a, replacementPath);
    if (mutedDetail.worldRevision >= muted.worldRevision &&
        mutedDetail.item.currentState === 'not_current' && mutedDetail.item.lifecycle.mutedAt) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(mutedDetail?.item.currentState, 'not_current',
    'Core must stop exposing the corrected cognition as current');
  assert.ok(mutedDetail.item.lifecycle.mutedAt, 'Core must persist the mute state');
  assert.equal((await get(origin, a,
    '/personal/v1/memory/items?kind=cognition&query=合成紫色茶杯')).items.some((item) =>
      item.currentState === 'current'), false, 'no corrected-color cognition may remain current');
  const mutedCoreRecall = await coreRecall(a.ownerId, question, replacement.id, '合成紫色茶杯');
  assert.equal(mutedCoreRecall.selectedTarget, false,
    'Core preview must no longer select the muted cognition');
  assert.equal(mutedCoreRecall.renderedColor, false,
    'Core preview must not render the muted preference');
  const mutedSession = await create(origin, a, status.hostId, profileId);
  const beforeMutedRecall = memoryIpc();
  const mutedReply = await turn(origin, a, status.hostId, mutedSession, question);
  const afterMutedRecall = memoryIpc();
  assert.ok(afterMutedRecall.recallRequests > beforeMutedRecall.recallRequests);
  assert.equal(afterMutedRecall.recallWithContext, beforeMutedRecall.recallWithContext,
    'A fresh DSH pre-step must not inject the muted synthetic preference');
  assert.equal(/蓝色|紫色/.test(mutedReply), false,
    'A new turn must not answer from the superseded or muted cognition');
  const bAfterMuteSession = await create(origin, b, status.hostId, profileId);
  const beforeBAfterMute = memoryIpc();
  const bAfterMuteReply = await turn(origin, b, status.hostId, bAfterMuteSession, question);
  const afterBAfterMute = memoryIpc();
  assert.ok(afterBAfterMute.recallRequests > beforeBAfterMute.recallRequests);
  assert.equal(afterBAfterMute.recallWithContext, beforeBAfterMute.recallWithContext,
    'B still must not receive A memory context after correction and mute');
  const bAfterMuteCoreRecall = await coreRecall(b.ownerId, question, replacement.id, '合成紫色茶杯');
  assert.equal(bAfterMuteCoreRecall.selectedTarget, false);
  assert.equal(bAfterMuteCoreRecall.renderedColor, false);
  assert.equal(/蓝色|紫色/.test(bAfterMuteReply), false);
  assert.equal((await get(origin, b,
    '/personal/v1/memory/items?kind=cognition&query=合成紫色茶杯')).items.length, 0);
  const modelAfter = await modelStatus(true);
  assert.deepEqual(modelAfter, modelBefore, 'the loaded model PID and last switch must stay unchanged');
  console.log(`[personal-memory-model-turn] model=${modelAfter.currentModelId} DSH-presteps=${afterBAfterMute.recallRequests - ipcBefore.recallRequests} ` +
    `nonempty-contexts=${afterBAfterMute.recallWithContext - ipcBefore.recallWithContext} ingests=${afterBAfterMute.ingestRequests - ipcBefore.ingestRequests} ` +
    'A formed/recalled/corrected/muted synthetic memory; B isolated; model PID and last switch unchanged');
  completed = true;
  }
} finally {
  const clean = await stop();
  if (!completed) {
    console.error('[personal-memory-model-turn] archived-terminal ' + JSON.stringify(archivedTerminalFacts()));
  }
  if (clean && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
    rmSync(root, { recursive: true, force: true });
  }
  if (!completed) console.error('[personal-memory-model-turn] incomplete; isolated profile kept only if managed shutdown failed');
  assert.equal(clean, true, 'isolated personal host must exit cleanly');
}

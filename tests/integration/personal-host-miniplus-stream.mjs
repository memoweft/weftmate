/** Explicit, managed, one-turn MiniPlus acceptance through the authenticated personal host. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.env.WEFTMATE_REAL_HOST_STREAM_E2E !== '1') {
  throw new Error('Set WEFTMATE_REAL_HOST_STREAM_E2E=1 on Windows after confirming 8081 is idle.');
}

const repository = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'weftmate-miniplus-stream-'));
assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir()) + sep));
const profile = join(root, 'profile');
const launcher = join(repository, 'scripts', 'run-personal-host.mjs');
const child = spawn(process.execPath, [launcher, '--user-data-dir', profile, '--access-port', '0'], {
  cwd: repository, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
let completed = false;
let cleanExit = false;
let launchError = null;
child.on('error', (error) => { launchError = error; });
for (const stream of [child.stdout, child.stderr]) stream.on('data', (part) => {
  output = (output + String(part)).slice(-128 * 1024);
});

async function waitFor(pattern, startAt = 0, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = pattern.exec(output.slice(startAt));
    if (match) return match;
    const managementFailure = /management failed code=([A-Z_]+)/.exec(output.slice(startAt));
    if (managementFailure) throw new Error(`isolated management failed code=${managementFailure[1]}`);
    if (launchError) throw new Error('isolated host could not launch');
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('isolated host exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('isolated host readiness timed out');
}

async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) {
    cleanExit = child.exitCode === 0;
    return;
  }
  const closed = new Promise((resolve) => child.once('close', resolve));
  try { child.stdin.write('q\n'); child.stdin.end(); } catch { /* Exact-tree stop below still applies. */ }
  let managedTimer;
  const managed = await Promise.race([closed.then(() => true),
    new Promise((resolve) => { managedTimer = setTimeout(() => resolve(false), 20_000); })]);
  clearTimeout(managedTimer);
  if (!managed && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    });
    await new Promise((resolve) => killer.once('close', resolve));
    let forceTimer;
    try {
      await Promise.race([closed, new Promise((_, reject) => { forceTimer = setTimeout(() =>
        reject(new Error('owned process tree could not be closed')), 5_000); })]);
    } finally { clearTimeout(forceTimer); }
  }
  cleanExit = child.exitCode === 0;
  if (!cleanExit) throw new Error('isolated host did not finish managed shutdown');
}

function collectStream(response) {
  if (!response.body) throw new Error('model stream body missing');
  return (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    let reply = '';
    let contentDeltas = 0;
    let reasoningFrames = 0;
    let toolCalls = 0;
    let finishReason = null;
    let done = false;
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) throw new Error('model stream exceeded the acceptance limit');
      buffer += decoder.decode(chunk, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') { done = true; continue; }
        if (done) throw new Error('data arrived after the final marker');
        let value;
        try { value = JSON.parse(data); } catch { throw new Error('invalid model SSE frame'); }
        if (value?.error) throw new Error('model reported a stream error');
        const choice = value?.choices?.[0];
        if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
        if (typeof choice?.delta?.reasoning_content === 'string' && choice.delta.reasoning_content) reasoningFrames++;
        if (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length) toolCalls += choice.delta.tool_calls.length;
        if (typeof choice?.delta?.content === 'string' && choice.delta.content) {
          contentDeltas++;
          reply += choice.delta.content;
          if (reply.length > 512) throw new Error('model reply exceeded the acceptance limit');
        }
      }
      if (buffer.length > 256 * 1024) throw new Error('incomplete model SSE frame exceeded limit');
    }
    if (buffer.trim() || !done || contentDeltas < 1 || toolCalls !== 0 ||
        (finishReason !== null && finishReason !== 'stop')) {
      throw new Error('stream did not finish with user-visible content and no tool calls');
    }
    const publicReply = reply.replace(/\s+/g, ' ').trim();
    if (!/^[“"']?合成验收通过[。.!！]?[”"']?$/u.test(publicReply)) {
      throw new Error('model reply differed from the bounded synthetic acceptance phrase');
    }
    return { contentDeltas, reasoningFrames, finishReason, done, toolCalls, publicReply: '合成验收通过' };
  })();
}

try {
  const origin = (await waitFor(/personal-access listening origin=(http:\/\/127\.0\.0\.1:\d+)/))[1];
  const prior = output.length;
  child.stdin.write('{"action":"model.configure-local-catalog"}\n');
  const catalog = await waitFor(/localCatalog count=9 added=(\d+) reused=(\d+) reloads=(\d+) verification=catalog_only inferenceVerified=false/, prior);
  assert.equal(Number(catalog[1]) + Number(catalog[2]), 9);
  assert.equal(Number(catalog[3]), 1, 'the new isolated profile reloads DSH once');

  const registered = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'SyntheticStreamOwner', password: 'synthetic acceptance passphrase 2026',
      deviceName: 'Isolated stream acceptance' }),
  });
  if (registered.status !== 201) throw new Error(`synthetic registration failed (${registered.status})`);
  const auth = await registered.json();
  const cookie = registered.headers.get('set-cookie')?.split(';')[0];
  if (!cookie || typeof auth?.csrfToken !== 'string' || typeof auth?.account?.ownerId !== 'string') {
    throw new Error('synthetic account receipt was incomplete');
  }
  const statusReply = await fetch(`${origin}/personal/v1/status`, { headers: { cookie } });
  if (statusReply.status !== 200) throw new Error('synthetic status unavailable');
  const status = await statusReply.json();
  assert.equal(status.ownerId, auth.account.ownerId);
  const modelsReply = await fetch(`${origin}/personal/v1/models`, { headers: { cookie } });
  if (modelsReply.status !== 200) throw new Error('authenticated model catalog unavailable');
  const models = (await modelsReply.json()).models;
  const selected = models.find((item) => item.id === 'personal-local-occamy-miniplus-v21');
  if (!selected?.configured || selected.model !== 'occamy-miniplus-v21') {
    throw new Error('formal MiniPlus profile is not available to the synthetic account');
  }

  const controller = new AbortController();
  let deadlineReached = false;
  const deadline = setTimeout(() => { deadlineReached = true; controller.abort(); }, 310_000);
  let result;
  try {
    const response = await fetch(`${origin}/personal/v1/models/${selected.id}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken,
        'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ model: selected.model, stream: true,
        messages: [{ role: 'user', content: '这是合成验收。不要调用工具或访问资料，只回复：合成验收通过。' }] }),
    });
    if (response.status !== 200 || !/^text\/event-stream/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error(`authenticated model stream refused (${response.status})`);
    }
    result = await collectStream(response);
  } catch (error) {
    console.error(`[host-stream] completion=not-observed cancellation=${deadlineReached ? 'deadline' : 'not-requested'}`);
    throw error;
  } finally { clearTimeout(deadline); controller.abort(); }
  console.log(`[host-stream] model=${selected.model} contentDeltas=${result.contentDeltas} reasoningFrames=${result.reasoningFrames} ` +
    `finishReason=${result.finishReason ?? 'absent'} done=${result.done} toolCalls=${result.toolCalls} ` +
    `cancellation=not-requested reply=${JSON.stringify(result.publicReply)}`);
  completed = true;
} finally {
  try { await stop(); }
  finally {
    if (cleanExit && realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
      rmSync(root, { recursive: true, force: true });
    }
    if (!completed) console.error('[host-stream] result=incomplete; no model content or credential was printed');
  }
}

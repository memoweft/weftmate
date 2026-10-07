/** One bounded, synthetic NInfer request for an explicitly managed maintenance window. */
import { lstat, open, realpath } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ACCEPTANCE_ROOT = path.resolve(HERE,
  '../../../Runtime/UnifiedAssistant/Stage14R3Acceptance-20261004');
const MODEL = 'qwen3.8-27b';
const PATH = '/v1/chat/completions';
const MAX_FRAME_CHARS = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_FRAMES = 512;
const TIMEOUT_MS = 90_000;
const FINISH_REASONS = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'function_call']);

const TOOLS = Object.freeze(Array.from({ length: 7 }, (_, index) => ({
  type: 'function', function: { name: `synthetic_probe_${index + 1}`,
    description: 'Synthetic bounded microbenchmark function; no external action is available.',
    parameters: { type: 'object', properties: { marker: { type: 'string' } },
      additionalProperties: false },
  },
})));
const PAYLOAD = Object.freeze({ model: MODEL,
  messages: [
    { role: 'system', content: 'This is a synthetic local throughput check. Give a short answer.' },
    { role: 'user', content: 'Reply with READY. Do not request an external action.' },
  ],
  tools: TOOLS, tool_choice: 'auto', reasoning_effort: 'low',
  temperature: 1, top_p: 0.95, top_k: 20, seed: 140314,
  max_tokens: 64, stream: true, stream_options: { include_usage: true },
});
const BODY = Buffer.from(JSON.stringify(PAYLOAD), 'utf8');

function stamp() { return new Date().toISOString(); }
function safeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  const pick = (name, target) => {
    const number = value[name];
    if (Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000)
      result[target] = number;
  };
  pick('prompt_tokens', 'promptTokens');
  pick('completion_tokens', 'completionTokens');
  pick('total_tokens', 'totalTokens');
  const cached = value.prompt_tokens_details?.cached_tokens;
  if (Number.isSafeInteger(cached) && cached >= 0 && cached <= 1_000_000)
    result.cachedPromptTokens = cached;
  const reasoning = value.completion_tokens_details?.reasoning_tokens;
  if (Number.isSafeInteger(reasoning) && reasoning >= 0 && reasoning <= 1_000_000)
    result.reasoningTokens = reasoning;
  return Object.keys(result).length ? result : null;
}
function frameError(code) { return Object.assign(new Error(code), { safeCode: code }); }

/** Tests may choose an ephemeral local port; the destination host, path and model never vary. */
export function runMicroOnce(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some((key) => !['port', 'mode', 'timeoutMs', 'signal'].includes(key)))
    throw new Error('INVALID_MICRO_CONFIGURATION');
  const { port = 8080, mode, timeoutMs = TIMEOUT_MS, signal } = options;
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !['mtp3', 'no-spec'].includes(mode) || !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 || timeoutMs > TIMEOUT_MS ||
      (port === 8080 && process.env.WEFTMATE_STAGE14R3_MICRO !== '1') ||
      (signal !== undefined && !(signal instanceof AbortSignal)))
    throw new Error('INVALID_MICRO_CONFIGURATION');
  const started = performance.now();
  const result = {
    schemaVersion: 1, kind: 'stage14r3-ninfer-micro', scope: 'micro_only', mode,
    status: 'failed', httpStatus: null, errorCode: null,
    requestAt: stamp(), requestFlushedAt: null, headersAt: null, firstByteAt: null,
    firstRoleAt: null, firstReasoningAt: null, firstTextAt: null, firstToolAt: null,
    finishAt: null, doneAt: null, abortAt: null, durationMs: null,
    finishReason: null, usage: null,
    chunkCounts: { roles: 0, reasoning: 0, text: 0, tool: 0, usage: 0 },
    responseBytes: 0, frameCount: 0,
    requestConfig: { model: MODEL, toolCount: 7, toolChoice: 'auto',
      reasoningEffort: 'low', temperature: 1, topP: 0.95, topK: 20,
      seed: 140314, maxTokens: 64, stream: true, includeUsage: true },
  };
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let pending = '';
    let doneSeen = false;
    let finishSeen = false;
    const decoder = new StringDecoder('utf8');
    const request = http.request({ hostname: '127.0.0.1', port, path: PATH, method: 'POST',
      agent: false, headers: { 'content-type': 'application/json',
        accept: 'text/event-stream', 'content-length': String(BODY.length) } });
    const finish = (status, errorCode = null, destroy = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      result.status = status;
      result.errorCode = errorCode;
      result.durationMs = Math.max(0, Math.round(performance.now() - started));
      if (destroy) request.destroy();
      resolve(result);
    };
    const cancel = () => { result.abortAt = stamp(); finish('aborted', 'ABORTED', true); };
    const processData = (data) => {
      if (doneSeen) throw frameError('STREAM_SEQUENCE');
      if (data === '[DONE]') { doneSeen = true; result.doneAt = stamp(); return; }
      let frame;
      try { frame = JSON.parse(data); }
      catch { throw frameError('MALFORMED_SSE'); }
      if (!frame || typeof frame !== 'object' || !Array.isArray(frame.choices))
        throw frameError('MALFORMED_SSE');
      if (frame.usage !== undefined) {
        const usage = safeUsage(frame.usage);
        if (usage) { result.usage = usage; result.chunkCounts.usage++; }
      }
      for (const choice of frame.choices) {
        if (!choice || typeof choice !== 'object') throw frameError('MALFORMED_SSE');
        const delta = choice.delta;
        if (delta && typeof delta === 'object') {
          if (typeof delta.role === 'string') {
            result.chunkCounts.roles++;
            result.firstRoleAt ??= stamp();
          }
          const reasoning = typeof delta.reasoning_content === 'string'
            ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : '';
          if (reasoning.length) { result.chunkCounts.reasoning++; result.firstReasoningAt ??= stamp(); }
          if (typeof delta.content === 'string' && delta.content.length) {
            result.chunkCounts.text++; result.firstTextAt ??= stamp();
          }
          if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
            result.chunkCounts.tool++; result.firstToolAt ??= stamp();
          }
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          if (finishSeen) throw frameError('DUPLICATE_FINISH');
          finishSeen = true;
          result.finishAt = stamp();
          result.finishReason = FINISH_REASONS.has(choice.finish_reason)
            ? choice.finish_reason : 'other';
        }
      }
    };
    const processFrame = (frame) => {
      result.frameCount++;
      if (result.frameCount > MAX_FRAMES) throw frameError('FRAME_LIMIT');
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
      if (data) processData(data);
    };
    const consume = (text) => {
      pending += text;
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(pending);
        if (!boundary) break;
        const frame = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        if (frame.length > MAX_FRAME_CHARS) throw frameError('FRAME_LIMIT');
        processFrame(frame);
      }
      if (pending.length > MAX_FRAME_CHARS) throw frameError('FRAME_LIMIT');
    };
    request.once('response', (response) => {
      result.httpStatus = response.statusCode ?? null;
      result.headersAt = stamp();
      if (response.statusCode !== 200) {
        response.resume();
        finish('failed', 'HTTP_STATUS', true);
        return;
      }
      if (!/^text\/event-stream(?:\s*;|$)/i.test(String(response.headers['content-type'] ?? ''))) {
        response.resume();
        finish('failed', 'BAD_CONTENT_TYPE', true);
        return;
      }
      response.on('data', (chunk) => {
        if (settled) return;
        result.firstByteAt ??= stamp();
        result.responseBytes += chunk.length;
        if (result.responseBytes > MAX_RESPONSE_BYTES) {
          finish('failed', 'BODY_LIMIT', true); return;
        }
        try { consume(decoder.write(chunk)); }
        catch (error) { finish('failed', error?.safeCode ?? 'MALFORMED_SSE', true); }
      });
      response.once('end', () => {
        if (settled) return;
        try {
          consume(decoder.end());
          if (pending.trim()) { processFrame(pending); pending = ''; }
        }
        catch (error) { finish('failed', error?.safeCode ?? 'MALFORMED_SSE'); return; }
        finish(doneSeen && finishSeen ? 'finished' : 'failed',
          doneSeen && finishSeen ? null : 'INCOMPLETE_STREAM');
      });
      response.once('error', () => finish('failed', 'SOCKET_ERROR'));
    });
    request.once('error', () => finish('failed', 'SOCKET_ERROR'));
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { result.abortAt = stamp(); finish('timed_out', 'TIMEOUT', true); }, timeoutMs);
    if (signal?.aborted) cancel();
    else request.end(BODY, () => { if (!settled) result.requestFlushedAt = stamp(); });
  });
}

export async function validateOutputPath(file, root = ACCEPTANCE_ROOT) {
  if (typeof file !== 'string' || !path.isAbsolute(file) ||
      !/^[a-z][a-z0-9_-]{0,80}\.json$/.test(path.basename(file)))
    throw new Error('INVALID_OUTPUT_PATH');
  const realRoot = await realpath(root);
  const parent = await realpath(path.dirname(file));
  const same = process.platform === 'win32'
    ? parent.toLowerCase() === realRoot.toLowerCase() : parent === realRoot;
  if (!same || path.normalize(file) !== path.join(path.dirname(file), path.basename(file)))
    throw new Error('INVALID_OUTPUT_PATH');
  const stat = await lstat(realRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVALID_OUTPUT_PATH');
  return file;
}

export async function writeMicroResult(file, result, root = ACCEPTANCE_ROOT) {
  await validateOutputPath(file, root);
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(result, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const valid = args.length === 5 && args[0] === '--run' && args[1] === '--mode' &&
    ['mtp3', 'no-spec'].includes(args[2]) && args[3] === '--output';
  if (process.env.WEFTMATE_STAGE14R3_MICRO !== '1' || !valid)
    throw new Error('EXPLICIT_MICRO_OPT_IN_REQUIRED');
  const mode = args[2];
  const output = await validateOutputPath(args[4]);
  const result = await runMicroOnce({ mode });
  await writeMicroResult(output, result);
  process.stdout.write(JSON.stringify({ kind: result.kind, scope: result.scope,
    mode: result.mode, status: result.status, httpStatus: result.httpStatus,
    errorCode: result.errorCode, outputFile: output }) + '\n');
  if (result.status !== 'finished') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase()) await main();

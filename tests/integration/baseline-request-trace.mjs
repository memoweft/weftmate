// Test preload: timings and counts only; never persist headers, prompts or keys.
import { appendFileSync } from 'node:fs';
const original = globalThis.fetch;
let serial = 0;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const model = url.pathname.endsWith('/chat/completions');
  const lease = url.pathname.endsWith('/lease');
  if (!model && !lease) return original(input, options);
  const id = `${process.pid}-${++serial}`, start = Date.now();
  const record = (phase, extra = {}) => appendFileSync(process.env.WEFTMATE_BASELINE_TRACE,
    JSON.stringify({ id, at: new Date().toISOString(), elapsedMs: Date.now() - start,
      kind: lease ? 'lease' : 'model', origin: url.origin, phase, ...extra }) + '\n');
  let requestChars, requestedModel, stream, templateThinking;
  if (model && typeof options?.body === 'string') {
    try { const body = JSON.parse(options.body); requestChars = JSON.stringify(body.messages ?? []).length;
      requestedModel = body.model; stream = body.stream; templateThinking = body.chat_template_kwargs?.enable_thinking;
    } catch { /* Not JSON. */ }
  }
  record('start', { requestChars, requestedModel, stream, templateThinking });
  try {
    const response = await original(input, options); record('headers', { status: response.status });
    if (!response.body) return response;
    const reader = response.body.getReader(); let chunks = 0, bytes = 0, buffer = '', usage;
    let reasoningChars = 0, contentChars = 0, sawTool = false; const decoder = new TextDecoder();
    const metrics = chunk => {
      buffer += decoder.decode(chunk, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, split); buffer = buffer.slice(split + 1);
        if (!line.startsWith('data:')) continue;
        try { const value = JSON.parse(line.slice(5)); if (value.usage) usage = value.usage;
          for (const choice of value.choices ?? []) {
            if (!reasoningChars && choice.delta?.reasoning_content) record('first-reasoning');
            if (!contentChars && choice.delta?.content) record('first-content');
            if (!sawTool && choice.delta?.tool_calls?.length) { sawTool = true; record('first-tool-call'); }
            reasoningChars += (choice.delta?.reasoning_content ?? '').length;
            contentChars += (choice.delta?.content ?? '').length; }
        } catch { /* [DONE] and non-JSON keepalives contain no usage. */ }
      }
    };
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            try { const value = JSON.parse(buffer); usage ??= value.usage;
              for (const choice of value.choices ?? []) { contentChars += (choice.message?.content ?? '').length;
                reasoningChars += (choice.message?.reasoning_content ?? '').length; }
            } catch { /* SSE has already been consumed line by line. */ }
            record('end', { chunks, bytes, reasoningChars, contentChars, usage }); controller.close(); }
          else { if (!chunks++) record('first-chunk'); bytes += next.value.length;
            if (model) metrics(next.value);
            if (model && chunks % 100 === 0) record('progress', { chunks, bytes });
            controller.enqueue(next.value); }
        } catch (error) { record('error', { chunks, bytes, name: error.name }); controller.error(error); }
      },
      async cancel(reason) { record('cancel', { chunks, bytes }); await reader.cancel(reason); },
    }), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { record('error', { name: error.name }); throw error; }
};

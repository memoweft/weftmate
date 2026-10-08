/** Consume only usage metadata while forwarding the original response bytes. */
export function usageResponse(response, finish) {
  let usage = null, tail = '', ended = false;
  const decoder = new TextDecoder();
  const streaming = /text\/event-stream/i.test(response.headers.get('content-type') ?? '');
  function parse(text) { try { const value = JSON.parse(text); if (value.usage) usage = value.usage; } catch { /* Incomplete/unsupported provider frame. */ } }
  async function done() {
    if (ended) return; ended = true;
    tail += decoder.decode();
    if (!streaming) parse(tail); else for (const line of tail.split('\n')) if (line.startsWith('data:')) parse(line.slice(5).trim());
    await finish(usage);
  }
  if (!response.body) return done().then(() => response);
  const reader = response.body.getReader();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const part = await reader.read();
        if (part.done) { await done(); controller.close(); return; }
        tail += decoder.decode(part.value, { stream: true });
        if (streaming) {
          const lines = tail.split('\n'); tail = lines.pop();
          for (const line of lines) if (line.startsWith('data:')) parse(line.slice(5).trim());
        }
        controller.enqueue(part.value);
      } catch (error) { await done(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { await done(); } },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}

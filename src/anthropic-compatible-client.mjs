// Preserve the existing OpenAI-shaped personal proxy while native Claude services
// use their own messages protocol. Secrets stay in the caller's request headers.
export function anthropicCompletionBody(body) {
  const system = [], messages = [];
  for (const message of body.messages) {
    if (message.role === 'system') { system.push(message.content); continue; }
    if (message.role === 'tool') {
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }] });
      continue;
    }
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : [];
    for (const call of message.tool_calls ?? []) content.push({ type: 'tool_use', id: call.id, name: call.function.name,
      input: JSON.parse(call.function.arguments || '{}') });
    messages.push({ role: message.role, content });
  }
  return { model: body.model, messages, max_tokens: body.max_tokens ?? 4096, stream: body.stream === true,
    ...(system.length ? { system: system.join('\n\n') } : {}), ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.tools?.length && body.tool_choice !== 'none' ? { tools: body.tools.map(tool => ({ name: tool.function.name,
      ...(tool.function.description ? { description: tool.function.description } : {}), input_schema: tool.function.parameters ?? { type: 'object', properties: {} } })),
      tool_choice: { type: body.tool_choice === 'required' ? 'any' : 'auto' } } : {}) };
}
const finishReason = reason => reason === 'max_tokens' ? 'length' : reason === 'tool_use' ? 'tool_calls' : 'stop';
const usage = value => ({ prompt_tokens: value.input_tokens ?? 0, completion_tokens: value.output_tokens ?? 0,
  total_tokens: (value.input_tokens ?? 0) + (value.output_tokens ?? 0) });

export async function openAIAnthropicResponse(response, streaming) {
  if (!response.ok) return response;
  if (!streaming) {
    const value = await response.json();
    const calls = (value.content ?? []).filter(block => block.type === 'tool_use').map(block => ({ id: block.id, type: 'function',
      function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }));
    return Response.json({ id: value.id, object: 'chat.completion', model: value.model,
      choices: [{ index: 0, message: { role: 'assistant', content: (value.content ?? []).filter(block => block.type === 'text').map(block => block.text).join(''),
        ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: finishReason(value.stop_reason) }], usage: usage(value.usage ?? {}) });
  }
  if (!response.body) throw new Error('MODEL_UPSTREAM_ERROR');
  let buffer = '', id, model, finished = false, tokenUsage = {}, toolIndices = new Map(), nextToolIndex = 0;
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  const transform = new TransformStream({
    transform(chunk, controller) {
      const emit = (delta, reason = null, measured) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model,
        choices: [{ index: 0, delta, finish_reason: reason }], ...(measured ? { usage: usage(measured) } : {}) })}\n\n`));
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop();
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data) continue;
        const value = JSON.parse(data);
        if (value.type === 'error') throw new Error('MODEL_UPSTREAM_ERROR');
        if (value.type === 'message_start') { id = value.message.id; model = value.message.model; tokenUsage = value.message.usage ?? {}; emit({ role: 'assistant' }); }
        else if (value.type === 'content_block_start' && value.content_block?.type === 'tool_use') {
          const index = nextToolIndex++; toolIndices.set(value.index, index);
          emit({ tool_calls: [{ index, id: value.content_block.id, type: 'function', function: { name: value.content_block.name, arguments: '' } }] });
        } else if (value.type === 'content_block_start' && value.content_block?.type === 'text' && value.content_block.text) emit({ content: value.content_block.text });
        else if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta') emit({ content: value.delta.text });
        else if (value.type === 'content_block_delta' && value.delta?.type === 'input_json_delta') emit({ tool_calls: [{ index: toolIndices.get(value.index), function: { arguments: value.delta.partial_json } }] });
        else if (value.type === 'message_delta') { tokenUsage = { ...tokenUsage, ...value.usage }; emit({}, finishReason(value.delta?.stop_reason), tokenUsage); }
        else if (value.type === 'message_stop') { finished = true; controller.enqueue(encoder.encode('data: [DONE]\n\n')); }
      }
    },
    flush() { if (!finished) throw new Error('MODEL_UPSTREAM_ERROR'); },
  });
  return new Response(response.body.pipeThrough(transform), { status: response.status, headers: { 'content-type': 'text/event-stream' } });
}

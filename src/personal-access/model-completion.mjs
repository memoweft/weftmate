const ID = /^[A-Za-z0-9._:/-]{1,128}$/;
const TOOL = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_MESSAGES = 40;
const MAX_TOOLS = 8;

function invalid() {
  const error = new Error('INVALID_REQUEST');
  error.code = 'INVALID_REQUEST';
  error.status = 400;
  throw error;
}
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed, required) {
  if (!record(value) || required.some((field) => !Object.hasOwn(value, field)) ||
      Object.keys(value).some((field) => !allowed.includes(field))) invalid();
}
function bounded(value, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) invalid();
  return value;
}
function calls(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) invalid();
  return input.map((item) => {
    fields(item, ['id', 'type', 'function'], ['id', 'type', 'function']);
    fields(item.function, ['name', 'arguments'], ['name', 'arguments']);
    if (item.type !== 'function' || !TOOL.test(item.function.name) ||
        typeof item.id !== 'string' || !ID.test(item.id)) invalid();
    const args = bounded(item.function.arguments, 8192, true);
    try { JSON.parse(args); } catch { invalid(); }
    return { id: item.id, type: 'function', function: { name: item.function.name, arguments: args } };
  });
}

/** A narrow OpenAI chat body; the host decides the upstream URL, model and credential. */
export function canonicalCompletion(input) {
  fields(input, ['model', 'messages', 'tools', 'tool_choice', 'stream', 'max_tokens', 'temperature'],
    ['model', 'messages']);
  if (typeof input.model !== 'string' || !ID.test(input.model) ||
      !Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > MAX_MESSAGES) invalid();
  const messages = input.messages.map((item) => {
    if (!record(item) || !['system', 'user', 'assistant', 'tool'].includes(item.role)) invalid();
    const content = item.content === null && item.role === 'assistant' ? null : bounded(item.content, 16_384, item.role === 'assistant');
    if (item.role === 'tool') {
      if (typeof item.tool_call_id !== 'string' || !ID.test(item.tool_call_id)) invalid();
      return { role: 'tool', tool_call_id: item.tool_call_id, content };
    }
    const toolCalls = item.role === 'assistant' && item.tool_calls !== undefined ? calls(item.tool_calls) : undefined;
    if (content === null && !toolCalls) invalid();
    return { role: item.role, content, ...(toolCalls ? { tool_calls: toolCalls } : {}) };
  });
  let tools;
  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools) || input.tools.length > MAX_TOOLS) invalid();
    tools = input.tools.map((item) => {
      fields(item, ['type', 'function'], ['type', 'function']);
      fields(item.function, ['name', 'description', 'parameters'], ['name', 'description', 'parameters']);
      if (item.type !== 'function' || !TOOL.test(item.function.name) || !record(item.function.parameters)) invalid();
      return { type: 'function', function: { name: item.function.name,
        description: bounded(item.function.description, 500, true), parameters: item.function.parameters } };
    });
  }
  if (input.tool_choice !== undefined && !['auto', 'none', 'required'].includes(input.tool_choice)) invalid();
  if (input.stream !== undefined && typeof input.stream !== 'boolean') invalid();
  if (input.max_tokens !== undefined && (!Number.isSafeInteger(input.max_tokens) ||
      input.max_tokens < 1 || input.max_tokens > 8192)) invalid();
  if (input.temperature !== undefined && (typeof input.temperature !== 'number' ||
      !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)) invalid();
  return { model: input.model, messages,
    ...(tools === undefined ? {} : { tools }),
    ...(input.tool_choice === undefined ? {} : { tool_choice: input.tool_choice }),
    stream: input.stream === true,
    ...(input.max_tokens === undefined ? {} : { max_tokens: input.max_tokens }),
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }) };
}

/** Keep only the fields the Android tool loop consumes. */
export function projectCompletion(value) {
  if (!record(value) || !Array.isArray(value.choices) || value.choices.length < 1 || value.choices.length > 4) invalid();
  const choices = value.choices.map((choice) => {
    if (!record(choice) || !record(choice.message) || choice.message.role !== 'assistant') invalid();
    const message = choice.message;
    const content = message.content === null ? null : bounded(message.content, 32_768, true);
    const toolCalls = message.tool_calls === undefined ? undefined : calls(message.tool_calls);
    if (content === null && !toolCalls) invalid();
    const finishReason = choice.finish_reason;
    return { message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
      ...(finishReason === undefined ? {} : { finish_reason: finishReason === null ? null
        : ['stop', 'tool_calls', 'length', 'content_filter'].includes(finishReason)
          ? finishReason : 'unknown' }) };
  });
  return { choices, ...(record(value.usage) ? { usage: {
    ...(Number.isSafeInteger(value.usage.prompt_tokens) ? { prompt_tokens: value.usage.prompt_tokens } : {}),
    ...(Number.isSafeInteger(value.usage.completion_tokens) ? { completion_tokens: value.usage.completion_tokens } : {}),
    ...(Number.isSafeInteger(value.usage.total_tokens) ? { total_tokens: value.usage.total_tokens } : {}),
  } } : {}) };
}

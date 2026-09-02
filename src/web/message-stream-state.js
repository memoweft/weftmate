/** Pure keyed stream reducer shared by the renderer and DOM-level behavior tests. */
export function applyMessageUpdate(messages, kind, text, createId) {
  if (!text) return { messages, mode: 'none', message: null, announce: '' };
  const last = messages.at(-1);
  if (kind === 'assistant.delta' && last?.kind === 'assistant') {
    last.text += text;
    return { messages, mode: 'update', message: last, announce: '' };
  }
  if (kind === 'assistant.completed' && last?.kind === 'assistant') {
    last.text = text;
    return { messages, mode: 'update', message: last, announce: '助手回复完成' };
  }
  const message = { id: createId(), kind: kind.startsWith('assistant') ? 'assistant' : kind, text };
  messages.push(message);
  return { messages, mode: 'append', message, announce: message.kind === 'assistant' ? '助手开始回复' : '收到新消息' };
}

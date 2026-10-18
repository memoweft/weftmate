import { randomUUID } from 'node:crypto';

export const installedSmokePrompt = '读取合成项目 brief.md，并写 approved.md，等待审批。';

const text = value => typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(part => part.text ?? '').join('\n') : '';
const json = value => { try { return JSON.parse(value); } catch { return null; } };

export function installedSmokeRequestKind(input) {
  const messages = input.messages ?? [];
  // Core 2112aa8 local formation streams too. Its evidence envelope is data,
  // even when that evidence quotes this smoke's entire project instruction.
  if (messages.some(message => {
    const value = message.role === 'user' && json(text(message.content));
    return Array.isArray(value?.evidence) && Array.isArray(value?.current_cognitions);
  })) return 'memory';
  const names = new Set((input.tools ?? []).map(tool => tool.function?.name));
  if (['load_tools', 'read', 'write'].some(name => names.has(name)) && messages.some(message =>
    message.role === 'user' && text(message.content).includes(installedSmokePrompt))) return 'project';
  return 'other';
}

function projectResults(input) {
  const calls = new Map(), results = new Map();
  for (const message of input.messages ?? []) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) calls.set(call.id, call.function);
    if (message.role !== 'tool') continue;
    const call = calls.get(message.tool_call_id);
    if (!call || !['load_tools', 'read', 'write'].includes(call.name)) continue;
    const args = json(call.arguments), content = text(message.content);
    if (call.name === 'load_tools' && json(content)?.loaded?.includes('read') && json(content)?.loaded?.includes('write') ||
        call.name === 'read' && args?.file_path === 'brief.md' && content.includes('brief.md') && content.includes('FX21 synthetic project file') ||
        call.name === 'write' && args?.file_path === 'approved.md' && content.includes('approved.md') && content.includes('Created file')) {
      results.set(call.name, content);
    } else throw new Error(`INSTALLED_SMOKE_TOOL_RESULT_INVALID:${call.name}`);
  }
  return results;
}

/** Synthetic model used by the installed application smoke. */
export function createInstalledSmokeResponder() {
  const observations = new WeakMap();
  const respond = async input => {
    const source = installedSmokeRequestKind(input);
    let message;
    if (source === 'memory') message = { role: 'assistant', content: JSON.stringify({ schema_version: 8, result: 'no_change' }) };
    else if (source === 'other') message = { role: 'assistant', content: '主对话首条消息成功，合成回复。' };
    else {
      const results = projectResults(input);
      const tool = ['load_tools', 'read', 'write'].find(name => !results.has(name));
      if (!tool) message = { role: 'assistant', content: 'FX21 synthetic project file 已读取，并保存 approved.md。' };
      else {
        const args = tool === 'load_tools' ? { names: ['read', 'write'] } : tool === 'read'
          ? { file_path: 'brief.md' } : { file_path: 'approved.md', content: 'FX21 synthetic project file\n' };
        message = { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + randomUUID(), type: 'function',
          function: { name: tool, arguments: JSON.stringify(args) } }] };
      }
    }
    // Synthetic smoke evidence only: fixed source/reply labels, no prompts,
    // account identifiers, credentials or source contents in diagnostics.
    observations.set(input, { source, reply: message.tool_calls?.[0]?.function.name ?? (source === 'memory' ? 'no_change' : 'text') });
    return message;
  };
  respond.describe = input => observations.get(input) ?? { source: installedSmokeRequestKind(input), reply: 'not_observed' };
  return respond;
}

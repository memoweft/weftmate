/** Read-only import adapters. No discovery runs until the desktop owner selects a source. */
import { readFile, readdir, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const importApps = Object.freeze({ chatgpt: 'ChatGPT', claude: 'Claude', codex: 'Codex', 'claude-code': 'Claude Code', phone: '手机上的对话' });
export const formatError = () => Object.assign(new Error('这个文件的格式认不出'), { code: 'IMPORT_FORMAT_UNKNOWN', status: 422 });
const hash = value => createHash('sha256').update(value).digest('hex');
const instant = value => {
  const time = typeof value === 'number' ? value * 1000 : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const msg = (role, text, time) => text.trim() ? { role, content: text.trim(), at: instant(time) } : null;
const textBlocks = blocks => Array.isArray(blocks) ? blocks.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n') : '';
const names = attachments => (attachments ?? []).map(a => a?.file_name ?? a?.filename ?? a?.name).filter(n => typeof n === 'string').map(n => `[附件：${n.split(/[\\/]/).at(-1)}]`).join('\n');
function conversation(app, id, title, time, messages) {
  if (typeof id !== 'string' || !id) throw formatError();
  messages = messages.filter(Boolean);
  const times = messages.map(m => m.at).filter(Boolean).sort();
  return { app, id, title: String(title || '未命名对话').slice(0, 200), at: times[0] ?? instant(time),
    until: times.at(-1) ?? instant(time), messages, characters: messages.reduce((n, m) => n + m.content.length, 0),
    fingerprint: hash(JSON.stringify(messages.map(({role,content})=>({role,content})))),
    legacyFingerprint: hash(JSON.stringify(messages)) };
}
export function parseChatGPT(data) {
  if (!Array.isArray(data)) throw formatError();
  return data.map(c => {
    if (!c || !c.mapping || typeof c.mapping !== 'object' || !Object.hasOwn(c, 'current_node')) throw formatError();
    const chain = [], seen = new Set(); let id = c.current_node;
    while (id) {
      if (seen.has(id) || !c.mapping[id]) throw formatError();
      seen.add(id); chain.unshift(c.mapping[id].message); id = c.mapping[id].parent;
    }
    const messages = chain.filter(Boolean).map(m => {
      const role = m.author?.role;
      if (!['user', 'assistant'].includes(role) || m.recipient && m.recipient !== 'all' ||
          m.metadata?.is_visually_hidden_from_conversation || m.channel && m.channel !== 'final') return null;
      const content = m.content;
      if (!content || typeof content !== 'object') throw formatError();
      // Multimodal parts are opaque; neither image pointers nor attachment bytes enter memory.
      const text = Array.isArray(content.parts) && ['text', 'multimodal_text'].includes(content.content_type)
        ? content.parts.filter(p => typeof p === 'string').join('\n') : '';
      return msg(role, [text, names(m.metadata?.attachments)].filter(Boolean).join('\n'), m.create_time ?? c.create_time);
    });
    return conversation('chatgpt', c.id ?? c.conversation_id, c.title, c.create_time, messages);
  });
}
export function parseClaude(data) {
  if (!Array.isArray(data)) throw formatError();
  return data.map(c => {
    if (!c || !Array.isArray(c.chat_messages)) throw formatError();
    return conversation('claude', c.uuid, c.name, c.created_at, c.chat_messages.map(m => {
      if (!['human', 'assistant'].includes(m.sender)) return null;
      if (typeof m.text !== 'string' && !Array.isArray(m.content)) throw formatError();
      return msg(m.sender === 'human' ? 'user' : 'assistant',
        [Array.isArray(m.content) ? textBlocks(m.content) : m.text, names(m.attachments), names(m.files)].filter(Boolean).join('\n'), m.created_at);
    }));
  });
}
function lines(text) {
  try { return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)); } catch { throw formatError(); }
}
export function parseCodex(text) {
  const rows = lines(text), meta = rows.find(r => r.type === 'session_meta')?.payload;
  if (!meta || typeof meta.id !== 'string') throw formatError();
  // The display log identifies real human input; response_item user messages also carry injected instructions.
  const events = rows.filter(r => r.type === 'event_msg'), messages = [];
  if (!events.length && rows.length > 1) throw formatError();
  let final = null;
  for (const row of events) {
    const p = row.payload;
    if (!p || typeof p.type !== 'string') throw formatError();
    if (p.type === 'user_message') {
      if (typeof p.message !== 'string') throw formatError();
      let text = p.message;
      if (text.includes('## My request for Codex:')) text = text.slice(text.indexOf('## My request for Codex:') + 25).trim();
      if (/^\s*(?:# AGENTS\.md|<(?:user_instructions|environment_context|system|developer|skills_instructions))/.test(text)) continue;
      messages.push(msg('user', [text, names((p.local_images ?? []).map(name => ({ name })))].filter(Boolean).join('\n'), row.timestamp));
    } else if (p.type === 'agent_message' && p.phase === 'final_answer') {
      if (typeof p.message !== 'string') throw formatError();
      final = msg('assistant', p.message, row.timestamp);
    } else if (p.type === 'task_complete' || p.type === 'turn_complete') {
      const answer = typeof p.last_agent_message === 'string' ? msg('assistant', p.last_agent_message, row.timestamp) : final;
      if (answer) messages.push(answer); final = null;
    }
  }
  if (final) messages.push(final);
  // Versions without a recognizable final marker are rejected, never guessed from tool commentary.
  if (events.some(r => r.payload?.type === 'agent_message') && !messages.some(m => m?.role === 'assistant')) throw formatError();
  return [conversation('codex', meta.id, messages.find(m => m?.role === 'user')?.content, meta.timestamp, messages)];
}
export function parseClaudeCode(text) {
  const rows = lines(text), real = rows.filter(r => !r.isSidechain && ['user', 'assistant'].includes(r.type));
  if (!real.length && rows.some(r => r.isSidechain && ['user', 'assistant'].includes(r.type) && typeof r.sessionId === 'string')) return [];
  const id = real[0]?.sessionId;
  if (typeof id !== 'string' || real.some(r => r.sessionId !== id || !r.message || r.message.role !== r.type)) throw formatError();
  const messages = real.map(r => {
    const m = r.message;
    if (r.isMeta || r.isCompactSummary) return null;
    if (r.type === 'assistant' && m.stop_reason !== 'end_turn') return null;
    const content = typeof m.content === 'string' && r.type === 'user' ? m.content : textBlocks(m.content);
    // CLI-injected commands, system notifications and tool-result messages are not human speech.
    if (r.type === 'user' && /^\s*<(?:local-command|command-name|system-reminder|environment_context|user_instructions|task-notification|tool)/.test(content)) return null;
    return msg(r.type, content, r.timestamp);
  });
  if (real.some(r => r.type === 'assistant' && textBlocks(r.message.content)) && !messages.some(m => m?.role === 'assistant')) throw formatError();
  return [conversation('claude-code', id, messages.find(m => m?.role === 'user')?.content, real[0]?.timestamp, messages)];
}
// Read one named ZIP entry in memory. Never extract entries or copy the source into the account directory.
export function conversationsFromZip(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw formatError();
  let offset = bytes.readUInt32LE(end + 16); const matches = [];
  for (let n = 0; n < bytes.readUInt16LE(end + 10); n++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw formatError();
    const length = bytes.readUInt16LE(offset + 28), name = bytes.subarray(offset + 46, offset + 46 + length).toString('utf8');
    if (name.split('/').at(-1) === 'conversations.json') {
      if (bytes.readUInt16LE(offset + 8) & 1) throw formatError();
      const method = bytes.readUInt16LE(offset + 10), size = bytes.readUInt32LE(offset + 20), start = bytes.readUInt32LE(offset + 42);
      if (start + 30 > bytes.length || bytes.readUInt32LE(start) !== 0x04034b50) throw formatError();
      const body = start + 30 + bytes.readUInt16LE(start + 26) + bytes.readUInt16LE(start + 28);
      const input = bytes.subarray(body, body + size);
      matches.push(method === 0 ? input : method === 8 ? inflateRawSync(input) : null);
    }
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  if (matches.length !== 1 || !matches[0]) throw formatError();
  return matches[0].toString('utf8');
}
export async function sourceFiles(app, paths) {
  if (!importApps[app] || !Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw formatError();
  const files = [];
  async function visit(file) {
    const info = await stat(file);
    if (info.isDirectory()) {
      if (!['codex', 'claude-code'].includes(app)) throw formatError();
      for (const entry of await readdir(file, { withFileTypes: true })) if (!entry.isSymbolicLink() && !(app === 'claude-code' && entry.name === 'subagents')) {
        if (entry.isDirectory() || entry.name.endsWith('.jsonl')) await visit(path.join(file, entry.name));
      }
    } else files.push(file);
  }
  for (const file of paths) await visit(file);
  return [...new Set(files)];
}
// UTF-8 byte spans let resumed JSON imports reread just one original conversation.
function jsonRows(bytes) {
  const rows = [], whitespace=byte=>[9,10,13,32].includes(byte);
  let first=0;while(whitespace(bytes[first]))first++;
  if(bytes[first]!==91)throw formatError();
  let depth = 1, start = -1, quoted = false, escaped = false, expectValue=true,hasValue=false;
  for (let i = first+1; i < bytes.length; i++) {
    const ch = bytes[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === 92) escaped = true; else if (ch === 34) quoted = false; continue; }
    if(depth===1) {
      if(whitespace(ch))continue;
      if(ch===93) { if(expectValue&&hasValue||bytes.subarray(i+1).some(byte=>!whitespace(byte)))throw formatError();return rows; }
      if(expectValue&&ch===123){start=i;depth=2;expectValue=false;continue;}
      if(!expectValue&&ch===44){expectValue=true;continue;}
      throw formatError();
    }
    if (ch === 34) { quoted = true; continue; }
    if (ch === 91 || ch === 123) depth++;
    if (ch === 93 || ch === 125) { depth--; if (depth === 1 && start >= 0) { rows.push({offset:start,length:i-start+1}); start=-1;hasValue=true; } }
  }
  throw formatError();
}
export async function readHistory(app, file, locator = null) {
  try {
    const zip = path.extname(file).toLowerCase() === '.zip';
    let bytes;
    if (locator && !zip) {
      const handle = await open(file, 'r');
      try { bytes = Buffer.alloc(locator.length); const result = await handle.read(bytes,0,bytes.length,locator.offset); if(result.bytesRead!==bytes.length)throw formatError(); }
      finally { await handle.close(); }
    } else bytes = await readFile(file);
    if (zip) bytes = Buffer.from(conversationsFromZip(bytes),'utf8');
    if (locator && zip) bytes = bytes.subarray(locator.offset,locator.offset+locator.length);
    const text = bytes.toString('utf8');
    if (app === 'codex') return parseCodex(text);
    if (app === 'claude-code') return parseClaudeCode(text);
    const parse = app === 'chatgpt' ? parseChatGPT : app === 'claude' ? parseClaude : () => { throw formatError(); };
    if (locator) return parse([JSON.parse(text)]);
    if (!text.trimStart().startsWith('[')) throw formatError();
    const ranges = jsonRows(bytes);
    if (!ranges.length) { if (text.trim() !== '[]') throw formatError(); return []; }
    return ranges.flatMap(locator => parse([JSON.parse(bytes.subarray(locator.offset,locator.offset+locator.length).toString('utf8'))]).map(c => ({...c,locator})));
  } catch (cause) {
    if (cause.code === 'ENOENT' || cause.code === 'EACCES') throw Object.assign(new Error('原文件无法读取，请把文件放回原来的位置后继续'), { code: 'IMPORT_SOURCE_UNAVAILABLE', status: 422 });
    throw formatError();
  }
}
export const importKey = c => hash(`${c.app}\n${c.id}\n${c.fingerprint}`);

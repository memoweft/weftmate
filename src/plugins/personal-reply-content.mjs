import { randomUUID } from 'node:crypto';

const json = value => { try { return JSON.parse(value); } catch { return undefined; } };
const callShape = value => value && typeof value === 'object' && typeof value.name === 'string' && Object.hasOwn(value, 'arguments');
const looksLikeCall = text => /"(?:name|function)"\s*:/.test(text) && /"arguments"\s*:/.test(text);
function recover(raw) {
  const functionTag = /^<function=([^>\s]+)>([\s\S]*)<\/function>$/i.exec(raw.trim());
  if (functionTag) {
    const body = functionTag[2].trim(), args = json(body);
    if (args && typeof args === 'object' && !Array.isArray(args)) return { name: functionTag[1], arguments: args };
    const parameters = [...body.matchAll(/<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/gi)];
    if (!parameters.length || body.replace(/<parameter=[^>]+>[\s\S]*?<\/parameter>/gi, '').trim()) return;
    return { name: functionTag[1], arguments: Object.fromEntries(parameters.map(([,name,value]) => [name, json(value) === undefined ? value : json(value)])) };
  }
  const value = json(raw.trim()), candidate = value?.function ?? value;
  if (!callShape(candidate)) return;
  const args = typeof candidate.arguments === 'string' ? json(candidate.arguments) : candidate.arguments;
  if (args && typeof args === 'object' && !Array.isArray(args)) return { name: candidate.name, arguments: args };
}
function objectEnd(text) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return i + 1;
  }
  return -1;
}
/** Hold only ambiguous syntax, so no raw prefix can escape in a text delta. */
function scan(text, final) {
  let visible = '', removed = false;
  const calls = [];
  while (text) {
    const start = text.search(/[<{`]/);
    if (start < 0) { visible += text; text = ''; break; }
    visible += text.slice(0, start); text = text.slice(start);
    if (text[0] === '`') {
      if (!final && '```'.startsWith(text)) break;
      if (text.startsWith('```')) {
        const end = text.indexOf('```', 3);
        if (end < 0 && !final) break;
        const length = end < 0 ? text.length : end + 3;
        const body = text.slice(3, end < 0 ? undefined : end).replace(/^[^\r\n]*\r?\n/, '');
        const inner = scan(body, true);
        if (inner.removed) { visible += inner.visible.trim(); calls.push(...inner.calls); removed = true; }
        else visible += text.slice(0, length);
        text = text.slice(length); continue;
      }
    }
    if (text[0] === '<') {
      const prefixes = ['<tool_call>', '<function='];
      if (!final && (prefixes.some(prefix => prefix.startsWith(text.toLowerCase())) || /^<function=[^>]*$/i.test(text))) break;
      const tag = /^<(tool_call|function=[^>]*)(?:>)/i.exec(text);
      if (tag) {
        const close = tag[1].toLowerCase() === 'tool_call' ? '</tool_call>' : '</function>';
        const end = text.toLowerCase().indexOf(close, tag[0].length);
        if (end < 0 && !final) break;
        const length = end < 0 ? text.length : end + close.length;
        const raw = tag[1].toLowerCase() === 'tool_call' ? text.slice(tag[0].length, end < 0 ? undefined : end) : text.slice(0,length);
        const call = end < 0 ? undefined : recover(raw);
        if (call) calls.push(call);
        removed = true; text = text.slice(length); continue;
      }
      if (final && /^<(?:tool_call|function=)/i.test(text)) { removed = true; text = ''; break; }
    }
    if (text[0] === '{') {
      const end = objectEnd(text);
      if (end < 0 && !final) break;
      const length = end < 0 ? text.length : end, raw = text.slice(0, length);
      const value = json(raw), candidate = value?.function ?? value;
      if (callShape(candidate) || value === undefined && looksLikeCall(raw)) {
        const call = recover(raw); if (call) calls.push(call);
        removed = true;
      } else visible += raw;
      text = text.slice(length); continue;
    }
    visible += text[0]; text = text.slice(1);
  }
  return { visible, pending: text, calls, removed };
}
const signature = call => JSON.stringify([call.name, sort(json(call.arguments) ?? call.arguments)]);
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,sort(value[key])])) : value;
}

/** Keep DSH's native stream grammar and let its scheduler validate/execute recovered calls. */
export async function* cleanReplyStream(source, options) {
  const states = new Map(), recovered = [], native = new Set();
  const available = new Set((options.tools ?? []).map(tool => tool.name));
  let maxIndex = -1;
  for await (const chunk of source) {
    if (Number.isInteger(chunk.index)) maxIndex = Math.max(maxIndex,chunk.index);
    if (chunk.type === 'block-start' && chunk.blockType === 'text') states.set(chunk.index,{ pending:'',visible:'',raw:'' });
    if (chunk.type === 'text-delta' || chunk.type === 'block-end' && chunk.block.type === 'text') {
      const state = states.get(chunk.index) ?? {pending:'',visible:'',raw:''}; states.set(chunk.index,state);
      const final = chunk.type === 'block-end';
      const addition = final ? chunk.block.text.slice(state.raw.length) : chunk.text;
      state.raw += addition;
      const result = scan(state.pending + addition,final);
      state.pending = result.pending; state.visible += result.visible; recovered.push(...result.calls);
      if (result.visible) yield {type:'text-delta',index:chunk.index,text:result.visible};
      if (final) yield {...chunk,block:{...chunk.block,text:state.visible}};
      continue;
    }
    if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') native.add(signature(chunk.block));
    if (chunk.type === 'finish' && ['stop','tool-calls'].includes(chunk.reason.kind)) {
      let count = 0;
      for (const candidate of recovered) {
        const call = {...candidate,arguments:JSON.stringify(candidate.arguments)};
        if (!available.has(call.name) || native.has(signature(call))) continue;
        native.add(signature(call));
        const index = ++maxIndex, id = `call-${randomUUID()}`;
        yield {type:'block-start',index,blockType:'tool-call'};
        yield {type:'tool-call-delta',index,id,name:call.name,argumentsDelta:call.arguments};
        yield {type:'block-end',index,block:{type:'tool-call',id,...call}};
        count++;
      }
      yield count ? {...chunk,reason:{kind:'tool-calls'}} : chunk;
    } else yield chunk;
  }
}

/** Only presentation changes: receipts, retries and memory mutation remain owned by their existing implementation. */
export function modelToolFailure(name, result) {
  if (name === 'run_code' && result.isError) {
    const detail = JSON.stringify([result.error, result.content]);
    name = detail.includes('这次没忘掉') ? 'memory_forget' : detail.includes('这次没记住') ? 'memory_correct'
      : ['memory_forget','memory_correct','memory_query'].find(tool => detail.includes(tool)) ?? name;
  }
  const memory = name?.startsWith('memory_');
  const failedReceipt = memory && result.content?.some(part => {
    if (part.type !== 'text') return false;
    const value = json(part.text), receipt = value?.receipt ?? value;
    return value?.available === false || ['rejected','revision_conflict','failed','unavailable','withheld'].includes(receipt?.state) || Boolean(value?.error);
  });
  if (!result.isError && !failedReceipt) return;
  return [{type:'text',text:memory
    ? name === 'memory_forget' ? '这次没忘掉，稍后会再试。' : '这次没记住，稍后会再试。'
    : '这一步没能完成。请简短说明还有什么没完成，必要时换一种办法再试；不要在回复里提工具名称、错误码或内部条目类型。'},
    ...(memory ? [{type:'text',text:'请直接用上面这句话回复用户，不要解释处理过程。'}] : [])];
}

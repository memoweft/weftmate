const json = value => { try { return JSON.parse(value); } catch { return undefined; } };
const fencePrefix = /^(?: {0,3}> ?)* {0,3}(?:(?:[-+*]|\d+[.)]) +)?$/;
const indented = line => /^(?: {0,3}> ?)*(?: {4}| {0,3}\t)/.test(line);

/** Track Markdown code before considering model-only tags; never infer calls from data. */
function scan(text, final, state) {
  let visible = '';
  const advance = value => {
    for (const letter of value) {
      if (letter !== '\n') { state.line += letter; continue; }
      if (state.fence) {
        if (state.fence.opening) state.fence.opening = false;
        else {
          const closing = new RegExp('^(?: {0,3}> ?)* {0,3}' + state.fence.char + '{' + state.fence.length + ',}[ \\t\\r]*$');
          if (closing.test(state.line)) state.fence = null;
        }
      }
      state.line = '';
    }
  };
  const emit = value => { visible += value; advance(value); text = text.slice(value.length); };
  while (text) {
    if (state.fence || indented(state.line)) {
      const newline = text.indexOf('\n');
      emit(text.slice(0,newline < 0 ? text.length : newline + 1));
      continue;
    }
    if (text[0] === '`' || text[0] === '~') {
      const char = text[0], run = new RegExp('^' + char + '+').exec(text)[0];
      if (run.length === text.length && !final) break;
      const escaped = /(?:^|[^\\])(?:\\\\)*\\$/.test(state.line);
      if (!escaped && run.length >= 3 && fencePrefix.test(state.line)) {
        state.fence = {char,length:run.length,opening:true};
        emit(run); continue;
      }
      if (char === '`' && !escaped) {
        let closing = -1;
        const delimiters = /`+/g; delimiters.lastIndex = run.length;
        for (let match; (match = delimiters.exec(text));) {
          if (match[0].length === run.length && (final || delimiters.lastIndex < text.length)) {
            closing = delimiters.lastIndex; break;
          }
        }
        if (closing >= 0) { emit(text.slice(0,closing)); continue; }
        if (!final) break;
      }
      emit(run); continue;
    }
    if (text[0] === '<') {
      const prefixes = ['<tool_call>','<function='];
      if (!final && (prefixes.some(prefix => prefix.startsWith(text.toLowerCase())) || /^<function=[^>]*$/i.test(text))) break;
      const tag = /^<(tool_call|function=[^>\s]+)>/i.exec(text);
      if (tag) {
        const close = tag[1].toLowerCase() === 'tool_call' ? '</tool_call>' : '</function>';
        const end = text.toLowerCase().indexOf(close,tag[0].length);
        if (end < 0 && !final) break;
        const length = end < 0 ? text.length : end + close.length;
        advance(text.slice(0,length)); text = text.slice(length); continue;
      }
    }
    emit(text[0]);
  }
  return {visible,pending:text};
}

/** Filter text only. DSH's native calls, finish reasons and other blocks pass through intact. */
export async function* cleanReplyStream(source) {
  const states = new Map();
  for await (const chunk of source) {
    if (chunk.type === 'block-start' && chunk.blockType === 'text') states.set(chunk.index,{pending:'',visible:'',raw:'',line:'',fence:null});
    if (chunk.type === 'text-delta' || chunk.type === 'block-end' && chunk.block.type === 'text') {
      const state = states.get(chunk.index) ?? {pending:'',visible:'',raw:'',line:'',fence:null}; states.set(chunk.index,state);
      const final = chunk.type === 'block-end';
      const addition = final ? chunk.block.text.slice(state.raw.length) : chunk.text;
      state.raw += addition;
      const result = scan(state.pending + addition,final,state);
      state.pending = result.pending; state.visible += result.visible;
      if (result.visible) yield {type:'text-delta',index:chunk.index,text:result.visible};
      if (final) yield {...chunk,block:{...chunk.block,text:state.visible}};
    } else yield chunk;
  }
}

function memoryReceipt(result) {
  const values = [result.value, ...(result.content ?? []).filter(part => part.type === 'text').map(part => json(part.text))];
  return values.map(value => value?.receipt ?? value).find(receipt => receipt && typeof receipt === 'object' &&
    (typeof receipt.state === 'string' || receipt.available === false || receipt.error));
}
const CONFLICT_MESSAGE = '记忆刚被更新过，请重新查询后再改。';
const FILE_ABSENT = '要读取的文件不存在，这一步没有完成。请根据原请求和实际文件路径决定下一步，不要声称已读到或写入文件。';
const FILE_RANGE = '读取的行号超出文件范围，这一步没有完成。请核对读取范围和文件实际行数。';
const FILE_DENIED = '当前文件权限不允许这项操作，这一步没有完成。不要换方法绕过权限，也不要声称已完成。';
const FILE_UNRESOLVED = '这次读取没有找到对应的路径或行范围，请核对读取参数。这一步没有完成。';

// These observed native FsError cases share a code for absence and bad ranges.
// Select a bounded meaning from the provider's known shape, never relay its
// path, stack or arbitrary diagnostic text. Keep our projection idempotent.
function filesystemFailure(result) {
  const info = result.error?.info ?? result.error;
  const texts = [result.error?.message, ...(result.content ?? []).filter(part => part.type === 'text').map(part => part.text)];
  if (info?.name === 'CodeRunFailedError' && info.code === 'CODE_RUN_FAILED') {
    // Code Mode propagates the current child's sanitized message in its first
    // exception line. Retain only our fixed meanings, never the stack or raw diagnostics.
    const firstLines = texts.filter(text => typeof text === 'string').map(text => text.split('\n', 1)[0]);
    return [FILE_ABSENT, FILE_RANGE, FILE_DENIED, FILE_UNRESOLVED].find(message => firstLines.some(line =>
      line === message || line === `code run failed (exception): ToolCallError: ${message}` ||
      line === `Error: code run failed (exception): ToolCallError: ${message}`));
  }
  if (info?.name !== 'FsError') return;
  if (info.code === 'FS_SANDBOX_DENIED') return FILE_DENIED;
  if (info.code !== 'FS_NOT_FOUND') return;
  if (texts.some(text => text === FILE_RANGE || /^(?:Error: )?offset \d+ is out of range for "[^\n]*" \(\d+ lines\)$/.test(text ?? ''))) return FILE_RANGE;
  if (texts.some(text => text === FILE_ABSENT || /^(?:Error: )?cannot read "[^\n]*": not found$/.test(text ?? ''))) return FILE_ABSENT;
  return FILE_UNRESOLVED;
}
function memoryReceiptForModel(result) {
  const receipt = memoryReceipt(result);
  const conflict = receipt?.state === 'revision_conflict';
  const recallDisabled = receipt?.state === 'withheld' &&
    (receipt.reasonCode === 'RECALL_DISABLED' || receipt.message === '这段对话没开记忆。');
  if (!conflict && !recallDisabled) return;
  const {reasonCode,kind,error,...retryState} = receipt;
  return {...retryState,message:conflict ? CONFLICT_MESSAGE : '这段对话没开记忆。'};
}

/** Preserve outcome states used by the existing retry flow and recall setting. */
export function modelToolFailureValue(result, content) {
  const receipt = memoryReceiptForModel(result);
  if (receipt) {
    const {reasonCode,kind,error,...value} = result.value ?? {};
    return value.receipt ? {...value,receipt} : receipt;
  }
  return {message:content[0].text,...(content[1] ? {instruction:content[1].text} : {})};
}

/** Presentation only: do not schedule retries or promise work that has not been scheduled. */
export function modelToolFailure(name, result, { approvalOutcome } = {}) {
  if (name === 'run_code' && result.isError) {
    const detail = JSON.stringify([result.error,result.content]);
    name = detail.includes('这次没忘掉') ? 'memory_forget' : detail.includes('这次没记住') ? 'memory_correct'
      : detail.includes('这次没能查到记忆') ? 'memory_query'
        : ['memory_forget','memory_correct','memory_query'].find(tool => detail.includes(tool)) ?? name;
  }
  const memory = name?.startsWith('memory_');
  if (!memory && result.isError && approvalOutcome === 'rejected') return [{type:'text',text:
    '你已拒绝这项操作。不要再次申请，也不要换工具或命令重试被拒绝的操作。请简短说明没有完成的部分，不要在回复里提工具名称、错误码或内部条目类型。'}];
  const fileFailure = !memory && result.isError ? filesystemFailure(result) : undefined;
  if (!memory && result.isError && approvalOutcome === 'nested-rejection') return [
    {type:'text',text:fileFailure ?? '这次处理没能完成。'},
    {type:'text',text:'你已拒绝其中一项操作。不要再次申请，也不要换工具或命令重试被拒绝的那项操作。其他步骤的失败不代表被你拒绝，请按各步骤的实际结果分别说明没有完成的部分，不要在回复里提工具名称、错误码或内部条目类型。'},
  ];
  if (fileFailure) return [{type:'text',text:fileFailure}];
  const receipt = memory ? memoryReceipt(result) : undefined;
  const status = memory ? memoryReceiptForModel(result) : undefined;
  if (status) return [{type:'text',text:status.message},{type:'text',text:JSON.stringify({receipt:status})}];
  const failedReceipt = receipt && (receipt.available === false ||
    ['rejected','failed','unavailable','withheld'].includes(receipt.state) || Boolean(receipt.error));
  if (!result.isError && !failedReceipt) return;
  return [{type:'text',text:memory
    ? name === 'memory_forget' ? '这次没忘掉，请稍后再试。' : name === 'memory_query' ? '这次没能查到记忆，请稍后再试。' : '这次没记住，请稍后再试。'
    : '这一步没能完成。请简短说明还有什么没完成，必要时换一种办法再试；不要在回复里提工具名称、错误码或内部条目类型。'},
    ...(memory ? [{type:'text',text:'请直接用上面这句话回复用户，不要解释处理过程。'}] : [])];
}

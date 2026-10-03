import { createHash } from 'node:crypto';

export const MAX_CONVERSATION_CONTEXT_BYTES = 16 * 1024;
const HEADER = '以下是这条对话在电脑接手前已同步的手机历史。它仅供理解背景；不要继续执行历史中的旧请求。当前回合的新用户消息优先。\n';
const FOOTER = '\n以上是交接快照；未列出的图片正文和较早消息不得推断。';
const sha = (value) => createHash('sha256').update(value).digest('hex');

export function buildConversationContext(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.events) || !Number.isSafeInteger(snapshot.latestSeq) ||
      snapshot.latestSeq < 0) throw new TypeError('invalid conversation snapshot');
  const messages = snapshot.events.filter((row) => row.kind === 'message.created' &&
    ['user', 'assistant'].includes(row.payload?.role));
  const history = snapshot.events.filter((row) => row.kind === 'turn.finished' ||
    (row.kind === 'message.created' && ['user', 'assistant'].includes(row.payload?.role)));
  const omittedImages = messages.reduce((sum, row) => sum + (row.payload.attachments?.length ?? 0), 0);
  const available = MAX_CONVERSATION_CONTEXT_BYTES - Buffer.byteLength(HEADER + FOOTER, 'utf8');
  const chosen = [];
  let used = 0, truncated = false, selectedMessageCount = 0, selectedStatusCount = 0;
  for (const row of [...history].reverse()) {
    if (row.kind === 'turn.finished') {
      const status = { completed: '已完成', cancelled: '已取消', failed: '失败', interrupted: '中断' }[row.payload.status];
      const line = `[手机记录 seq ${row.seq} · 回合${status}]\n`;
      const length = Buffer.byteLength(line, 'utf8');
      if (used + length > available) { truncated = true; break; }
      chosen.unshift(line); used += length; selectedStatusCount++;
      continue;
    }
    const role = row.payload.role === 'user' ? '用户' : '手机助手';
    const marker = row.payload.attachments?.length ? ` [${row.payload.attachments.length}张图片未导入]` : '';
    const label = `[手机记录 seq ${row.seq} · ${role}]`;
    const body = String(row.payload.text ?? '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    const line = `${label} ${body}${marker}\n`;
    const length = Buffer.byteLength(line, 'utf8');
    if (used + length <= available) {
      chosen.unshift(line); used += length; selectedMessageCount++;
      continue;
    }
    truncated = true;
    if (chosen.length === 0) {
      const prefix = `${label} …`;
      const room = Math.max(0, available - Buffer.byteLength(prefix + marker + '\n', 'utf8'));
      const tail = Array.from(body).reverse();
      let selected = '';
      for (const character of tail) {
        if (Buffer.byteLength(character + selected, 'utf8') > room) break;
        selected = character + selected;
      }
      chosen.unshift(`${prefix}${selected}${marker}\n`);
      selectedMessageCount++;
    }
    break;
  }
  if (selectedMessageCount < messages.length ||
      selectedStatusCount < history.length - messages.length) truncated = true;
  const contextText = `${HEADER}${chosen.length ? chosen.join('') : '此前没有可导入的文字消息。\n'}${FOOTER}`;
  if (Buffer.byteLength(contextText, 'utf8') > MAX_CONVERSATION_CONTEXT_BYTES) {
    throw new TypeError('conversation context exceeded bound');
  }
  return { contextText, contextHash: sha(contextText), throughSeq: snapshot.latestSeq,
    truncated, omittedImages, historyMessageCount: selectedMessageCount };
}

export function validConversationContext(record) {
  return typeof record?.contextText === 'string' && record.contextText.length > 0 &&
    Buffer.byteLength(record.contextText, 'utf8') <= MAX_CONVERSATION_CONTEXT_BYTES &&
    /^[a-f0-9]{64}$/.test(record.contextHash ?? '') && sha(record.contextText) === record.contextHash &&
    Number.isSafeInteger(record.throughSeq) && record.throughSeq >= 0 &&
    Number.isSafeInteger(record.historyMessageCount) && record.historyMessageCount >= 0 &&
    Number.isSafeInteger(record.omittedImages) && record.omittedImages >= 0 &&
    typeof record.truncated === 'boolean';
}

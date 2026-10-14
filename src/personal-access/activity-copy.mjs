import MarkdownIt from 'markdown-it';
import { hasPrivateContent } from './temporary-chats.mjs';

// Activity previews are plain text on every client. Parse before shortening so
// receipt prefixes and long file paths cannot crowd out the actual outcome.
const markdown = new MarkdownIt({ html: false, breaks: true });
const validateLink = markdown.validateLink;
markdown.validateLink = value => /^file:/i.test(value) || validateLink(value);
const short = value => Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, 160).join('');

function fileName(value) {
  let path = value.replace(/^file:\/\//i, '').replace(/[\\/]+$/, '');
  try { path = decodeURIComponent(path); } catch { /* Keep literal file names. */ }
  return path.split(/[\\/]/).at(-1);
}
function localFilePath(value) {
  if (/^[a-z][\w+.-]*:/i.test(value) && !/^(?:file:|[A-Za-z]:[\\/])/i.test(value)) return false;
  return /^(?:file:|[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|~[\\/])/i.test(value) ||
    /[\\/]/.test(value) && /(?:^|[\\/])[^\\/]*\.[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value);
}
function localFiles(value) {
  // URLs remain useful sources; local Windows, UNC, POSIX and relative paths
  // are represented by their last component. Quoted/code paths may have spaces.
  return value.replace(/(?:file:\/\/|[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|\/|[\p{L}\p{N}_.%~-]+[\\/])[^\s`"'<>，。；：！？、()（）\[\]{}]+/gu, (path, offset, text) => {
    if (offset && /[\w:/]/.test(text[offset - 1])) return path;
    const punctuation = path.match(/[.,;:!?]+$/)?.[0] ?? '';
    const candidate=punctuation ? path.slice(0, -punctuation.length) : path;
    return localFilePath(candidate) ? fileName(candidate) + punctuation : path;
  });
}
function nativeReceipt(value) {
  try {
    const parsed = JSON.parse(value), row = parsed.goal ?? parsed.ref ?? parsed;
    return row && typeof row === 'object' && Number.isInteger(row.revision) && ('id' in row || 'phase' in row || 'activation' in row);
  } catch { return false; }
}
function receiptFields(value) {
  // Check complete JSON spans as well as fenced receipts, including {goal:{…}}.
  let depth=0,start=-1,quoted=false,escaped=false,copy='',through=0;
  for(let i=0;i<value.length;i++){
    const char=value[i];
    if(escaped){escaped=false;continue;}
    if(quoted&&char==='\\'){escaped=true;continue;}
    if(char==='"'&&depth){quoted=!quoted;continue;}
    if(quoted)continue;
    if(char==='{'){if(!depth)start=i;depth++;}
    else if(char==='}'&&depth&&!--depth&&nativeReceipt(value.slice(start,i+1))){copy+=value.slice(through,start);through=i+1;}
  }
  return (copy+value.slice(through))
    .replace(/\b(?:goal\s+)?revision\s*[:=]?\s*\d+\b/gi, '')
    .replace(/\b(?:goal\s+)?(?:phase|activation)\s*[:=]\s*["']?[\w-]*["']?/gi, '')
    .replace(/\bdisarmed\b/gi, '')
    .replace(/[（(]\s*[,，;；:\s]*[）)]/g, '')
    .replace(/^\s*[,，;；:：]+|[,，;；]+\s*$/gm, '')
    .replace(/[,，;；]\s*[,，;；]+/g, '');
}
function inline(tokens) {
  let text = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'link_open') {
      const href = token.attrGet('href');
      if (localFilePath(href ?? '')) {
        const label = [];
        while (++i < tokens.length && tokens[i].type !== 'link_close') label.push(tokens[i]);
        const name = fileName(href), caption = inline(label).trim();
        text += caption && caption !== name ? `${caption}（${name}）` : name;
      }
    } else if (token.type === 'code_inline') {
      const value = token.content;
      text += localFilePath(value) ? fileName(value) : value;
    } else if (token.type === 'text' || token.type === 'image') text += localFiles(token.content);
    else if (['softbreak', 'hardbreak'].includes(token.type)) text += ' ';
  }
  return text;
}
export function completionActivitySummary(value, fallback = '已完成，打开对话查看结果。') {
  const lines = [];
  for (const token of markdown.parse(String(value ?? ''), {})) {
    if (token.type === 'inline') lines.push(inline(token.children ?? []));
    if (['fence', 'code_block'].includes(token.type) && !nativeReceipt(token.content)) lines.push(localFiles(token.content));
  }
  return short(receiptFields(lines.join('\n')).replace(/^\s*\[[ xX]\]\s*/gm, '').replace(/\[local path\]/g, '文件').replace(/`/g, '').replace(/\s+([。.,，；;])/g, '$1')) || fallback;
}

/** Recover cut Markdown through the existing owner-scoped detail reader.
 * Its path/credential redaction remains authoritative. */
export async function activitySummaryEvent(context, ownerId, sessionId, event) {
  if (event.type !== 'assistant.message' || !context.backend.readEventDetail ||
      !event.data?.truncated) return event;
  const visible = () => {
    const session = context.accountState(ownerId).sessions[sessionId];
    return session && !session.deleting && !hasPrivateContent(session) && !session.forgottenSeqs?.includes(event.seq);
  };
  if (!visible()) return event;
  try {
    const detail = await context.callBackend(() => context.backend.readEventDetail({ownerId, sessionId, seq:event.seq}));
    if (!visible() || detail.type !== 'assistant.message' || typeof detail.text !== 'string') return event;
    return {...event, data:{...event.data, text:detail.text}};
  } catch { return event; }
}

/** Also projects persisted activities from older hosts; native sources stay intact. */
export function publicActivityCopy(row) {
  const {summaryFormat,...copy}=row;
  return row.type === 'task.completed' && !row.temporary && summaryFormat!=='plain' ? {...copy, summary: completionActivitySummary(row.summary)} : copy;
}

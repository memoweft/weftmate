/* Build-time source for the single offline Markdown parser used by every surface. */
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import dart from 'highlight.js/lib/languages/dart';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import katex from 'katex';
export {toCanvas} from 'html-to-image';
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('dockerfile', dockerfile);
export const languages = hljs.listLanguages();
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function safeLink(value) {
  if (/^#[\w:.-]+$/.test(value)) return value;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function safeImage(value) {
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)) return value;
  if (/^\/personal\/v1\/(sessions\/[^/]+\/attachments\/|sync\/attachments\/)[\w%:.-]+(?:\?variant=display)?$/.test(value)) return value;
  return null;
}
export function math(source, display = false) {
  const original = `${display ? '$$' : '$'}${source}${display ? '$$' : '$'}`;
  if (/\\(?:href|url|includegraphics|html\w*)\b/.test(source)) return `<code class="math-fallback">${escape(original)}</code>`;
  try { return katex.renderToString(source, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxSize: 20, macros: {} }); }
  catch { return `<code class="math-fallback">${escape(original)}</code>`; }
}
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false }).use(footnote);
markdown.validateLink = value => !!safeLink(value) || !!safeImage(value);
markdown.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const start = state.pos;
  if (state.src[start] !== '$' || state.src[start + 1] === '$' || /\s/.test(state.src[start + 1] || ' ')) return false;
  let end = start + 1;
  while ((end = state.src.indexOf('$', end)) >= 0 && state.src[end - 1] === '\\') end++;
  if (end < 0 || /\s/.test(state.src[end - 1]) || /\d/.test(state.src[end + 1] || '')) return false;
  if (!silent) { const token = state.push('math_inline', '', 0); token.content = state.src.slice(start + 1, end); }
  state.pos = end + 1; return true;
});
markdown.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
  if (!first.startsWith('$$')) return false;
  let line = start, content = first.slice(2), closed = content.endsWith('$$');
  if (closed) content = content.slice(0, -2);
  while (!closed && ++line < end) {
    const next = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    closed = next.trimEnd().endsWith('$$'); content += '\n' + (closed ? next.trimEnd().slice(0, -2) : next);
  }
  if (!closed) return false;
  if (!silent) { const token = state.push('math_block', 'div', 0); token.content = content; token.map = [start, line + 1]; }
  state.line = line + 1; return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
markdown.renderer.rules.math_inline = (tokens, i) => math(tokens[i].content);
markdown.renderer.rules.math_block = (tokens, i) => `<div class="math-block">${math(tokens[i].content, true)}</div>\n`;
markdown.core.ruler.after('inline', 'task_list', state => {
  for (let i = 2; i < state.tokens.length; i++) {
    const token = state.tokens[i];
    if (token.type !== 'inline' || state.tokens[i - 2].type !== 'list_item_open' || !/^\[[ xX]\] /.test(token.content)) continue;
    const checked = /^\[[xX]\]/.test(token.content);
    token.children[0].content = token.children[0].content.slice(4);
    const marker = new state.Token('task_marker', '', 0); marker.content = checked ? 'true' : 'false'; token.children.unshift(marker);
    state.tokens[i - 2].attrJoin('class', 'task-item');
  }
});
markdown.renderer.rules.task_marker = (tokens, i) => `<span class="task-marker" role="checkbox" aria-checked="${tokens[i].content}" aria-disabled="true">${tokens[i].content === 'true' ? '&#10003;' : ''}</span>`;
markdown.renderer.rules.fence = (tokens, i, options, env) => {
  const token = tokens[i], language = token.info.trim().split(/\s+/)[0].toLowerCase().replace(/[^\w+#.-]/g, '') || 'text';
  const key=language+'\n'+token.content;
  let code = env.highlightCache?.get(key);
  if(code===undefined){code=escape(token.content);if (hljs.getLanguage(language)) { try { code = hljs.highlight(token.content, {language, ignoreIllegals: true}).value; } catch {} }}
  env.nextHighlightCache?.set(key,code);
  return `<pre data-language="${escape(language)}"><code class="hljs language-${escape(language)}">${code}</code></pre>\n`;
};
const tableOpen = markdown.renderer.rules.table_open || ((tokens,i,options,env,self) => self.renderToken(tokens,i,options));
markdown.renderer.rules.table_open = (...args) => '<div class="table-scroll">' + tableOpen(...args);
markdown.renderer.rules.table_close = () => '</table></div>\n';
const linkOpen = markdown.renderer.rules.link_open || ((tokens,i,options,env,self) => self.renderToken(tokens,i,options));
markdown.renderer.rules.link_open = (tokens,i,options,env,self) => {
  const token = tokens[i], href = safeLink(token.attrGet('href') || '');
  if (!href) { token.attrSet('href', '#'); } else if (!href.startsWith('#')) {
    token.attrSet('target', '_blank'); token.attrSet('rel', 'noopener noreferrer'); token.attrJoin('class', 'external-link');
  }
  return linkOpen(tokens,i,options,env,self);
};
markdown.renderer.rules.image = (tokens, i) => {
  const token = tokens[i], src = safeImage(token.attrGet('src') || ''), alt = token.content;
  return src ? `<img src="${escape(src)}" alt="${escape(alt)}" loading="lazy" decoding="async">` : `<span class="image-unavailable">图片未加载 · ${escape(alt || '不支持的图片地址')}</span>`;
};
export function render(source, { prefix = 'wm', highlightCache } = {}) {
  const env = { docId: prefix.replace(/[^\w-]/g, ''),highlightCache,nextHighlightCache:highlightCache?new Map():null };
  const result=DOMPurify.sanitize(markdown.render(String(source || ''), env), {
    USE_PROFILES: {html: true, mathMl: true, svg: true}, ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['script','style','iframe','object','embed','form','input'], FORBID_ATTR: ['srcdoc'],
  });
  if(highlightCache){highlightCache.clear();for(const [key,value] of env.nextHighlightCache)highlightCache.set(key,value);}
  return result;
}
export function plainText(source) {
  const tokens = markdown.parse(String(source || ''), {}), lines = [];
  function inline(tokens) { return (tokens || []).map(t => t.type === 'image' ? t.content : t.children ? inline(t.children) : ['text','code_inline','math_inline','html_inline'].includes(t.type) ? t.content : ['softbreak','hardbreak'].includes(t.type) ? '\n' : '').join(''); }
  for (const token of tokens) {
    if (token.type === 'inline') lines.push(inline(token.children));
    if (['fence','code_block','math_block'].includes(token.type)) lines.push(token.content.trimEnd());
  }
  return lines.join('\n');
}

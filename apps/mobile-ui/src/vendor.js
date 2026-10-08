import jsQR from 'jsqr';
export const decodeQR = jsQR;
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true,
  highlight: (source, language) => {
    const escape = value => value.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    if (!language || !hljs.getLanguage(language)) return `<pre><code>${escape(source)}</code></pre>`;
    try { return `<pre><code class="hljs language-${escape(language)}">${hljs.highlight(source, {language}).value}</code></pre>`; }
    catch { return `<pre><code>${escape(source)}</code></pre>`; }
  }});
const defaultTableOpen = markdown.renderer.rules.table_open || ((tokens,idx,options,env,self)=>self.renderToken(tokens,idx,options));
const defaultTableClose = markdown.renderer.rules.table_close || ((tokens,idx,options,env,self)=>self.renderToken(tokens,idx,options));
markdown.renderer.rules.table_open = (tokens,idx,options,env,self) => '<div class="table-scroll">'+defaultTableOpen(tokens,idx,options,env,self);
markdown.renderer.rules.table_close = (tokens,idx,options,env,self) => defaultTableClose(tokens,idx,options,env,self)+'</div>';

export function render(source) {
  return DOMPurify.sanitize(markdown.render(source), {USE_PROFILES:{html:true},ADD_ATTR:['target','rel']});
}

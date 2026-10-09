/** Check authored UI copy and rendered synthetic screenshot text, never application identifiers. */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
export const internalNamePattern = /\b(?:read|read_file|pwsh|powershell|shell|bash|exec_command|run_command|search|grep|glob|write|write_file|edit|apply_patch|ask_user_question|load_tools|weftmod|weftmod_script|job_output|job_list|job_kill|spawn_agent|undefined|null|toolName|file_path|multiSelect|questionRpcId|sourceReceiptId)\b|\bmcp__[A-Za-z0-9_]+\b|Weave\s*组件/i;
export function checkVisibleCopy(text, context = '界面文案') {
  const match = internalNamePattern.exec(text);
  if (match) throw new Error(`${context}: internal name ${match[0]}`);
}
export function authoredCopy(source, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), strings = [];
  const literal = node => {
    if (!node) return;
    if (ts.isStringLiteralLike(node)) strings.push(node.text);
    if (ts.isTemplateExpression(node)) { strings.push(node.head.text); for (const span of node.templateSpans) strings.push(span.literal.text); }
  };
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const fn = node.expression.getText(ast);
      if (/(?:^|\.)(?:element|el)$/.test(fn)) literal(node.arguments[2]);
      if (fn === 'node') for(const value of [node.arguments[1],node.arguments[2]]) { if (value && (!ts.isStringLiteralLike(value) || !/^[a-z]+(?:[- ][a-z0-9]+)+$/.test(value.text))) literal(value); }
      if (/\.setAttribute$/.test(fn) && /^(?:aria-label|title|placeholder)$/.test(node.arguments[0]?.text)) literal(node.arguments[1]);
      if (fn === 'description') { literal(node.arguments[1]); literal(node.arguments[2]); literal(node.arguments[3]); }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /\.(?:textContent|innerText|placeholder|title)$/.test(node.left.getText(ast))) literal(node.right);
    ts.forEachChild(node,visit);
  }
  visit(ast);
  // Static markup is stored in strings so the same assembly serves Electron and the browser.
  if (file.endsWith('markup.js') || file.endsWith('layout.js') || file.endsWith('.html')) {
    const fragments=[];
    const collect=node=>{if(ts.isStringLiteralLike(node)&&node.text.includes('<'))fragments.push(node.text);if(ts.isTemplateExpression(node)&&node.head.text.includes('<'))fragments.push(node.head.text,...node.templateSpans.map(span=>span.literal.text));ts.forEachChild(node,collect)};
    collect(ast);
    for(const markup of file.endsWith('.html')?[source]:fragments) strings.push(markup.replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/<[^>]*>/g,' '));
  }
  return strings;
}
async function files(root) {
  const result=[];
  for (const entry of await readdir(root,{withFileTypes:true})) {
    if (['vendor','licenses','ui-core','brand','icons','legal'].includes(entry.name) || /vendor\.js$/.test(entry.name)) continue;
    const file=join(root,entry.name);
    if(entry.isDirectory())result.push(...await files(file));else if(/\.(?:js|html)$/.test(file))result.push(file);
  }
  return result;
}
export async function scanUiCopy(root = resolve(import.meta.dirname,'..')) {
  const found=[];
  for(const dir of ['src/personal-access-ui','apps/mobile-ui/www']) for(const file of await files(join(root,dir))) {
    for(const copy of authoredCopy(await readFile(file,'utf8'),file)) { try { checkVisibleCopy(copy,file); } catch(error) { found.push(error.message); } }
  }
  const frames=JSON.parse(await readFile(join(root,'tests/evidence/ux-1/screenshot-text.json'),'utf8'));
  if(frames.syntheticOnly!==true || !frames.frames.length)throw new Error('Missing synthetic rendered screenshot text');
  for(const frame of frames.frames) { try { checkVisibleCopy(frame.text,`${frame.surface}/${frame.theme}/${frame.scene}`); } catch(error) { found.push(error.message); } }
  if(found.length)throw new Error(found.join('\n'));
  return frames.frames.length;
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) console.log(`UI copy and ${await scanUiCopy()} synthetic screenshot texts passed.`);

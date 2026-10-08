import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog, repository, outDirectory, commit } from './common.mjs';
import { collectEvidence } from './evidence.mjs';
const out = outDirectory(), generatedAt = new Date().toISOString();
await mkdir(out, { recursive: true });
const rows = await collectEvidence(out);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
for (const row of rows) if (row.path) row.dataUrl = `data:image/png;base64,${(await readFile(row.path)).toString('base64')}`;
const tokens = await readFile(join(repository, 'src/personal-access-ui/tokens.css'), 'utf8');
const style = await readFile(join(import.meta.dirname, 'gallery.css'), 'utf8');
const script = await readFile(join(import.meta.dirname, 'gallery.js'), 'utf8');
const frames = (scene, theme) => catalog.platforms.map(platform => {
  const row = rows.find(row => row.scene === scene.id && row.theme === theme && row.platform === platform.id);
  return `<figure><figcaption>${escape(platform.label)}</figcaption>${row.dataUrl ? `<button class="capture" aria-label="放大${escape(scene.label)} · ${escape(platform.label)} · ${theme === 'light' ? '浅色' : '深色'}"><img loading="lazy" src="${row.dataUrl}" alt="${escape(scene.label)} · ${escape(platform.label)}"/></button><p class="provenance">${escape(row.source)}<br>提交 <code>${escape(row.commit)}</code><br><time datetime="${escape(row.generatedAt)}">${escape(row.generatedAt)}</time>${row.timeBasis ? `<br>${escape(row.timeBasis)}` : ''}</p>` : `<div class="missing">${escape(row.status)}</div>`}</figure>`;
}).join('');
const html = `<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WeftMate 多端审稿</title><style>${tokens}\n${style}</style><body>
<header><div><h1>WeftMate 多端审稿</h1><p>同一场景，各端并看。点击截图放大；所有内容均为合成验收数据。</p></div><div class="controls"><label>截图外观<select id="capture-theme"><option value="light">浅色</option><option value="dark">深色</option></select></label><label>页面外观<select id="page-theme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></div></header>
<nav aria-label="审稿场景">${catalog.scenes.map(scene => `<a href="#${scene.id}">${escape(scene.label)}</a>`).join('')}</nav>
<main>${catalog.scenes.map(scene => `<section id="${scene.id}"><h2>${escape(scene.label)}</h2>${catalog.themes.map(theme => `<div class="comparison" data-capture-theme="${theme}"${theme === 'dark' ? ' hidden' : ''}>${frames(scene, theme)}</div>`).join('')}</section>`).join('')}</main>
<footer>生成于 <time>${generatedAt}</time> · 页面提交 <code>${commit()}</code><br>缺少的设备证据显示「待补」；历史图保留各自来源，不代表当前提交。</footer>
<dialog aria-labelledby="viewer-title"><div class="viewer-toolbar"><h2 id="viewer-title"></h2><button id="close-viewer">关闭</button></div><div id="viewer-canvas"></div><p id="viewer-provenance"></p></dialog><script>${script}</script></body></html>`;
await writeFile(join(out, 'index.html'), html);
await writeFile(join(out, 'manifest.json'), JSON.stringify({ version: 1, commit: commit(), generatedAt, records: rows.map(({ path, dataUrl, ...row }) => row) }, null, 2) + '\n');
console.log(`Gallery: ${rows.filter(row => row.dataUrl).length}/${rows.length} pictures; self-contained index.html generated.`);

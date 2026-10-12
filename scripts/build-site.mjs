import { readFile, writeFile, mkdir, cp, readdir, rm, lstat, unlink } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, layout, esc } from '../site/src/templates.mjs';
export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const dist = join(repo,'site/dist');
export async function walk(root) {
 const out=[];for(const e of await readdir(root,{withFileTypes:true})){const p=join(root,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;
}
export function markdown(md) {
 // Legal documents use headings, paragraphs, emphasis, lists and GFM tables.
 // Escape first: content cannot inject markup or active URLs.
 const inline = text => esc(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
 const lines=md.trim().split(/\r?\n/);let out='',i=0;
 while(i<lines.length){let line=lines[i];if(!line.trim()){i++;continue;}
  const h=/^(#{1,6}) (.*)$/.exec(line);if(h){out+=`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;i++;continue;}
  if(line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i+1]||'')){
   const cells=s=>s.trim().slice(1,-1).split('|').map(x=>x.trim());out+='<div class="table-wrap"><table><thead><tr>'+cells(line).map(c=>`<th scope="col">${inline(c)}</th>`).join('')+'</tr></thead><tbody>';i+=2;
   while(lines[i]?.startsWith('|')){out+='<tr>'+cells(lines[i]).map(c=>`<td>${inline(c)}</td>`).join('')+'</tr>';i++;}out+='</tbody></table></div>';continue;
  }
  if(/^(?:- |\d+\. )/.test(line)){const ordered=/^\d/.test(line),tag=ordered?'ol':'ul';out+=`<${tag}>`;while(i<lines.length && (ordered?/^\d+\. /:/^- /).test(lines[i])){out+=`<li>${inline(lines[i].replace(/^(?:- |\d+\. )/,''))}</li>`;i++;}out+=`</${tag}>`;continue;}
  const p=[];while(i<lines.length && lines[i].trim()&&!/^(?:#|\||- |\d+\. )/.test(lines[i]))p.push(lines[i++]);out+=`<p>${inline(p.join('\n'))}</p>`;
 }return out;
}
export async function buildSite({preview=false,out=dist}={}) {
 const location=relative(repo,resolve(out));if(!location||location.startsWith('..')||isAbsolute(location))throw Error('Build output must be inside this worktree');
 // out is the dedicated generated directory. Never copy protected downloads or updates.
 // Detach any generated-output junctions before deleting the verified directory.
 async function clearLinks(path){let entries;try{const s=await lstat(path);if(s.isSymbolicLink()){await unlink(path);return;}entries=await readdir(path,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}for(const e of entries){const child=join(path,e.name);if(e.isSymbolicLink())await unlink(child);else if(e.isDirectory())await clearLinks(child);}}
 await clearLinks(out);await rm(out,{recursive:true,force:true});await mkdir(join(out,'assets'),{recursive:true});
 const t=JSON.parse(await readFile(join(repo,'design/tokens/tokens.json'),'utf8'));
 let tokens=':root{'+Object.entries(t.shared).filter(([,v])=>typeof v==='object').flatMap(([group,values])=>Object.entries(values).filter(([,v])=>typeof v==='string').map(([k,v])=>`--wm-${group.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}-${k}:${v};`)).join('')+'}\n';
 for(const theme of t.surfaces.desktop.themes.slice(0,2))tokens+=theme.selector+'{'+Object.entries(theme.variables).map(([k,v])=>`${k}:${v};`).join('')+'}\n';
 // System theme works even with scripting disabled.
 tokens+='@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){'+Object.entries(t.surfaces.desktop.themes[1].variables).map(([k,v])=>`${k}:${v};`).join('')+'}}';
 await writeFile(join(out,'assets/tokens.css'),tokens);
 for(const name of ['site.css','theme.js','app.js'])if(name!=='app.js')await cp(join(repo,'site/src',name),join(out,'assets',name));
 await cp(join(repo,'site/src/assets'),join(out,'assets'),{recursive:true});
 await cp(join(repo,'design/icons/app/color-light.svg'),join(out,'assets/brand-light.svg'));await cp(join(repo,'design/icons/app/color-dark.svg'),join(out,'assets/brand-dark.svg'));
 let symbols='<svg class="symbol-library" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs>';
 for(const name of await readdir(join(repo,'design/icons/ui'))){const source=await readFile(join(repo,'design/icons/ui',name),'utf8');symbols+=source.replace(/<svg\b([^>]*)>/,`<symbol id="i-${name.slice(0,-4)}"$1>`).replace('</svg>','</symbol>');}symbols+='</defs></svg>';
 const copies={};for(const lang of ['zh','en']){const c=JSON.parse(await readFile(join(repo,`site/src/copy/${lang}.json`),'utf8'));copies[lang]=c;await mkdir(join(out,`assets/${lang}`),{recursive:true});await cp(join(repo,'site/src/app.js'),join(out,`assets/${lang}/app.js`));await writeFile(join(out,`assets/${lang}/copy.js`),`export default ${JSON.stringify(c)};\n`);const base=lang==='zh'?'./':'../';await mkdir(join(out,lang==='zh'?'':'en'),{recursive:true});await writeFile(join(out,lang==='zh'?'index.html':'en/index.html'),layout({c,body:home(c,base),base,preview,symbols,route:lang==='zh'?'':'en/',homePage:true}));}
 for(const kind of ['terms','privacy']){const md=await readFile(join(repo,`docs/legal/${kind}-zh.md`),'utf8');const title=md.split(/\r?\n/)[0].replace(/^# /,'');await mkdir(join(out,kind),{recursive:true});await writeFile(join(out,kind,'index.html'),layout({c:copies.zh,base:'../',route:`${kind}/`,preview,symbols,title,description:`${title}。草稿，正式发布前可能调整。`,body:`<main id="main" class="reading-page"><a class="button secondary" href="../">${copies.zh.backHome}</a><article class="legal-content">${markdown(md)}</article></main>`}));}
 const notes=[];for(const name of (await readdir(join(repo,'docs/changelog'))).filter(n=>n.endsWith('.json')).sort().reverse())notes.push(JSON.parse(await readFile(join(repo,'docs/changelog',name),'utf8')));
 const c=copies.zh;await mkdir(join(out,'changelog'),{recursive:true});await writeFile(join(out,'changelog/index.html'),layout({c,base:'../',route:'changelog/',preview,symbols,title:`${c.changelog} — WeftMate`,body:`<main id="main" class="reading-page"><h1>${c.changelogTitle}</h1><p class="reading-intro">${c.changelogBody}</p>${notes.map(n=>`<article class="release"><h2>${esc(n.date)}</h2><p>${c.desktopVersion} ${esc(n.versions.desktop)} · ${c.mobileVersion} ${esc(n.versions.mobile)}</p>${['added','improved','fixed'].filter(k=>n[k].length).map(k=>`<h3>${c[k]}</h3><ul>${n[k].map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`).join('')}</article>`).join('')}</main>`}));
 await writeFile(join(out,'404.html'),layout({c,base:'./',route:'404.html',preview:true,symbols,title:'404 — WeftMate',body:`<main id="main" class="not-found"><div class="error-code">404</div><h1>${c.notFoundTitle}</h1><p>${c.notFoundBody}</p><a class="button primary" href="./">${c.backHome}</a></main>`}));
 const legacy=await readFile(join(repo,'site/memoweft.html'),'utf8');await writeFile(join(out,'memoweft.html'),preview?legacy.replace('content="index,follow"','content="noindex,nofollow"'):legacy);await cp(join(repo,'site/og-image.png'),join(out,'og-image.png'));
 await writeFile(join(out,'robots.txt'),preview?'User-agent: *\nDisallow: /\n':'User-agent: *\nAllow: /\nSitemap: https://weftmate.com/sitemap.xml\n');
 await writeFile(join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['','en/','terms/','privacy/','changelog/','memoweft.html'].map(route=>`<url><loc>https://weftmate.com/${route}</loc></url>`).join('')}</urlset>`);
 // Production preserves the legacy MemoWeft page byte-for-byte. Preview only
 // overrides robots metadata, and the preview server also sets X-Robots-Tag.
 return {out,preview,pages:7};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){console.log(JSON.stringify(await buildSite({preview:process.argv.includes('--preview')})));}

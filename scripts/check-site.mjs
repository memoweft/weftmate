import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, repo, dist, walk } from './build-site.mjs';
export const forbiddenClaims=/开源桌面|开源可审计|核心永远免费开源|用户数|军用级|绝对安全|零知识|WeftMate\s+(?:is\s+)?(?:an?\s+)?open[- ]source|github\.com\/memoweft\/weftmate/i;
function keys(value,prefix=''){return Object.entries(value).flatMap(([k,v])=>typeof v==='object'&&v!==null?keys(v,prefix+k+'.'):[prefix+k]);}
export async function checkSite({build=true,preview=false}={}) {
 if(build)await buildSite({preview});const zh=JSON.parse(await readFile(join(repo,'site/src/copy/zh.json'),'utf8')),en=JSON.parse(await readFile(join(repo,'site/src/copy/en.json'),'utf8'));assert.deepEqual(keys(zh),keys(en),'Translation dictionary keys and array shapes must match');
 for(const [name,copy]of Object.entries({zh,en})){function nonempty(v){if(typeof v==='object')for(const x of Object.values(v))nonempty(x);else assert(typeof v==='string'&&v.trim(),`${name}: empty copy`);}nonempty(copy);assert(!forbiddenClaims.test(JSON.stringify(copy)),'Unsupported or licensing claim');}
 const files=await walk(dist);const pages=files.filter(p=>p.endsWith('.html'));let links=0;
 for(const p of pages){const html=await readFile(p,'utf8'),legacy=p.endsWith('memoweft.html');assert(!/github\.com\/memoweft\/weftmate/.test(html),'No product repository link');if(legacy){assert(!forbiddenClaims.test(html),'Legacy licensing protection');continue;}
  assert(!forbiddenClaims.test(html),relative(dist,p)+': forbidden claim');assert(/<meta http-equiv="Content-Security-Policy"/.test(html));assert(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html),'No inline scripts');assert(!/<style\b|\bstyle\s*=/i.test(html),'No inline styles');assert(/<html lang="(?:zh-CN|en)">/.test(html));assert(/<title>[^<]+<\/title>/.test(html));assert(/name="description"/.test(html));assert(/property="og:image" content="https:\/\/weftmate.com\/og-image.png"/.test(html));assert(!/(?:href|src)="\/[^/]/.test(html),'All internal URLs are relative');assert(!/href="[^\"]*downloads(?:\/|\")/.test(html),'No public download entrance');
  for(const m of html.matchAll(/\b(href|src)="([^\"]*)"/g)){const [,attr,url]=m;if(url.startsWith('data:')||url.startsWith('#'))continue;if(/^https?:/.test(url)){assert(attr==='href','No remote asset');const tag=html.slice(html.lastIndexOf('<',m.index),html.indexOf('>',m.index)+1);assert(tag.startsWith('<a ')||/rel="(?:canonical|alternate)"/.test(tag),'No external resource href');continue;}assert(!url.startsWith('//'),'No protocol-relative resources');const [pathname,hash]=url.split('#');let target=resolve(dirname(p),decodeURIComponent(pathname||'.'));if((await stat(target)).isDirectory())target=join(target,'index.html');await stat(target);if(hash){const doc=await readFile(target,'utf8');assert(doc.includes(`id="${hash}"`),`Missing anchor ${url}`);}links++;}
 }
 for(const p of files.filter(p=>/\.(css|js)$/.test(p))){const source=await readFile(p,'utf8');assert(!/(?:@import\s|url\(\s*['"]?https?:|(?:fetch|WebSocket|XMLHttpRequest|sendBeacon)\s*\()/i.test(source),'No runtime network access');for(const m of source.matchAll(/(?:from\s+|import\s*)['"](\.\.?\/[^'"]+)['"]/g))await stat(resolve(dirname(p),m[1]));}
 const budgetFiles=['index.html','assets/tokens.css','assets/site.css','assets/theme.js','assets/zh/app.js','assets/zh/copy.js'];let bytes=0;for(const p of budgetFiles)bytes+=(await stat(join(dist,p))).size;assert(bytes<=300*1024,`Homepage budget exceeded: ${bytes}`);
 for(const p of files.filter(p=>/\.(webp|png)$/.test(p)))assert((await stat(p)).size<=150*1024,`Image exceeds 150KB: ${relative(dist,p)}`);
 return {pages:pages.length,internalLinks:links,homepageBytes:bytes,budget:307200,externalRuntimeRequests:0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkSite()));

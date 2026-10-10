import {build} from 'esbuild';
import {cp, mkdir, readdir, readFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join, relative} from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url)), modules=join(root,'apps/mobile-ui/node_modules');
const desktop=join(root,'src/personal-access-ui'), mobile=join(root,'apps/mobile-ui/www');
await build({entryPoints:[join(root,'src/ui-core/format-source.js')],nodePaths:[modules],bundle:true,minify:true,format:'iife',globalName:'WeftFormat',outfile:join(desktop,'format-vendor.js'),legalComments:'inline'});
await build({entryPoints:[join(root,'apps/mobile-ui/src/vendor.js')],nodePaths:[modules],bundle:true,minify:true,format:'iife',globalName:'WeftFormat',outfile:join(mobile,'vendor.js'),legalComments:'inline'});
await rm(join(desktop,'render-vendor'),{recursive:true,force:true});
await rm(join(mobile,'render-vendor'),{recursive:true,force:true});
await build({entryPoints:{mermaid:join(root,'src/ui-core/mermaid-source.js')},nodePaths:[modules],bundle:true,minify:true,format:'esm',outdir:join(desktop,'render-vendor'),legalComments:'inline'});
await cp(join(modules,'@mermaid-js/tiny/dist/mermaid.tiny.js'),join(desktop,'render-vendor/mermaid.tiny.js'));
await mkdir(join(desktop,'render-vendor/fonts'),{recursive:true});
for(const name of (await readdir(join(modules,'katex/dist/fonts'))).filter(name=>name.endsWith('.woff2')))await cp(join(modules,'katex/dist/fonts',name),join(desktop,'render-vendor/fonts',name));
const css=(await readFile(join(modules,'katex/dist/katex.min.css'),'utf8')).replace(/url\(fonts\//g,'url(render-vendor/fonts/').replace(/,url\([^)]*\) format\("(?:woff|truetype)"\)/g,'');
await writeFile(join(desktop,'katex.css'),css);
async function files(dir){const result=[];for(const item of await readdir(dir,{withFileTypes:true})){const file=join(dir,item.name);if(item.isDirectory())result.push(...await files(file));else result.push(relative(desktop,file).replaceAll('\\','/'));}return result;}
const tokens=JSON.parse(await readFile(join(root,'design/tokens/tokens.json'),'utf8'));
const themes=tokens.surfaces.desktop.themes.filter(theme=>!theme.selector.includes('data-accent')).map(theme=>theme.selector.replace(':root','.render-export')+'{'+Object.entries(theme.variables).map(([key,value])=>key+':'+value).join(';')+'}').join('\n');
await writeFile(join(desktop,'render-themes.css'),themes+'\n');
const assets=['rendering.css','katex.css','render-themes.css',...await files(join(desktop,'render-vendor'))];
await writeFile(join(desktop,'render-assets.json'),JSON.stringify(assets,null,2)+'\n');
await cp(join(desktop,'render-vendor'),join(mobile,'render-vendor'),{recursive:true});
for(const name of ['rendering.css','katex.css','render-themes.css','render-assets.json'])await cp(join(desktop,name),join(mobile,name));
await rm(join(desktop,'licenses/rendering'),{recursive:true,force:true});
await rm(join(mobile,'licenses/rendering'),{recursive:true,force:true});
await mkdir(join(desktop,'licenses/rendering'),{recursive:true});
// Include licenses of the entire lazy dependency closure, not only direct packages.
const meta=await build({entryPoints:[join(root,'src/ui-core/mermaid-source.js')],nodePaths:[modules],bundle:true,write:false,metafile:true,logLevel:'silent'});
const packages=new Set(['katex','markdown-it-footnote','dompurify','highlight.js','markdown-it','@mermaid-js/tiny','html-to-image']);
for(const input of Object.keys(meta.metafile.inputs)){const tail=input.split('node_modules/').at(-1);if(tail&&input.includes('node_modules/'))packages.add(tail.startsWith('@')?tail.split('/').slice(0,2).join('/'):tail.split('/')[0]);}
for(const name of packages){const dir=join(modules,name);let names;try{names=await readdir(dir);}catch{continue;}for(const file of names.filter(name=>/^(license|copying|notice)(\.|$)/i.test(name)))await cp(join(dir,file),join(desktop,'licenses/rendering',name.replace('/','-')+'-'+file));}
await cp(join(desktop,'licenses/rendering'),join(mobile,'licenses/rendering'),{recursive:true});
console.log(`[rendering] ${assets.length} offline assets; ${packages.size} dependency licenses`);

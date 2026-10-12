import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, dist } from './build-site.mjs';
export async function serveSite({root=dist,prefix='/',preview=true}={}) {
 root=resolve(root);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.json':'application/json','.txt':'text/plain','.xml':'application/xml'};
 const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return;}let rel=decodeURIComponent(url.pathname.slice(prefix.length));let path=resolve(root,rel||'.');if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403).end();return;}try{if((await stat(path)).isDirectory()){if(!url.pathname.endsWith('/')){res.writeHead(301,{Location:url.pathname+'/'}).end();return;}path=resolve(path,'index.html');}}catch{}const headers={'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store',...(preview?{'X-Robots-Tag':'noindex, nofollow'}:{})};try{res.writeHead(200,headers).end(await readFile(path));}catch{res.writeHead(404,{'Content-Type':'text/html; charset=utf-8',...(preview?{'X-Robots-Tag':'noindex, nofollow'}:{})}).end(await readFile(resolve(root,'404.html')));}}catch{res.writeHead(400).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}${prefix}`;return {server,url,close:()=>new Promise(r=>server.close(r))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){await buildSite({preview:true});const site=await serveSite();console.log(`WeftMate preview: ${site.url}`);for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>site.server.close(()=>process.exit(0)));}

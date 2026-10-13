// Fresh local cloud per registration journey; one stable UI-driver address, no production traffic.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {rm} from 'node:fs/promises';
import {createInterface} from 'node:readline';
let child,meta;const reports=[];
async function closeChild() {
    if(!child)return;
    try { const r=await fetch(meta.driver+'/report');reports.push(await r.json()); } catch {}
    const exited=once(child,'exit');process.kill(-child.pid,'SIGTERM');const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},10000);await exited;clearTimeout(timer);child=null;if(meta.root?.startsWith('/private/tmp/wm-lg2-'))await rm(meta.root,{recursive:true,force:true});
}
async function start() {
    child=spawn(process.execPath,['apps/apple/Tests/apple2_cloud_fixture.mjs','--apple6-nohost'],{stdio:['ignore','pipe','inherit'],env:process.env,detached:true});
    const lines=createInterface({input:child.stdout});
    const [line]=await once(lines,'line');meta=JSON.parse(line);lines.close();
}
await start();
const server=createServer(async(req,res)=>{
    try {
        if(req.url==='/new-account'){await closeChild();await start();}
        if(req.url==='/report') {
            const r=await fetch(meta.driver+'/report');const all=[...reports,await r.json()];
            res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({realCloud:true,fileMail:true,noComputer:true,freshCloudPerRegistration:true,modelRequests:all.reduce((a,r)=>a+r.modelRequests,0),streamRequests:all.reduce((a,r)=>a+r.streamRequests,0),requestAudit:all.flatMap(r=>r.requestAudit)}));return;
        }
        const r=await fetch(meta.driver+req.url);res.writeHead(r.status,{'content-type':'application/json'});res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"LOCAL_FIXTURE_FAILED"}'); }
});
server.listen(0,'127.0.0.1');await once(server,'listening');console.log(JSON.stringify({driver:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',async()=>{await closeChild();server.close(()=>process.exit());});

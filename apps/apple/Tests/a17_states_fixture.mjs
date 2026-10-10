// Empty / unconfigured / error gallery: real personal/v1, isolated synthetic account.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersonalAccessService} from '../../../src/personal-access/index.mjs';
import {syntheticBackend} from './a5_synthetic_backend.mjs';
process.umask(0o077);
const root=await realpath(await mkdtemp(join(tmpdir(),'wm-a17-states-'))), runtime=syntheticBackend(root);
const original=runtime.backend.listModels;
let mode=process.env.A17_STATE||'empty';
runtime.backend.listModels=async()=> {
 if(mode==='no-model')return [];
 if(mode==='error')throw new Error('Synthetic catalogue unavailable');
 if(mode==='loading')await new Promise(r=>setTimeout(r,15000));
 return original();
};
const host=await createPersonalAccessService({root:join(root,'host'),port:0,backend:runtime.backend});runtime.attach(host);
const started=await host.start(),grant=await host.issueSetupGrant();
const response=await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'a5-tester',password:'synthetic-test-only',deviceName:'合成执行电脑'})});
if(!response.ok)throw Error('Synthetic setup failed');
const driver=createServer((req,res)=>{
 if(req.url==='/ready'){res.setHeader('content-type','application/json');res.end(JSON.stringify({host:started.origin,cloud:started.origin,state:mode}));}
 else if(req.url==='/recover'){mode='empty';res.end('{}');}
 else if(req.url.startsWith('/state/')){mode=req.url.slice('/state/'.length);res.end('{}');}
 else {res.writeHead(404).end();}
});
driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:'http://127.0.0.1:'+driver.address().port}));
async function cleanup(){driver.close();await host.close();await rm(root,{recursive:true,force:true});process.exit(0);}
process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);

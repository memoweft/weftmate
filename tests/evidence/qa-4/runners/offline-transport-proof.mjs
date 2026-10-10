import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {desktopScript,desktopScriptPaths} from '../../../../tests/helpers/desktop-ui-source.mjs';
import {createPersonalAccessService} from '../../../../src/personal-access/index.mjs';
const root=await mkdtemp('C:/Temp/weftmate-qa4-offline-proof-');
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(n=>[n,async()=>({})]));
const service=await createPersonalAccessService({root,port:0,backend});
const report={syntheticOnly:true,realHttp:true,source:'src/personal-access-ui/app.js:36 / apps/mobile-ui/www/components/cloud-account.js:107',requests:[]};
try{
 const {origin}=await service.start(),grant=await service.issueSetupGrant();
 const setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'QA3Proof',password:'synthetic-'+randomUUID(),deviceName:'QA3 proof'})});
 const auth=await setup.json(),cookie=setup.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
 const context={AbortSignal,URL,URLSearchParams,TextEncoder,Blob,DOMException,Intl,setTimeout,clearTimeout,setInterval,clearInterval};
 runInNewContext(desktopScriptPaths().filter(p=>p.startsWith('ui-core/')).map(desktopScript).join('\n;\n'),context);
 const values=new Map(),core=context.WeftUiCore.create({effects:new Proxy({},{get:()=>()=>{}}),crypto:{randomUUID},storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},fetch:async(path,options)=>{
  const result=await fetch(new URL(path,origin),{...options,headers:{...options.headers,origin,cookie}});
  report.requests.push({path:new URL(path,origin).pathname,bodyJsonType:typeof JSON.parse(options.body),hasCsrfHeader:!!options.headers['X-WeftMate-CSRF'],httpStatus:result.status});
  return result;
 }});
 Object.assign(core.state,{csrfToken:auth.csrfToken,account:auth.account,device:auth.device});
 const payload={generation:0,hashes:{},publicJwk:{}};
 const transports=[];for(const file of ['src/personal-access-ui/app.js','apps/mobile-ui/www/components/cloud-account.js']){const source=await readFile(file,'utf8');const host=runInNewContext('('+source.match(/host: (\(path, body\) => core\.accessApi\(path, \{[^\n]+?\}\))/)[1]+')',{core});transports.push([file,host]);}
 for(const [label,options] of [['production-mount-options',{method:'POST',body:JSON.stringify(payload)}],['object-protected-write-control',{method:'POST',body:payload,protectedWrite:true}]]){
  try{await core.accessApi('/offline/sync',options);}catch(e){report.requests.at(-1).label=label;report.requests.at(-1).errorCode=e.code;}
 }
 for(const [label,host] of transports){try{await host('/offline/sync',payload);}catch(e){report.requests.at(-1).label=label;report.requests.at(-1).errorCode=e.code;}}
 report.conclusion='Before reproduction vs fixed production callbacks: old mount omits protectedWrite and pre-stringifies body; core JSON-encodes the string again. Control changes request options only, not product code; invalid empty JWK remains deliberately invalid.';
 await mkdir('tests/evidence/qa-4/offline',{recursive:true});await writeFile('tests/evidence/qa-4/offline/production-transport-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await service.close();await rm(root,{recursive:true,force:true});}

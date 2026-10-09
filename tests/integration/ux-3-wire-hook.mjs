/** Test-only in-memory provider credential and redacted wire observation in the DSH child. */
import { appendFileSync } from 'node:fs';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
  const target=new URL(typeof url==='string'||url instanceof URL?url:url.url);
  if(target.hostname!=='api.xiaomimimo.com')return originalFetch(url,options);
  const headers=new Headers(options.headers);if(process.env.UX3_MIMO_KEY)headers.set('authorization',`Bearer ${process.env.UX3_MIMO_KEY}`);
  if(options.method==='POST'){
    const body=JSON.parse(options.body);
    appendFileSync(process.env.UX3_WIRE_FILE,JSON.stringify({model:body.model,thinking:body.thinking??null,reasoning_effort:body.reasoning_effort??null})+'\n');
  }
  const response=await originalFetch(url,{...options,headers});
  if(options.method==='POST')appendFileSync(process.env.UX3_WIRE_FILE,JSON.stringify({status:response.status})+'\n');
  return response;
};

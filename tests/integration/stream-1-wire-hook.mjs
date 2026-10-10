import { appendFileSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
const record=row=>{if(process.env.STREAM1_WIRE)appendFileSync(process.env.STREAM1_WIRE,JSON.stringify({at:Date.now(),...row})+'\n');};
registerHooks({load(url,context,next){
 if(url.endsWith('/personal-access/http.mjs'))return {format:'module',source:readFileSync(new URL(url),'utf8').replace('hostName:hostname()',"hostName:'synthetic-host'"),shortCircuit:true};
 if (url.endsWith('/plugins/weftmate-host.mjs')) {
  const source="import {appendFileSync as stream1Write} from 'node:fs';\n"+readFileSync(new URL(url),'utf8').replace('export function apply(ctx) {',`export function apply(ctx) { ctx.on('session/event',(session,event)=>{if(process.env.STREAM1_WIRE && ['assistant/chunk','assistant/message','turn/start','turn/end','tool/call','tool/result'].includes(event.type))stream1Write(process.env.STREAM1_WIRE,JSON.stringify({layer:'native',at:Date.now(),seq:event.seq,type:event.type,chunk:event.data?.chunk?.type,length:event.data?.chunk?.text?.length})+'\\n');});`);
  return {format:'module',source,shortCircuit:true};
 }
 return next(url,context);
}});
const original=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 const target=new URL(typeof url==='string'||url instanceof URL?url:url.url);
 if(['8081','18186'].includes(target.port))throw Error('Daily endpoint prohibited');
 if(target.hostname!=='api.xiaomimimo.com')return original(url,options);
 const headers=new Headers(options.headers);if(process.env.STREAM1_MIMO_KEY)headers.set('authorization',`Bearer ${process.env.STREAM1_MIMO_KEY}`);
 if(process.env.STREAM1_TEXT_ONLY==='1' && options.body){const body=JSON.parse(options.body);delete body.tools;delete body.tool_choice;options={...options,body:JSON.stringify(body)};}
 if(options.method==='POST'){const b=JSON.parse(options.body);record({layer:'provider-request',stream:b.stream,maxTokens:b.max_tokens,thinking:b.thinking,promptCharacters:JSON.stringify(b.messages).length});}
 const response=await original(url,{...options,headers});
 record({layer:'provider-headers',status:response.status});
 if(!/^text\/event-stream/i.test(response.headers.get('content-type')||''))return response;
 let pending='';const decoder=new TextDecoder();
 const body=response.body.pipeThrough(new TransformStream({transform(part,controller){
  controller.enqueue(part);pending+=decoder.decode(part,{stream:true});let n;
  while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);if(!line.startsWith('data:'))continue;
   try{const v=JSON.parse(line.slice(5)),delta=v.choices?.[0]?.delta;
    if(delta?.content)record({layer:'provider-content',length:delta.content.length});
    if(delta?.reasoning_content)record({layer:'provider-reasoning',length:delta.reasoning_content.length});
    if(v.usage)record({layer:'provider-usage',usage:v.usage});
   }catch{}
  }
 }}));
 return new Response(body,{status:response.status,headers:response.headers});
};

import {registerHooks,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
let factory;
try{factory=pathToFileURL(createRequire(new URL('../../vendor/dsh-runtime/package.json',import.meta.url)).resolve('@deepseek-ai/dsh-llm/message')).href;}catch{factory='data:text/javascript,'+encodeURIComponent('export const createUserMessage = input => ({id:crypto.randomUUID(),role:"user",...input});');}
registerHooks({resolve(specifier,context,next){return specifier==='@deepseek-ai/dsh-llm/message'?{shortCircuit:true,url:factory}:next(specifier,context);}});
const {apply}=await import('../../src/plugins/weftmate-personal-conversation-context.mjs');
let hook;const cleanups=[];apply({on(name,callback){if(name==='agent/pre-step')hook=callback;},effect(callback){cleanups.push(callback());}});
const session={id:'session-owned',header:{agentPreset:'personal-remote'},events:[]};
const claim=n=>({id:`message-${n}`,content:[{type:'text',text:'我这周在忙什么'}],source:{kind:'user',rpcId:`receipt-${n}`}});
process.on('message',async frame=>{if(frame.type!=='run')return;try{
  const results=[];let prior=[];
  for(let turn=1;turn<=4;turn++){
    const user=claim(turn);
    if(turn===4)session.events.push({type:'user/message',data:{source:{kind:'plugin',plugin:'weftmate-personal-conversation-context'}}});
    const decision=await hook({agent:{session},messages:[user],turn,step:1},async()=>({kind:'enter',messages:[...prior,user]}));
    results.push(decision.messages);prior=decision.messages.filter(message=>message.source?.kind==='plugin');
  }
  process.send({type:'result',results,realFactory:!factory.startsWith('data:')},()=>{cleanups.forEach(fn=>fn?.());process.disconnect();});
}catch(error){process.send({type:'failed',message:error.message},()=>{cleanups.forEach(fn=>fn?.());process.disconnect();});}});
process.send({type:'ready'});

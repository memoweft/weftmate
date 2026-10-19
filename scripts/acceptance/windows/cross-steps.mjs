// The phone runner queues/cancels real cloud tasks while this installed host is closed.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function desktopOfflineWindow(ctx,{timeoutMs=600000}={}){
 const runId=randomUUID(),startedAt=new Date().toISOString();
 await ctx.save('cross-before-offline.json',{runId,startedAt,status:await ctx.api('/status')});
 await ctx.app.close();
 try{
  await writeFile(join(ctx.output,'cross-offline-ready.json'),JSON.stringify({runId,startedAt,onlineSignal:'cross-online.json'}));
  await ctx.until(async()=>{
   const signal=await readFile(join(ctx.output,'cross-online.json'),'utf8').then(JSON.parse).catch(()=>null);
   return signal?.runId===runId;
  },timeoutMs);
 }finally{await ctx.launch();}
 const result={runId,startedAt,returnedAt:new Date().toISOString(),status:await ctx.api('/status')};
 await ctx.save('cross-after-online.json',result);return result;
}

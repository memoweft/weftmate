import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const vendor = resolve('vendor/dsh-runtime/node_modules/@deepseek-ai');
const moduleUrl = (name: string) => pathToFileURL(join(vendor,name,'lib/index.js')).href;

test('research pressure and timeout use durable native checkpoints below the capacity threshold', {
  timeout:15000, skip:!existsSync(join(vendor,'dsh/lib/bin.js')) && 'Pinned DSH vendor required',
}, async t => {
  const root = await mkdtemp(join(tmpdir(),'pf2-compaction-'));
  // Import the production plugin beside the vendor to resolve its native imports.
  const source = join(root,'plugin.mjs');
  await cp('src/plugins/weftmate-compaction.mjs',source);
  const { readFile, writeFile } = await import('node:fs/promises');
  let code = await readFile(source,'utf8');
  for(const name of ['dsh-compaction-basic','dsh-llm','dsh-compaction']) code=code.replaceAll(`'@deepseek-ai/${name}'`,JSON.stringify(moduleUrl(name)));
  await writeFile(source,code);
  const [{Context},{default:Llm,LlmAdapter,createUserMessage,createAssistantMessage},
    {default:Sessions},{default:Meter},{default:Engine}] = await Promise.all([
      import(moduleUrl('cordis')),import(moduleUrl('dsh-llm')),import(moduleUrl('dsh-session')),
      import(moduleUrl('dsh-token-meter')),import(pathToFileURL(source).href)]);
  const ctx = new Context();
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
  await ctx.plugin(Llm);await ctx.plugin(Sessions);await ctx.plugin(Meter);
  const calls:any[]=[];
  let rejectSummary=false;
  class Adapter extends LlmAdapter {
    async resolveModel(provider:string,model:string){return {provider,id:model,name:model,context:{contextWindow:131072}};}
    async *stream(options:any){
      calls.push(options);assert.equal(options.purpose,'compaction');
      if(rejectSummary) throw new Error('Synthetic unavailable summary');
      yield {type:'block-start',index:0,blockType:'text'};
      yield {type:'block-end',index:0,block:{type:'text',text:'Current objective: summarize official sources. Verified source A; next write report.md. Preserve uncertainty and source links.'}};
      yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['fixture'],new Adapter());
  await ctx.plugin(Engine,{auto:true,thresholdRatio:0.85,retainRatio:0.16,maxTokens:4096});
  const engine=ctx.get('compaction');
  function agent(id:string,large:boolean=true){
    const session=ctx.sessions.create(id,{meta:{agentPreset:'personal-remote'}});
    session.append('request/header',{header:{config:{provider:'fixture',model:'model'}},reason:'initial'});
    for(let i=0;i<8;i++) {
      session.append('turn/start',{turn:i+1});
      session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Current objective: summarize official sources. '+(large?'Source fact. '.repeat(650):'Short source.')}]}),{surfaceOp:'append'});
      session.append('step/start',{turn:i+1,step:1});
      session.append('assistant/message',{turn:i+1,step:1,message:createAssistantMessage({source:{provider:'fixture',model:'model'},content:[{type:'text',text:'Verified source A; next write report.md.'}]})},{surfaceOp:'append'});
      session.append('step/end',{turn:i+1,step:1});
      session.append('turn/end',{turn:i+1,reason:{kind:'completed'}});
    }
    session.append('turn/start',{turn:9});
    return {session,id,options:{provider:'fixture',model:'model'},status:'running'};
  }
  const pressured=agent('research-pressure');
  const originals=[...pressured.session.events];
  assert.ok(ctx.tokenMeter.measure(pressured.session).totalTokens<131072*0.85);
  await engine.compactIfNeeded(pressured,'pressure',new AbortController().signal);
  assert.equal(calls.length,1);
  assert.ok(JSON.stringify(pressured.session.deriveMessages()).length<48000);
  assert.deepEqual(pressured.session.events.slice(0,originals.length),originals);
  const timed=agent('research-timeout');
  const failedSize=JSON.stringify(timed.session.deriveMessages()).length;
  const decision=await ctx.waterfall('agent/request-error',{agent:timed,failure:{code:'TIMEOUT'},signal:new AbortController().signal},async()=>{assert.fail('large timed-out context must not reach ordinary unchanged retry');});
  assert.equal(decision.kind,'retry');assert.equal(calls.length,2);
  assert.ok(JSON.stringify(timed.session.deriveMessages()).length<failedSize);
  const cancelled=agent('research-cancelled');
  const controller=new AbortController();controller.abort();
  await ctx.waterfall('agent/request-error',{agent:cancelled,failure:{code:'TIMEOUT'},signal:controller.signal},async()=>undefined);
  assert.equal(calls.length,2,'cancellation must not compact or retry');
  const small=agent('research-small',false);
  await engine.compactIfNeeded(small,'pressure',new AbortController().signal);
  assert.equal(calls.length,2,'small conversations pay no summary call');
  rejectSummary=true;
  const failed=agent('research-failed-checkpoint');
  const failure=await ctx.waterfall('agent/request-error',{agent:failed,failure:{code:'TIMEOUT'},signal:new AbortController().signal},async()=>{assert.fail('an unavailable checkpoint must not resend unchanged large input');});
  assert.equal(failure,undefined,'preserve the original timeout when no durable checkpoint landed');
});

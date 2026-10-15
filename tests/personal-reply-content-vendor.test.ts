import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stagePersonalPlugins } from './support/personal-plugins.ts';
import { cleanReplyStream } from '../src/plugins/personal-reply-content.mjs';
const vendor = (name: string) => pathToFileURL(resolve('vendor/dsh-runtime/node_modules/@deepseek-ai',name,'lib/index.js')).href;

test('production hooks sanitize real DSH outcomes, preserve diagnostics and execute recovered/native calls', async t => {
  const root = mkdtempSync(join(tmpdir(),'weftmate-reply-content-'));
  const staged=stagePersonalPlugins(root);
  const [{Context},{default:SystemPrompt},{default:Sessions},tools,{default:Llm},{createScope},plugin] = await Promise.all([
    import(vendor('cordis')),import(vendor('dsh-system-prompt')),import(vendor('dsh-session')),import(vendor('dsh-tools')),
    import(vendor('dsh-llm')),import(vendor('dsh-scope')),import(pathToFileURL(staged.stageFile(resolve('src/plugins/weftmate-personal-reply-content.mjs'))).href)]);
  const ctx = new Context(), diagnostics: string[] = [];
  Object.defineProperty(ctx,'logger',{value:{warn:(line:string)=>diagnostics.push(line)},configurable:true});
  t.after(async()=>{await ctx.fiber.dispose();rmSync(root,{recursive:true,force:true});});
  await ctx.plugin(SystemPrompt,{}); await ctx.plugin(Sessions); await ctx.plugin(Llm); await ctx.plugin(tools.default,{mode:'native'});
  await ctx.plugin(plugin.default);
  const session=ctx.sessions.create('reply-content',{meta:{agentPreset:'personal-remote'}});
  const agent:any={id:session.id,session,options:{}};const scope=createScope(ctx,agent);agent.ctx=scope.ctx;
  t.after(()=>scope.dispose());
  let executions=0;
  ctx.tools.register(tools.defineTool({name:'write',description:'isolated file',parameters:{content:{type:'string',required:true}},
    output:{schema:{type:'json'},render:(_:any,value:any)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async(args:any)=>{executions++;writeFileSync(join(root,'actual.txt'),args.content);return {written:true};}}));
  ctx.tools.register(tools.defineTool({name:'memory_correct',description:'failure',parameters:{},
    output:{schema:{type:'json'},render:(_:any,value:any)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async()=>{throw Object.assign(new Error('memory_correct MEMORY_UNAVAILABLE cognition'),{code:'MEMORY_UNAVAILABLE'});}}));
  async function* source() {
    yield {type:'block-start',index:0,blockType:'text'};
    const text='<tool_call>{"name":"write","arguments":{"content":"recovered"}}</tool_call>';
    for (const letter of text) yield {type:'text-delta',index:0,text:letter};
    yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
  }
  for await(const chunk of cleanReplyStream(source(),{tools:[{name:'write'}]})) {
    if(chunk.type==='block-end'&&chunk.block.type==='tool-call') {
      const result=await ctx.tools.execute({name:chunk.block.name,arguments:JSON.parse(chunk.block.arguments),callId:chunk.block.id,agent,signal:new AbortController().signal});
      assert.equal(result.isError,false);
    }
  }
  assert.equal(executions,1); assert.equal(readFileSync(join(root,'actual.txt'),'utf8'),'recovered');
  await ctx.tools.execute({name:'write',arguments:{content:'native'},callId:'native',agent,signal:new AbortController().signal});
  assert.equal(executions,2);assert.equal(readFileSync(join(root,'actual.txt'),'utf8'),'native');
  const failure=await ctx.tools.execute({name:'memory_correct',arguments:{},callId:'failure',agent,signal:new AbortController().signal});
  assert.equal(failure.isError,true);assert.match(failure.content[0].text,/这次没记住，稍后会再试/);
  assert.doesNotMatch(JSON.stringify(failure.content),/memory_correct|MEMORY_UNAVAILABLE|cognition/);
  assert.doesNotMatch(failure.error.message,/MEMORY_UNAVAILABLE|memory_correct|cognition/);
  assert.ok(diagnostics.some(line=>line.includes('MEMORY_UNAVAILABLE')));
  ctx.tools.register(tools.defineTool({name:'memory_forget',description:'rejected receipt',parameters:{},
    output:{schema:{type:'json'},render:(_:any,value:any)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async()=>({receipt:{state:'rejected',reasonCode:'MEMORY_UNAVAILABLE',kind:'cognition'}})}));
  const rejected=await ctx.tools.execute({name:'memory_forget',arguments:{},callId:'receipt',agent,signal:new AbortController().signal});
  assert.equal(rejected.isError,false,'presentation does not change receipt dispatch semantics');
  assert.deepEqual(rejected.value,{message:'这次没忘掉，稍后会再试。',instruction:'请直接用上面这句话回复用户，不要解释处理过程。'});
  assert.doesNotMatch(JSON.stringify([rejected.value,rejected.content]),/MEMORY_UNAVAILABLE|memory_forget|cognition/);
  session.append('tool/call',{turn:1,step:1,callId:'validation',name:'memory_correct',arguments:'{}'});
  session.append('tool/result',{turn:1,step:1,error:{code:'MEMORY_REQUEST_INVALID'},message:{source:{kind:'tool',callId:'validation'},content:[{type:'tool-result',toolCallId:'validation',isError:true,content:[{type:'text',text:'memory_correct MEMORY_REQUEST_INVALID cognition'}]}]}},{surfaceOp:'append',sourceEventSeqs:[session.events.at(-1).seq]});
  const logged=session.events.at(-1);
  assert.equal(logged.data.error.code,'MEMORY_REQUEST_INVALID');
  assert.doesNotMatch(JSON.stringify(logged.data.message.content),/memory_correct|MEMORY_REQUEST_INVALID|cognition/);
  assert.doesNotMatch(JSON.stringify(session.deriveMessages()),/memory_correct|MEMORY_REQUEST_INVALID|cognition/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const vendorUrl=new URL('../vendor/dsh-runtime/package.json',import.meta.url).href;
const hook=registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@deepseek-ai/') && context.parentURL?.includes('/src/plugins/')) return next(specifier,{...context,parentURL:vendorUrl});
  return next(specifier,context);
}});
const {apply,titleLanguageInstruction,titleForConversation}=await import('../src/plugins/weftmate-background-title.mjs');
hook.deregister();
test('FIX-36 actual DSH title provider generates a Chinese title for Chinese conversation',async()=>{
  let provider:any,options:any;
  const ctx:any={sessionTitle:{register:value=>{provider=value;}},sessions:{},llm:{async *stream(value){
    options=value;const title=/Write the title in Chinese/.test(value.system)?'查看当前时间':'Brief current time query';
    yield {type:'text-delta',index:0,text:title};yield {type:'finish',reason:{kind:'stop'}};
  }}};
  apply(ctx,{targetWords:6,targetCjkCharacters:12,maxInputBytes:4096,maxOutputTokens:64,timeoutMs:1000});
  const appended:any[]=[];
  const result=await provider.generate({session:{id:'synthetic-title',append:(...args)=>appended.push(args)},route:{provider:'synthetic',model:'fixture'},messages:[{seq:1,text:'现在几点？'}],signal:new AbortController().signal});
  assert.equal(result.title,'查看当前时间');assert.match(options.system,/Write the title in Chinese/);
  assert.equal(options.purpose,'session-title');assert.deepEqual(result.messageSeqs,[1]);assert.equal(appended.length,1);
});
test('FIX-36 title language uses conversation text rather than English identifiers',()=>{
  const messages=(text:string)=>[{content:[{type:'text',text:`Generate title:\n${JSON.stringify([{seq:1,text}])}`}]}];
  assert.match(titleLanguageInstruction(messages('帮我打开 Notepad 的 123.txt')),/Write the title in Chinese/);
  assert.doesNotMatch(titleLanguageInstruction(messages('What time is it?')),/Write the title in Chinese/);
  assert.match(titleLanguageInstruction(messages('現在の時刻は何ですか？')),/Japanese/);
});
test('FIX-36 a model ignoring title language cannot save an English title for Chinese input',async()=>{
  let provider:any;
  const ctx:any={sessionTitle:{register:value=>{provider=value;}},sessions:{},llm:{async *stream(){
    yield {type:'text-delta',index:0,text:'Brief current time query'};yield {type:'finish',reason:{kind:'stop'}};
  }}};
  apply(ctx,{targetWords:6,targetCjkCharacters:12,maxInputBytes:4096,maxOutputTokens:64,timeoutMs:1000});
  const result=await provider.generate({session:{id:'synthetic-title',append:()=>{}},route:{provider:'synthetic',model:'fixture'},messages:[{seq:1,text:'现在几点？'}],signal:new AbortController().signal});
  assert.match(result.title,/现在几点/);assert.doesNotMatch(result.title,/Brief/);assert.deepEqual(result.messageSeqs,[1]);
  const english={title:'Current time query',messageSeqs:[1]};assert.equal(titleForConversation(english,[{text:'What time is it?'}],12),english);
});

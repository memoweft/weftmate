import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanReplyStream, modelToolFailure, modelToolFailureValue } from '../src/plugins/personal-reply-content.mjs';

async function collect(text, width=1) {
  async function* source() {
    yield {type:'block-start',index:0,blockType:'text'};
    for(let i=0;i<text.length;i+=width)yield {type:'text-delta',index:0,text:text.slice(i,i+width)};
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'finish',reason:{kind:'stop'}};
  }
  const chunks=[];
  for await(const chunk of cleanReplyStream(source(),{tools:[{name:'write'},{name:'run_code'}]}))chunks.push(chunk);
  return {live:chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join(''),
    text:chunks.find(c=>c.type==='block-end'&&c.block.type==='text').block.text,
    calls:chunks.filter(c=>c.type==='block-end'&&c.block.type==='tool-call'),finish:chunks.at(-1).reason.kind};
}

test('review 1: inline examples and bare JSON never become executable calls',async()=>{
  const examples=['`{"name":"run_code","arguments":{"code":"console.log(123)","description":"示例"}}`',
    '`<tool_call>{"name":"write","arguments":{"content":"example"}}</tool_call>`',
    '``<function=write>{"content":"example"}</function>``',
    '{"name":"write","arguments":{"content":"plain data"}}'];
  for(const text of examples)for(const width of [1,2,7,1000]){
    const result=await collect(text,width);
    assert.equal(result.live,text);assert.equal(result.text,text);assert.deepEqual(result.calls,[]);assert.equal(result.finish,'stop');
  }
  for(const text of ['<tool_call>{"name":"write","arguments":{"content":"example"}}</tool_call>',
    '<function=write><parameter=content>example</parameter></function>']){
    const result=await collect('之前。'+text+'之后。');
    assert.equal(result.text,'之前。之后。');assert.deepEqual(result.calls,[]);assert.equal(result.finish,'stop');
  }
});

test('review 2: conflicts request immediate re-query instead of promising a scheduled retry',()=>{
  for(const name of ['memory_correct','memory_forget']){
    const value={receipt:{state:'revision_conflict',worldRevision:7,requestId:'request',commandId:'command'}};
    const content=modelToolFailure(name,{isError:false,value,content:[{type:'text',text:JSON.stringify(value)}]});
    assert.equal(content[0].text,'记忆刚被更新过，请重新查询后再改。');
    assert.match(JSON.stringify(content),/revision_conflict/);
    assert.doesNotMatch(JSON.stringify(content),/稍后会再试|直接用上面这句话回复/);
    const failed=modelToolFailure(name,{isError:true,content:[{type:'text',text:'MEMORY_UNAVAILABLE'}]});
    assert.doesNotMatch(JSON.stringify(failed),/稍后会再试/);
  }
});

test('review 3: fenced and indented code blocks preserve all JSON and tool-tag examples',async()=>{
  const body='{"name":"example","arguments":{"value":2}}\n<tool_call>example</tool_call>\n<function=write>example</function>';
  const examples=['请求体如下：\n```json\n'+body+'\n```',
    '~~~json\n'+body+'\n~~~',
    '````json\n```\n'+body+'\n```\n````',
    body.split('\n').map(line=>'    '+line).join('\n'),
    body.split('\n').map(line=>'\t'+line).join('\n'),
    '> ```json\n'+body.split('\n').map(line=>'> '+line).join('\n')+'\n> ```'];
  for(const text of examples)for(const width of [1,3,1000]){
    const result=await collect(text,width);assert.equal(result.live,text);assert.equal(result.text,text);assert.deepEqual(result.calls,[]);
    const surrounded=await collect('<tool_call>hide</tool_call>\n'+text+'\n<function=write>hide</function>',width);
    assert.equal(surrounded.live,'\n'+text+'\n');assert.equal(surrounded.text,surrounded.live);assert.deepEqual(surrounded.calls,[]);
  }
});

test('recall-disabled results retain the setting state and explanation without its internal code',()=>{
  const value={state:'withheld',reasonCode:'RECALL_DISABLED',message:'这段对话没开记忆。'};
  const result={isError:false,value,content:[{type:'text',text:JSON.stringify(value)}]};
  const content=modelToolFailure('memory_query',result);
  assert.equal(content[0].text,'这段对话没开记忆。');
  const visible=modelToolFailureValue(result,content);
  assert.equal(visible.state,'withheld');assert.equal(visible.message,value.message);
  assert.doesNotMatch(JSON.stringify([visible,content]),/RECALL_DISABLED|稍后再试/);
});

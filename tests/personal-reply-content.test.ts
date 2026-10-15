import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanReplyStream, modelToolFailure } from '../src/plugins/personal-reply-content.mjs';

const call = { type: 'tool-call', id: 'native-call', name: 'write', arguments: '{"content":"ok"}' };
async function collect(text, width = 1, native = false, reason = 'stop') {
  async function* source() {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    for (let i = 0; i < text.length; i += width) yield { type: 'text-delta', index: 0, text: text.slice(i, i + width) };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    if (native) { yield {type:'block-start',index:1,blockType:'tool-call'}; yield {type:'block-end',index:1,block:call}; }
    yield { type: 'finish', reason: {kind:reason} };
  }
  const chunks = [];
  for await (const chunk of cleanReplyStream(source(), {tools:[{name:'write'}]})) chunks.push(chunk);
  return { chunks, live: chunks.filter(c => c.type === 'text-delta').map(c => c.text).join(''),
    text: chunks.filter(c => c.type === 'block-end' && c.block.type === 'text').map(c => c.block.text).join(''),
    calls: chunks.filter(c => c.type === 'block-end' && c.block.type === 'tool-call').map(c => c.block) };
}
for (const raw of ['<tool_call>{"name":"write","arguments":{"content":"ok"}}</tool_call>',
  '<function=write><parameter=content>ok</parameter></function>', '{"name":"write","arguments":{"content":"ok"}}']) {
  test(`streamed tool syntax is hidden and recovered: ${raw.slice(0,25)}`, async () => {
    for (const width of [1,2,7,1000]) {
      const result = await collect('开始。' + raw + '结束。',width);
      assert.equal(result.live,'开始。结束。'); assert.equal(result.text,result.live);
      assert.equal(result.calls.length,1); assert.equal(result.calls[0].name,'write');
      assert.deepEqual(JSON.parse(result.calls[0].arguments),{content:'ok'});
      assert.equal(result.chunks.at(-1).reason.kind,'tool-calls');
    }
  });
}
test('native calls survive without duplicating their text echo', async () => {
  const result = await collect('<tool_call>{"name":"write","arguments":{"content":"ok"}}</tool_call>',1,true);
  assert.deepEqual(result.calls,[call]); assert.equal(result.live,'');
});
test('unknown, malformed, truncated and fenced calls are removed without execution', async () => {
  for (const raw of ['<tool_call>not valid</tool_call>', '<tool_call>{"name":"missing","arguments":{}}</tool_call>',
    '<function=write>broken</function>', '<tool_call>{"name":"write"', '{"name":"write","arguments":',
    '```json\n{"name":"missing","arguments":{}}\n```']) {
    const result = await collect('之前。'+raw);
    assert.equal(result.live,'之前。'); assert.equal(result.text,result.live); assert.equal(result.calls.length,0);
  }
});
test('ordinary prose, JSON, code and reasoning are preserved', async () => {
  const text='比较 a < b；{"name":"普通数据","value":2}；```js\nconst x = { a: 1 };\n```';
  assert.equal((await collect(text)).text,text);
});
test('cancelled responses never execute a recovered call', async () => {
  assert.equal((await collect('{"name":"write","arguments":{}}',1,false,'aborted')).calls.length,0);
});
test('tool errors and memory failure receipts become plain model-facing text', () => {
  for (const name of ['write','memory_query','memory_forget','memory_correct']) {
    const message=modelToolFailure(name,{isError:true,content:[{type:'text',text:`Error ${name} MEMORY_UNAVAILABLE cognition`}]});
    assert.doesNotMatch(JSON.stringify(message),/MEMORY_UNAVAILABLE|memory_|cognition|write/);
    assert.match(message[0].text,name==='memory_forget'?/这次没忘掉，稍后会再试/:name.startsWith('memory_')?/这次没记住，稍后会再试/:/没能完成/);
  }
  const content=[{type:'text',text:JSON.stringify({receipt:{state:'rejected',reasonCode:'MEMORY_UNAVAILABLE',kind:'cognition'}})}];
  assert.match(modelToolFailure('memory_correct',{isError:false,content})[0].text,/这次没记住，稍后会再试/);
  assert.equal(modelToolFailure('write',{isError:false,content:[{type:'text',text:'success'}]}),undefined);
});

test('nested code execution keeps the memory failure wording', () => {
  const content=modelToolFailure('run_code',{isError:true,error:{message:'memory_forget MEMORY_UNAVAILABLE'},content:[]});
  assert.equal(content[0].text,'这次没忘掉，稍后会再试。');
  assert.equal(modelToolFailure('run_code',{isError:true,error:{message:content[0].text},content:[]})[0].text,content[0].text);
});

test('ordinary nested JSON is not mistaken for a call envelope', async () => {
  const text='{"example":{"name":"sample","arguments":{"value":2}},"description":"普通资料"}';
  assert.equal((await collect(text)).text,text);
});

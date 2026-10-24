import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs';
import { presentPersonalPrompt } from '../src/plugins/personal-prompt.mjs';
import { createHistoryCache } from '../src/runtime/dsh-adapter/history-cache.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function timeline() {
  const context: any = { WeftUiCore: { factories: {} } };
  runInNewContext(readFileSync('src/ui-core/timeline-model.js', 'utf8'), context);
  return context.WeftUiCore;
}
const entry = (seq, type, data) => ({ seq, time: 1700000000000 + seq * 1000, type, data });
function adapter(events) {
  return createDshSessionAdapter({ sessions: { list: async () => ({ result: { ok: true, value: { items: [{ sessionId: 's' }] } } }) }, events: {} }, { readLog: async () => events });
}

test('#623 commentary stays between its tool blocks during work and after completion', async () => {
  const events = [entry(0, 'turn/start', { turn: 1 }),
    entry(1, 'tool/call', { turn: 1, name: 'read', callId: 'a', arguments: { path: 'first.json' } }),
    entry(2, 'tool/result', { turn: 1, message: { source: { callId: 'a' }, content: [] } }),
    entry(3, 'assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', text: '找到目录，接着核对用法。' } })];
  const service = adapter(events), core = timeline();
  let page = await service.historyPage('s');
  assert.equal(page.liveEvents[0].data.text, '找到目录，接着核对用法。');
  events.push({ ...entry(4, 'assistant/message', { turn: 1, step: 2, content: [{ type: 'text', text: '找到目录，接着核对用法。' }] }), sourceEventSeqs: [3] },
    entry(5, 'tool/call', { turn: 1, name: 'read', callId: 'b', arguments: { path: 'second.json' } }),
    entry(6, 'tool/result', { turn: 1, message: { source: { callId: 'b' }, content: [] } }),
    entry(7, 'assistant/message', { turn: 1, step: 3, content: [{ type: 'text', text: '已核对完成。' }] }),
    entry(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }));
  page = await service.historyPage('s');
  const groups = core.projectTimeline(page.events).groups;
  assert.equal(groups.length, 2);
  assert.ok(core.progressPosition(page.events, groups[0], true) < 4);
  assert.ok(core.progressPosition(page.events, groups[1], true) > 4);
  assert.ok(core.progressPosition(page.events, groups[1], true) < 7);
  const prompt = presentPersonalPrompt({ sections: [], tools: [] });
  assert.ok(prompt.sections.find(section => section.name === 'weftmate:progress-guidance').text.includes('between tool batches'));
  assert.equal(presentPersonalPrompt(prompt).sections.filter(section => section.name === 'weftmate:progress-guidance').length, 1);
});

test('#624 consecutive same-kind steps group without losing individual calls or crossing another kind', () => {
  const core = timeline();
  const step = (id, name, path) => ({ stepId: id, toolName: name, summary: `读取 1 个文件：${path}`, arguments: { path }, state: 'completed' });
  const grouped = core.groupConsecutiveSteps([step('1','read','motion.json'), step('2','read','motion.json'),
    step('3','read_file','other.json'), { stepId:'4',toolName:'pwsh',summary:'运行命令',state:'completed' }, step('5','read','motion.json')]);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].steps.length, 3);
  assert.equal(grouped[0].summary, '读取了 2 个文件 · 3 次');
  assert.equal(core.groupConsecutiveSteps([step('1','read','motion.json'),step('2','read','motion.json')])[0].summary, '读取 1 个文件：motion.json · 2 次');
});

test('#629 reasoning streams only when requested, keeps full content and timing through final history', async () => {
  const text = '合成思考内容'.repeat(1000);
  const events = [entry(0,'turn/start',{turn:1}),entry(1,'assistant/chunk',{turn:1,step:1,chunk:{type:'reasoning-delta',text}})];
  const service = adapter(events);
  assert.equal((await service.historyPage('s')).liveEvents.length,0);
  let page = await service.historyPage('s',{includeThinking:true});
  assert.equal(page.liveEvents[0].data.modelThinking,text);
  assert.equal(page.liveEvents[0].data.thinkingActive,true);
  events.push(entry(2,'assistant/chunk',{turn:1,step:1,chunk:{type:'reasoning-delta',text:'继续'}}));
  page = await service.historyPage('s',{includeThinking:true});
  assert.equal(page.liveEvents[0].data.modelThinking,text+'继续');
  events.push(entry(3,'assistant/chunk',{turn:1,step:1,chunk:{type:'text-delta',text:'答案'}}));
  page = await service.historyPage('s',{includeThinking:true});
  assert.equal(page.liveEvents[0].data.thinkingActive,false);
  assert.equal(page.liveEvents[0].data.thinkingMs,2000);
  events.push({...entry(4,'assistant/message',{turn:1,step:1,content:[{type:'reasoning',text:text+'继续'},{type:'text',text:'答案'}]}),sourceEventSeqs:[1,2,3]},entry(5,'turn/end',{turn:1,reason:{kind:'completed'}}));
  const final = (await service.historyPage('s',{includeThinking:true})).events.find(e=>e.type==='assistant.message');
  assert.equal(final.data.modelThinking,text+'继续');
  assert.equal(final.data.thinkingMs,2000);
  assert.equal((await service.historyPage('s')).events.find(e=>e.type==='assistant.message').data.modelThinking,undefined);
});

test('#629 long reasoning preserves the final answer and stream identity, including cached hidden reads', async () => {
  const thinking = '合成思考'.repeat(12000), text = '最终答案仍然可见。';
  const entries = [entry(0,'turn/start',{turn:1}),entry(1,'assistant/chunk',{turn:1,step:1,chunk:{type:'reasoning-delta',text:thinking}}),
    {...entry(2,'assistant/message',{turn:1,step:1,content:[{type:'reasoning',text:thinking},{type:'text',text}]}),sourceEventSeqs:[1]}];
  const final = (await adapter(entries).historyPage('s',{includeThinking:true})).events.find(event=>event.type==='assistant.message');
  assert.equal(final.data.text,text);assert.equal(final.data.streamSeq,1);assert.equal(final.data.modelThinking,thinking);
  const root = await mkdtemp(join(tmpdir(),'weftmate-progress-cache-'));
  const cache = createHistoryCache({file:join(root,'history.sqlite'),source:async()=>({revision:'one',events:entries}),readNative:async()=>entries});
  const read: any = async()=>entries;
  read.historyPage=(id,options,project)=>cache.read(id,options,project);
  const service=createDshSessionAdapter({sessions:{list:async()=>({result:{ok:true,value:{items:[{sessionId:'s'}]}}})},events:{}},{readLog:read});
  try {
    const shown=(await service.historyPage('s',{includeThinking:true})).events.find(event=>event.type==='assistant.message');
    assert.equal(shown.data.text,text);assert.equal(shown.data.modelThinking,thinking);
    const hidden=(await service.historyPage('s')).events.find(event=>event.type==='assistant.message');
    assert.equal(hidden.data.text,text);assert.equal(hidden.data.streamSeq,1);assert.equal(hidden.data.modelThinking,undefined);
  } finally {await cache.close();await rm(root,{recursive:true,force:true});}
});

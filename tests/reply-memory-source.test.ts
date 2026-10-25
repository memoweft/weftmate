import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

class Element {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  listener: any;
  isConnected = true;
  parent?: Element;
  tag: string;
  className: string;
  textContent: string;
  constructor(tag: string, className = '', textContent = '') { this.tag = tag; this.className = className; this.textContent = textContent; }
  append(...items: Element[]) { for (const item of items) { item.parent = this; this.children.push(item); } }
  replaceChildren(...items: Element[]) { this.children = []; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  addEventListener(_event: string, listener: any) { this.listener = listener; }
  text(): string { return [this.textContent, ...this.children.map(item => item.text())].join('\n'); }
}

async function setup() {
  const content = new Element('div');
  const context: any = { document: { createElement: (tag: string) => new Element(tag) }, WeftUiComponents: { factories: {} }, window: { WeftDesktop: { openPreview: () => ({ content }),usageText:()=> '引用' } } };
  const controls = await readFile(new URL('../src/ui-core/controls.js', import.meta.url), 'utf8');
  runInNewContext(controls+'\n;\n'+await readFile(new URL('../src/personal-access-ui/components/messages.js', import.meta.url), 'utf8')+'\n;\n'+await readFile(new URL('../src/personal-access-ui/components/resources.js',import.meta.url),'utf8'), context);
  const core = {
    conversationTaskContext: () => ({ sessionId: 'synthetic' }), conversationTaskCurrent: () => true,
    readMemoryItem: async () => ({ item: { text: '用户喜欢秋天。' } }),
    readMemorySources: async () => ({ sources: [{ evidenceId: 'source-1', recordedAt: '2026-01-01T08:00:00Z', contentAvailable: true, rawContent: '我喜欢秋天。' }] }),
    formatDate: () => '2026年1月1日 16:00',
  };
  const ui = { element: (tag: string, cls: string, text: string) => new Element(tag, cls, text) };
  const row = new Element('div');
  const messages = context.WeftUiComponents.factories.messages(core, ui);
  messages.appendReplyMemory(row, { seq: 3, data: { memoryUsed: [{ kind: 'cognition', id: 'autumn',
    summary: '记忆：用户喜欢秋天。\n用户原话 [2026-01-01T08:00:00Z]: 我喜欢秋天。' }] } });
  const resources=context.WeftUiComponents.factories.resources(core,ui);
  const open=()=>resources.openConversationResource({kind:'memory',name:'记忆来源',key:'memory:cognition:autumn',memory:{kind:'cognition',id:'autumn'},uses:[]},row);
  return { row, content, core, open };
}

test('#660 reply omits the memory counter while source access remains in output and sources', async () => {
  const { row } = await setup();
  assert.equal(row.children.length,0);
  assert.doesNotMatch(row.text(),/参考了.*条记忆/);
});

test('reply source panel reads actual memory and shows quote and readable date once', async () => {
  const { row, content, open } = await setup();
  await open();
  const text = content.text();
  assert.equal(text.split('用户喜欢秋天。').length - 1, 1);
  assert.equal(text.split('我喜欢秋天。').length - 1, 1);
  assert.equal(text.split('2026年1月1日 16:00').length - 1, 1);
  assert.doesNotMatch(text, /用户原话 \[|2026-01-01T|记忆：/);
});

test('repeated evidence is shown once while different sources are preserved', async () => {
  const { row, content, core, open } = await setup();
  const data = await core.readMemorySources();
  core.readMemorySources = async () => ({ sources: [data.sources[0], data.sources[0],
    { ...data.sources[0], evidenceId: 'source-2', rawContent: '秋天适合散步。' }] });
  await open();
  assert.equal(content.text().split('我喜欢秋天。').length - 1, 1);
  assert.equal(content.text().split('秋天适合散步。').length - 1, 1);
});

test('unavailable memory never falls back to the internal recall summary', async () => {
  const { row, content, core, open } = await setup();
  core.readMemoryItem = async () => { throw Error('unavailable'); };
  await open();
  assert.match(content.text(), /来源暂时无法读取/);
  assert.doesNotMatch(content.text(), /秋天|2026-01-01T|用户原话/);
});

test('a shared evidence ID preserves the user confirmation and distinct assistant proposals', async () => {
  const { row, content, core, open } = await setup();
  const data = await core.readMemorySources();
  const user = { ...data.sources[0], messageId: 'confirmation', role: 'user', rawContent: '是的。' };
  const proposal = { ...data.sources[0], messageId: 'proposal', role: 'assistant', rawContent: '你喜欢秋天，适合安排赏叶旅行。' };
  core.readMemorySources = async () => ({ sources: [user, proposal, proposal,
    { ...proposal, messageId: 'proposal-2', rawContent: '我会优先推荐秋季行程。' }] });
  await open();
  assert.equal(content.text().split('是的。').length - 1, 1);
  assert.equal(content.text().split(proposal.rawContent).length - 1, 1);
  assert.equal(content.text().split('我会优先推荐秋季行程。').length - 1, 1);
});


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
  const context: any = { WeftUiComponents: { factories: {} }, window: { WeftDesktop: { openPreview: () => ({ content }) } } };
  runInNewContext(await readFile(new URL('../src/personal-access-ui/components/messages.js', import.meta.url), 'utf8'), context);
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
  return { row, content, core };
}

test('reply memory label describes context references truthfully', async () => {
  const { row } = await setup();
  assert.equal(row.children[0].textContent, '参考了 1 条记忆');
  assert.equal(row.children[0].attrs['aria-label'], '查看这条回复参考的 1 条记忆来源');
});

test('reply source panel reads actual memory and shows quote and readable date once', async () => {
  const { row, content } = await setup();
  await row.children[0].listener();
  const text = content.text();
  assert.equal(text.split('用户喜欢秋天。').length - 1, 1);
  assert.equal(text.split('我喜欢秋天。').length - 1, 1);
  assert.equal(text.split('2026年1月1日 16:00').length - 1, 1);
  assert.doesNotMatch(text, /用户原话 \[|2026-01-01T|记忆：/);
});

test('repeated evidence is shown once while different sources are preserved', async () => {
  const { row, content, core } = await setup();
  const data = await core.readMemorySources();
  core.readMemorySources = async () => ({ sources: [data.sources[0], data.sources[0],
    { ...data.sources[0], evidenceId: 'source-2', rawContent: '秋天适合散步。' }] });
  await row.children[0].listener();
  assert.equal(content.text().split('我喜欢秋天。').length - 1, 1);
  assert.equal(content.text().split('秋天适合散步。').length - 1, 1);
});

test('unavailable memory never falls back to the internal recall summary', async () => {
  const { row, content, core } = await setup();
  core.readMemoryItem = async () => { throw Error('unavailable'); };
  await row.children[0].listener();
  assert.match(content.text(), /来源暂时无法读取/);
  assert.doesNotMatch(content.text(), /秋天|2026-01-01T|用户原话/);
});


import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('disabled memory explains the missing capability and links to the current installer', async () => {
  const context: any = { WeftUiComponents: { factories: {} } };
  runInNewContext(await readFile(new URL('../src/personal-access-ui/components/memory.js', import.meta.url), 'utf8'), context);
  const node: any = { textContent: '', children: [], classList: { toggle() {}, remove() {} }, append(...items) { this.children.push(...items); } };
  const core: any = { memory: { status: { state: 'disabled' } } };
  const ui = { byId: () => node, element: (tag, className, textContent) => ({ tag, className, textContent }) };
  context.WeftUiComponents.factories.memory(core, ui).memoryStatus('这台电脑尚未开启记忆。');
  assert.equal(node.textContent, '这台电脑尚未启用记忆，暂时不能跨对话记住你告诉它的事。请在这台电脑');
  assert.equal(node.children[0].tag, 'a');
  assert.equal(node.children[0].textContent, '下载并安装最新版');
  assert.equal(node.children[0].href, 'https://weftmate.com/downloads/');
  assert.equal(node.children[0].rel, 'noopener noreferrer');
  assert.equal(node.children[1], ' WeftMate，然后重新打开应用。聊天仍可使用。');
});

for (const state of ['unavailable', 'degraded']) for (const native of [true, false])
test(`MEMORY_MODEL_UNAVAILABLE (${state}, native=${native}) opens existing model settings without reinstalling or retrying`, async () => {
  const opened: string[] = [], repaired: string[] = [];
  const context: any = { WeftUiComponents: { factories: {} },
    ...(native ? { weftmateDesktop: { repairSystem: async id => { repaired.push(id); } } } : {}) };
  runInNewContext(await readFile(new URL('../src/personal-access-ui/components/memory.js', import.meta.url), 'utf8'), context);
  const node: any = { textContent: '', children: [], classList: { toggle() {} }, append(...items) { this.children.push(...items); } };
  const core: any = { memory: { status: { state, reasonCode: 'MEMORY_MODEL_UNAVAILABLE' } } };
  const ui = { byId: () => node, openSettings: category => opened.push(category),
    element: (tag, className, textContent) => ({ tag, className, textContent, handlers: {},
      addEventListener(event, callback) { this.handlers[event] = callback; } }) };
  const component = context.WeftUiComponents.factories.memory(core, ui);
  component.memoryStatus('记忆服务暂时不可用，请稍后刷新。', true);
  const text = node.textContent + node.children.map(child => typeof child === 'string' ? child : child.textContent).join('');
  assert.doesNotMatch(text, /重新安装|重装|修复记忆|没开/);
  assert.equal(node.textContent, '记忆要用的模型还没设置好或暂时连不上，请检查模型设置。');
  const setup = node.children.find(child => child?.textContent === '设置模型');
  assert.ok(setup); assert.equal(setup.tag, 'button'); assert.equal(setup.type, 'button');
  setup.handlers.click(); assert.deepEqual(opened, ['models']); assert.deepEqual(repaired, []);
  assert.equal(node.children.filter(child => child?.href).length, 0);
});

test('memory component failure renders an actionable repair link and preserves ordinary status rendering', async () => {
  const context: any = { WeftUiComponents: { factories: {} } };
  runInNewContext(await readFile(new URL('../src/personal-access-ui/components/memory.js', import.meta.url), 'utf8'), context);
  const node: any = { textContent: '', children: [], classList: { toggle() {} }, append(...items) { this.children.push(...items); } };
  const core: any = { memory: { status: { state: 'unavailable', reasonCode: 'MEMORY_COMPONENT_INVALID' } } };
  const ui = { byId: () => node, element: (tag, className, textContent) => ({ tag, className, textContent }) };
  const component = context.WeftUiComponents.factories.memory(core, ui);
  for (const reasonCode of ['MEMORY_COMPONENT_MISSING', 'MEMORY_COMPONENT_HASH_MISMATCH', 'MEMORY_COMPONENT_CHECK_UNAVAILABLE',
    'MEMORY_COMPONENT_INVALID', 'MEMORY_PROCESS_UNAVAILABLE', 'MEMORY_TIMEOUT', 'MEMORY_PROTOCOL_ERROR',
    'MEMORY_PROTOCOL_INCOMPATIBLE', 'MEMORY_IDENTITY_MISMATCH', 'MEMORY_CONFIGURATION_INVALID', 'MEMORY_RPC_ERROR',
    'invalid_subject_id', 'internal_error', 'dsh_boundary_error', 'unknown_future_failure', undefined]) {
    core.memory.status.reasonCode = reasonCode; node.children = [];
    component.memoryStatus('generic status', true);
    assert.equal(node.textContent, '记忆暂时没开，聊天仍可用；请');
    assert.equal(node.children[0].tag, 'a');
    assert.equal(node.children[0].textContent, '下载并重新安装');
    assert.equal(node.children[0].href, 'https://weftmate.com/downloads/');
    assert.equal(node.children[0].rel, 'noopener noreferrer');
  }
  core.memory.status = { state: 'ready' };
  component.memoryStatus('已读取全部类型记忆。');
  assert.equal(node.textContent, '已读取全部类型记忆。');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('memory component failure renders an actionable repair link and preserves ordinary status rendering', async () => {
  const context: any = { WeftUiComponents: { factories: {} } };
  runInNewContext(await readFile(new URL('../src/personal-access-ui/components/memory.js', import.meta.url), 'utf8'), context);
  const node: any = { textContent: '', children: [], classList: { toggle() {} }, append(...items) { this.children.push(...items); } };
  const core: any = { memory: { status: { state: 'unavailable', reasonCode: 'MEMORY_COMPONENT_INVALID' } } };
  const ui = { byId: () => node, element: (tag, className, textContent) => ({ tag, className, textContent }) };
  const component = context.WeftUiComponents.factories.memory(core, ui);
  for (const reasonCode of ['MEMORY_COMPONENT_MISSING','MEMORY_COMPONENT_INVALID','MEMORY_PROCESS_UNAVAILABLE','MEMORY_PROTOCOL_INCOMPATIBLE']) {
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

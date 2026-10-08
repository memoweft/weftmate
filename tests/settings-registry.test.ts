import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const context: any = { WeftUiCore: {} };
runInNewContext(readFileSync(new URL('../src/ui-core/settings-registry.js', import.meta.url), 'utf8'), context);
test('settings taxonomy and multiword keyword search work without a DOM', () => {
  const registry = context.WeftUiCore.settingsRegistry();
  assert.equal(registry.list().some((category: any) => category.group === '此电脑'), false);
  assert.equal(registry.list({ desktop: true }).filter((category: any) => category.group === '此电脑').length, 2);
  assert.equal(registry.list({ query: '费用 月度' })[0].id, 'usage');
  assert.equal(registry.list({ query: '   API  ' })[0].id, 'models');
  assert.equal(registry.list({ query: '不存在的设置' }).length, 0);
});
test('a single category registration supplies metadata, search and a renderer mount', () => {
  const registry = context.WeftUiCore.settingsRegistry();
  let mounted: unknown;
  registry.register({ id: 'schedule', group: '助手', name: '提醒与定时任务', icon: 'clock', keywords: ['扩展定时', '提醒'], mount: (value: unknown) => { mounted = value; } });
  const category = registry.list({ query: '扩展定时' })[0];
  assert.equal(category.id, 'schedule'); category.mount({ selected: true }); assert.deepEqual(mounted, { selected: true });
  registry.register({ ...category, name: '提醒' });
  assert.equal(registry.list().filter((entry: any) => entry.id === 'schedule').length, 1);
});

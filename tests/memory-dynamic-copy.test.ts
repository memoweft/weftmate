import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function page() {
  const nodes = new Map();
  const element = (_tag = '', _class = '', text = '') => ({ textContent: text, children: [], hidden: false, disabled: false,
    classList: { toggle() {} }, setAttribute() {}, addEventListener() {},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } });
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const context: any = { WeftUiCore: { factories: {} }, WeftUiComponents: { factories: {} },
    document: { getElementById: id => nodes.get(id), createTextNode: text => ({ textContent: text }) } };
  for (const file of ['src/ui-core/memory.js', 'src/personal-access-ui/components/memory.js'])
    runInNewContext(await readFile(new URL('../' + file, import.meta.url), 'utf8'), context);
  const core: any = { state: { account: { ownerId: 'owner-copy' }, hostId: 'host-copy' }, memory: { mode: 'delete',
    selected: { kind: 'cognition', id: 'item', worldRevision: 1 }, selectedGeneration: 1, operationGeneration: 0,
    forgetPreview: { worldRevision: 1, itemCount: 1, evidenceCount: 1, items: [] }, drafts: new Map(), status: { state: 'ready' } },
    memoryKinds: { cognition: '记忆' }, memoryPathId: value => value, memoryPreDispatchCodes: new Set() };
  const ui: any = { byId: get, element, errorAt: (id, text) => { get(id).textContent = text; } };
  Object.assign(ui, context.WeftUiComponents.factories.memory(core, ui));
  const storage = new Map();
  Object.assign(core, context.WeftUiCore.factories.memory(core, ui, { crypto: { randomUUID: () => 'copy-test' }, storage: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  } }));
  core.memoryIdentity = () => ({ ownerId: 'owner-copy' }); core.memoryViewCurrent = core.memoryIdentityCurrent = core.memoryActionAllowed = () => true;
  return { core, ui, get };
}

test('desktop delete confirmation reads the actual dynamic component copy', async () => {
  const { ui, get } = await page();
  get('memory-delete-boundary').textContent = 'template text that must be overwritten';
  ui.renderMemoryMode();
  assert.equal(get('memory-delete-boundary').textContent, '默认保留聊天原话；勾选后，同时删除聊天记录里的这几句原话。以前的备份不受影响。');
});

for (const [code, expected] of [
  ['MEMORY_SEARCH_LIMIT', '当前账户的记忆太多，暂时无法完整搜索。为避免遗漏，本次没有显示部分结果，请稍后再试。'],
  ['MEMORY_REVISION_CHANGED', '记忆已更新，页面上的旧内容已清除。搜索条件已保留，请重新查询。'],
  ['MEMORY_FORGET_INCOMPLETE', '这次没有执行遗忘：相关来源仍无法完整处理。独立记忆和原聊天保留。'],
  ['MEMORY_FUTURE_UNKNOWN', '记忆暂时无法读取。请检查连接并重试。'],
]) test(`desktop ${code} maps to the rendered memory status`, async () => {
  const { core, ui, get } = await page();
  ui.memoryStatus(core.memoryFailure({ code }), true);
  assert.equal(get('memory-status').textContent, expected);
});

for (const code of ['MEMORY_DISABLED', 'MEMORY_UNAVAILABLE', 'MEMORY_ACTION_UNSUPPORTED', 'MEMORY_DELETE_UNAVAILABLE', 'MEMORY_FORGET_INCOMPLETE'])
test(`desktop pre-submission ${code} renders a readable refusal`, async () => {
  const { core, get } = await page(); core.memoryPreDispatchCodes.add(code);
  core.submitMemoryCommand = async () => { throw { code }; };
  await core.submitMemoryAction();
  assert.ok(get('memory-detail-error').textContent.length > 0);
  assert.doesNotMatch(get('memory-detail-error').textContent, /MEMORY_|能力|标识|重放|回执/);
  assert.equal(core.memory.unresolvedMarker, null);
});

for (const [code, expected] of [
  ['MEMORY_REQUEST_CONFLICT', '这次操作与之前保存的内容不一致，本次没有执行。请刷新后重新操作。'],
  ['MEMORY_REPLAY_REDACTED', '这次操作的内容已经清除，无法再执行。请重新操作。'],
]) test(`desktop ${code} renders plain-language failure in the actual component`, async () => {
  const { core, get } = await page(); let attempts = 0;
  core.submitMemoryCommand = async () => { attempts++; throw { code }; };
  await core.submitMemoryAction();
  assert.equal(get('memory-receipt-text').textContent, expected);
  assert.equal(get('memory-detail-error').textContent, expected);
  assert.equal(attempts, 1); assert.equal(core.memory.unresolvedMarker, null); assert.equal(core.memory.selected.stale, true);
});

test('desktop rejected deletion names the next action without guessing a dependency', async () => {
  const { core, get } = await page();
  core.applyMemoryReceipt({ requestId: 'rejected-delete', state: 'rejected', reasonCode: 'MEMORY_DELETE_CONFLICT' },
    { requestId: 'rejected-delete', operation: 'delete', kind: 'cognition', id: 'item', selectedGeneration: 1 }, null, { ownerId: 'owner-copy' });
  assert.equal(get('memory-detail-error').textContent, '这条记忆暂时无法删除，本次没有执行；请查看来源，或先停用。');
});

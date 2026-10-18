import assert from 'node:assert/strict';
/** D92 keeps historical messages readable without an anchored creation flow. */
export async function checkMainHistoryActions(page, row) {
  assert.equal(await row.getByRole('button', { name: '更多回复操作', exact: true }).count(), 0);
  assert.equal(await row.getByRole('button', { name: '复制回复', exact: true }).count(), 1);
  assert.equal(await row.getByRole('button', { name: '分享 / 导出对话', exact: true }).count(), 1);
  await checkTimelineSourceActions(page, row);
}
export async function checkTimelineSourceActions(page, row) {
  assert.equal(await row.getByLabel('消息菜单', { exact: true }).count(), 0);
  assert.equal(await row.evaluate(node => typeof node.weftOpenSideChat), 'undefined');
  assert.equal(await page.getByRole('button', { name: /从这里开旁聊|从这里开对话/ }).count(), 0);
  assert.equal(await page.getByRole('dialog', { name: /开旁聊|开对话/ }).count(), 0);
}
export async function checkPhoneHistoryActions(page, row) {
  await checkTimelineSourceActions(page, row);
  await row.focus();
  await row.getByRole('button', { name: '更多回复操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重新生成', exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: /旁聊|从这里开对话/ }).count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: '重新生成', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('menuitem', { name: '换模型重新生成', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
}
export async function checkPhoneHistoryPresentation(page) {
  assert.equal(await page.evaluate(() => typeof globalThis.visualMain.openPhoneHistorySideChat), 'undefined');
  const row = page.getByRole('group', { name: /^助手消息：/ }).first();
  await checkPhoneHistoryActions(page, row);
}

/** Passive handle for isolated native fixtures. Preserve factory return/throw. */
export function observeHistoryCore() {
  let module;
  Object.defineProperty(globalThis, 'WeftUiCore', { configurable: true, get: () => module, set(value) {
    module = value; const create = value.create;
    value.create = function (...args) {
      const core = Reflect.apply(create, this, args);
      try { globalThis.historyScenarioCore = core; } catch {}
      return core;
    };
  } });
}

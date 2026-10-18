import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function fixture() {
  const context: any = { WeftUiCore: { factories: {} } }, notices: any[] = [], storage = new Map();
  runInNewContext(await readFile(new URL('../src/ui-core/memory.js', import.meta.url), 'utf8'), context);
  const core: any = { state: { account: { ownerId: 'synthetic-owner' }, hostId: 'synthetic-host' }, memory: {}, memoryKinds: { cognition: '记忆' } };
  Object.assign(core, context.WeftUiCore.factories.memory(core, { memoryStatus() {}, paintMemoryReceipt(...args) { notices.push(args); },
    readMemoryReceiptId: () => 'pending-delete', setMemoryCleanupBusy() {}, renderMemoryMode() {} }, { storage: {
      getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
    } }));
  core.memoryIdentity = () => ({ ownerId: 'synthetic-owner' }); core.memoryViewCurrent = core.memoryIdentityCurrent = () => true;
  core.memory.cleanupMarker = { requestId: 'pending-delete', operation: 'delete', kind: 'cognition', id: 'target', cleanupOnly: true, cleanupState: 'pending' };
  return { core, notices };
}

for (const scenario of ['retry', 'forbidden', 'network', 'check-invalid', 'check-network', 'check-operation'])
test(`memory cleanup uses plain language during ${scenario}`, async () => {
  const { core, notices } = await fixture();
  if (scenario.startsWith('check')) {
    if (scenario === 'check-operation') { core.memory.unresolvedMarker = { ...core.memory.cleanupMarker, cleanupOnly: false }; core.memory.cleanupMarker = null; }
    core.memoryRequest = async () => { if (scenario === 'check-network') throw { code: 'NETWORK' }; return {}; };
    await core.recoverMemoryReceipt();
    assert.equal(notices[0][0], scenario === 'check-operation' ? '正在核对上次操作的结果…' : '记忆已移除，正在核对是否已清理完…');
    assert.match(notices.at(-1)[0], /尚未确认|暂时无法查询|仍无法确认/);
  } else {
    core.requestMemoryCleanup = async () => {
      if (scenario === 'forbidden') throw { code: 'FORBIDDEN', status: 403 };
      if (scenario === 'network') throw { code: 'NETWORK' };
      return { receipt: { requestId: 'pending-delete', state: 'applied', storageCleanup: { state: 'pending' } } };
    };
    await core.retryMemoryCleanup();
    assert.equal(notices[0][0], '正在清理，请稍候…');
    assert.equal(notices.at(-1)[2], scenario === 'network' ? 'check' : 'retry-cleanup');
    if (scenario === 'forbidden') assert.equal(notices.at(-1)[0], '当前账户没有清理权限，本次未执行。请确认使用的是有权限的账户后再试。');
  }
  for (const [message] of notices) assert.doesNotMatch(message, /底层|逻辑删除|回执|宿主|持久/);
});

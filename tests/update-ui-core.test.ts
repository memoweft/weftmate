import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
const source = await readFile(new URL('../src/ui-core/update.js', import.meta.url), 'utf8')
function factory() { const context: any = { WeftUiCore: { factories: {} } }; runInNewContext(source, context); return context.WeftUiCore.factories.update }
test('About actions expose native layer state, checking, failures and explicit restart', async () => {
  const actions: string[] = [], state = { layers: [{ layer: 'ui', currentVersion: '1.0.0', availableVersion: '1.1.0', status: 'ready', error: null }], canRestart: false }
  const core = factory()({}, {}, { updateAdapter: { updateState: async () => state,
    checkUpdates: async () => { actions.push('check'); return state }, restartForUpdate: async () => { actions.push('restart'); return { restarted: false, reason: '任务仍在运行' } } } })
  assert.equal((await core.readUpdateState()).layers[0].currentVersion, '1.0.0')
  assert.equal(core.updateStatusText(state.layers[0]), '已就绪，下次打开窗口时更新')
  assert.equal(core.updateStatusText({ status: 'failed', error: '签名校验失败' }), '签名校验失败')
  await core.checkUpdates(); assert.equal((await core.restartForUpdate()).restarted, false)
  assert.deepEqual(actions, ['check', 'restart'])
})
test('mobile About reads actual native installed/staged versions and invokes the existing updater', async () => {
  const calls: string[] = []
  const core = factory()({}, { nativeCall: async (method: string) => { calls.push(method); return { activeVersion: '0.8.8', stagedVersion: '0.9.0', nativeVersion: '0.8.8 / code21' } } }, { mobileState: {} })
  const state = await core.checkUpdates()
  assert.equal(state.layers[0].currentVersion, '0.8.8'); assert.equal(state.layers[0].availableVersion, '0.9.0'); assert.equal(state.layers[0].status, 'ready')
  assert.deepEqual(calls, ['updates.check', 'updates.status'])
  assert.equal((await core.restartForUpdate()).restarted, false)
})
test('desktop and Android ship the same public trust anchor, with no private material', async () => {
  const desktop = await readFile(new URL('../src/personal-update/trusted-keys.json', import.meta.url), 'utf8')
  const android = await readFile(new URL('../apps/android/app/src/updateAssets/update-trusted-keys.json', import.meta.url), 'utf8')
  assert.equal(android, desktop)
  for (const pem of Object.values(JSON.parse(desktop))) { assert.match(pem as string, /^-----BEGIN PUBLIC KEY-----/); assert.doesNotMatch(pem as string, /PRIVATE KEY/) }
})

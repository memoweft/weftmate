import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { activateMobileUiRelease, publishMobileUi } from '../src/personal-access/mobile-ui-release.mjs'
import { createPersonalAccessService } from '../src/personal-access/index.mjs'

test('authenticated mobile UI A to B and rollback use immutable assets, SSE and no host restart',
  { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'personal-mobile-release-'))
    const sourceDir = join(root, 'source'), outputDir = join(root, 'releases')
    mkdirSync(sourceDir)
    writeFileSync(join(sourceDir, 'index.html'), '<!doctype html><script src="app.js"></script>')
    writeFileSync(join(sourceDir, 'app.js'), 'window.version="A"')
    const backend = {
      getStatus: async () => ({ runtime: 'unavailable', referenceScan: 'pending' }),
      listModels: async () => [], preflight: async () => ({}),
      createSession: async () => ({}), sendMessage: async () => ({}), cancelSession: async () => ({}),
      readEvents: async ({ afterSeq }: { afterSeq: number }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
      describeSession: async () => null,
    }
    let service: Awaited<ReturnType<typeof createPersonalAccessService>> | undefined
    try {
      const a = await publishMobileUi({ sourceDir, outputDir, uiVersion: '0.2.0', releaseNotes: 'Synthetic A' })
      assert.equal(a.schemaVersion, 1)
      assert.equal(a.bridgeVersion, 1)
      assert.equal(a.minNativeVersionCode, 2)
      assert.equal(readFileSync(join(outputDir, 'current.json'), 'utf8').includes('Synthetic A'), true)
      service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend, mobileUiDir: outputDir })
      const { origin } = await service.start()
      assert.equal((await fetch(`${origin}/personal/v1/app/manifest`)).status, 401)
      assert.equal((await fetch(`${origin}${a.assetBase}app.js`)).status, 401)
      assert.equal((await fetch(`${origin}/personal/v1/app/updates`)).status, 401)
      const registered = await fetch(`${origin}/personal/v1/auth/register`, { method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'synthetic-owner', password: 'synthetic owner password 123', deviceName: 'Browser' }) })
      assert.equal(registered.status, 201)
      const cookie = registered.headers.get('set-cookie')!.split(';')[0]
      const manifestA = await fetch(`${origin}/personal/v1/app/manifest`, { headers: { cookie } })
      assert.equal(manifestA.status, 200)
      assert.equal((await manifestA.json()).assetBase, a.assetBase)
      const assetA = await fetch(`${origin}${a.assetBase}app.js`, { headers: { cookie } })
      assert.equal(await assetA.text(), 'window.version="A"')
      assert.match(assetA.headers.get('cache-control')!, /private.*immutable/)
      assert.equal((await fetch(`${origin}${a.assetBase}app.js`, {
        headers: { cookie, 'if-none-match': assetA.headers.get('etag')! } })).status, 304)

      const updates = await fetch(`${origin}/personal/v1/app/updates`, { headers: { cookie } })
      assert.equal(updates.status, 200)
      const reader = updates.body!.getReader()
      await reader.read() // initial connection comment
      writeFileSync(join(sourceDir, 'app.js'), 'window.version="B"')
      const b = await publishMobileUi({ sourceDir, outputDir, uiVersion: '0.2.1', releaseNotes: 'Synthetic B' })
      assert.notEqual(b.assetBase, a.assetBase)
      let received = ''
      const deadline = Date.now() + 6000
      while (!received.includes('event: ui-update') && Date.now() < deadline) {
        const next = await Promise.race([reader.read(), new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SSE update timeout')), 6200))])
        received += new TextDecoder().decode(next.value)
      }
      assert.match(received, /0\.2\.1/)
      assert.equal((await (await fetch(`${origin}/personal/v1/app/manifest`, { headers: { cookie } })).json()).uiVersion, '0.2.1')
      assert.equal(await (await fetch(`${origin}${a.assetBase}app.js`, { headers: { cookie } })).text(), 'window.version="A"')
      assert.equal(await (await fetch(`${origin}${b.assetBase}app.js`, { headers: { cookie } })).text(), 'window.version="B"')
      const native3 = await publishMobileUi({ sourceDir, outputDir, uiVersion: '0.3.0',
        minNativeVersionCode: 3, releaseNotes: 'Requires a newer native shell' })
      assert.equal(native3.assetBase, b.assetBase, 'a native compatibility update may reuse immutable bytes')
      const required = await (await fetch(`${origin}/personal/v1/app/manifest`, { headers: { cookie } })).json()
      assert.equal(required.minNativeVersionCode, 3)
      assert.equal(required.uiVersion, '0.3.0')
      let nativeNotice = ''
      while (!nativeNotice.includes('event: ui-update')) {
        const next = await Promise.race([reader.read(), new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('native version SSE timeout')), 6200))])
        nativeNotice += new TextDecoder().decode(next.value)
      }
      assert.match(nativeNotice, /0\.3\.0/)
      await activateMobileUiRelease({ outputDir, releaseId: `0.2.0-${a.assetBase.split('/')[5]}` })
      assert.equal((await (await fetch(`${origin}/personal/v1/app/manifest`, { headers: { cookie } })).json()).uiVersion, '0.2.0')
      await reader.cancel()
      writeFileSync(join(sourceDir, '.private.json'), '{"secret":true}')
      await assert.rejects(publishMobileUi({ sourceDir, outputDir, uiVersion: '0.2.2' }))
      assert.equal((await (await fetch(`${origin}/personal/v1/app/manifest`, { headers: { cookie } })).json()).uiVersion, '0.2.0')
    } finally { await service?.close(); rmSync(root, { recursive: true, force: true }) }
  })

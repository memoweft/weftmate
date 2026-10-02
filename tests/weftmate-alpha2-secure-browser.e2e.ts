/**
 * Secure Alpha.2 browser acceptance.  Unlike the public scaffold test this
 * exercises the frozen, IPC-delivered composition used by the Electron host.
 * It owns a temporary DSH_HOME and never reaches D:\\AI or OwnerDogfood.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DshWebRuntime } from '../src/dsh-web-runtime.ts'

const repository = process.cwd()
const vendor = resolve(repository, '..', 'Runtime', 'HarnessStores', 'dsh-v0.1.7-alpha.2', 'vendor')
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const playwright = pathToFileURL(resolve(repository, '..', 'Runtime', 'HarnessWorktrees', 'dsh-00102833-alpha2', 'node_modules', '.pnpm', 'playwright@1.61.1', 'node_modules', 'playwright', 'index.js')).href
const evidence = resolve(repository, '..', 'Runtime', 'HarnessStores', 'dsh-v0.1.7-alpha.2', 'evidence')

test('secure Alpha.2 composition loads the WeftMate browser client without console faults', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-secure-browser-'))
  const options = {
    homeDir: root,
    workspaceDir: join(root, 'workspace'),
    runtimePath: vendor,
    profileName: 'weftmate-alpha2',
    profilePolicy: 'alpha2',
    noOpen: true,
    credentialRequestHandler: async ({ operation }) => operation === 'describe' ? { configured: false, writable: true } : {},
  }
  let runtime = new DshWebRuntime(options)
  let browser: any
  try {
    const origin = await runtime.start()
    const playwrightModule = await import(playwright)
    const chromium = (playwrightModule as any).chromium ?? (playwrightModule as any).default?.chromium
    browser = await chromium.launch({ executablePath: chrome })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    const errors: string[] = []
    const loaded: string[] = []
    page.on('pageerror', (error: Error) => errors.push(error.message))
    page.on('console', (message: any) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('response', (response: any) => { if (response.url().includes('alpha2-client')) loaded.push(response.url()) })
    await page.goto(origin, { waitUntil: 'load' })
    await page.waitForTimeout(1_000)
    const before = {
      url: page.url(),
      frames: page.frames().map(frame => frame.url()),
      buttons: await page.locator('button').allTextContents(),
      notice: await page.locator('text=内测声明').count(),
      shell: await page.getByLabel('WeftMate', { exact: true }).count(),
      cookies: (await page.context().cookies()).map(cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path, httpOnly: cookie.httpOnly, secure: cookie.secure })),
    }
    // This is a physical pointer click in the exact page we screenshot.  It
    // intentionally follows the visible official dialog rather than changing
    // any DSH setting or hiding the upstream UI through CSS.
    if (before.notice > 0) {
      await page.mouse.click(930, 552)
      await page.waitForTimeout(1_000)
      // The upstream acknowledgement refreshes its settings Remote and can
      // briefly remount all client modules as “重新连接中...”.  Wait for the
      // documented client graph to settle before judging the shell.
      await page.getByLabel('WeftMate', { exact: true }).first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => undefined)
    }
    const after = {
      url: page.url(),
      frames: page.frames().map(frame => frame.url()),
      buttons: await page.locator('button').allTextContents(),
      notice: await page.locator('text=内测声明').count(),
      shell: await page.getByLabel('WeftMate', { exact: true }).count(),
      cookies: (await page.context().cookies()).map(cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path, httpOnly: cookie.httpOnly, secure: cookie.secure })),
    }
    assert.equal(after.notice, 0, `official notice failed to close in the screenshot page: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
    assert.ok(after.shell >= 1, `WeftMate native brand disappeared after official notice acknowledgement: before=${JSON.stringify(before)} after=${JSON.stringify(after)} console=${JSON.stringify(errors)}`)
    const apiAfterContinue = await page.evaluate(async () => ({
      status: (await fetch('/api/weftmate/status')).status,
      models: (await fetch('/api/weftmate/models')).status,
    }))
    assert.deepEqual(apiAfterContinue, { status: 200, models: 200 }, `official Continue must retain authenticated API admission: ${JSON.stringify(apiAfterContinue)}`)
    assert.equal(errors.some(error => /remote\.mux|HTTP Authentication failed|\b401\b/i.test(error)), false, `Continue must not break the Remote mux: ${JSON.stringify(errors)}`)
    // The official model credential onboarding follows the welcome notice in
    // a fresh secure HOME. Choose its documented later action instead of
    // clicking through its modal mask to an unrelated WeftMate control.
    const later = page.getByRole('button', { name: /稍后配置|Configure later/i })
    if (await later.count() > 0) await later.first().click()
    await page.waitForTimeout(1_000)
    const boot = await page.content()
    const themeProbe = await page.evaluate(() => {
      const frame = document.querySelector<HTMLElement>('[class*="frame"].weftmate-v2-shell')
      const sidebar = document.querySelector<HTMLElement>('[class*="regionArea"]')
      const hero = document.querySelector<HTMLElement>('[data-weftmate-v2-hero]')
      const facts = (element: HTMLElement | null) => element === null ? null : {
        className: element.className,
        dataTheme: element.getAttribute('data-theme'),
        surface: getComputedStyle(element).getPropertyValue('--weftmate-surface').trim(),
        base: getComputedStyle(element).getPropertyValue('--weftmate-bg-base').trim(),
        background: getComputedStyle(element).backgroundColor,
      }
      return {
        bodyDark: document.body.hasAttribute('data-ds-dark-theme'),
        htmlDark: document.documentElement.hasAttribute('data-ds-dark-theme'),
        frame: facts(frame), sidebar: facts(sidebar), hero: facts(hero),
      }
    })
    assert.deepEqual(themeProbe, {
      bodyDark: false,
      htmlDark: false,
      frame: { className: themeProbe.frame?.className, dataTheme: 'light', surface: '#fff', base: '#f6f7f9', background: 'rgb(246, 247, 249)' },
      sidebar: { className: themeProbe.sidebar?.className, dataTheme: null, surface: '#fff', base: '#f6f7f9', background: 'rgb(255, 255, 255)' },
      hero: { className: themeProbe.hero?.className, dataTheme: null, surface: '#fff', base: '#f6f7f9', background: 'rgba(0, 0, 0, 0)' },
    }, 'V2 native children must inherit AppFrame light tokens instead of creating a dark nested scope')
    const markers = after.shell
    assert.match(boot, /@weftmate\/alpha2-client/, 'secure authenticated boot graph must advertise the client bundle')
    assert.ok(loaded.length > 0, 'secure authenticated browser must request the client bundle')
    assert.ok(markers >= 1, 'secure authenticated browser must mount the native WeftMate brand')
    assert.deepEqual(errors, [], 'secure authenticated browser must have no console errors')
    const rail = page.locator('nav[aria-label="WeftMate"]')
    const sessionPanel = page.locator('[class*="regionArea"]').first()
    await assert.doesNotReject(async () => { await rail.waitFor({ state: 'visible' }) })
    await assert.doesNotReject(async () => { await sessionPanel.waitFor({ state: 'visible' }) })
    const box = await sessionPanel.boundingBox()
    assert.ok(box && box.x >= 0 && box.x + box.width <= 430, `WeftMate shell must remain in the left lane (${JSON.stringify(box)})`)
    const rightIsNative = await page.evaluate(() => {
      const target = document.elementFromPoint(window.innerWidth - 28, 100)
      return !target?.closest('nav[aria-label="WeftMate"], [class*="overlayLayer"]')
    })
    assert.equal(rightIsNative, true, 'WeftMate shell must not intercept the native DSH right workspace')
    const topSearch = page.locator('[data-weftmate-v2-titlebar] .tb-search')
    assert.equal(await topSearch.getAttribute('aria-disabled'), 'true', 'unwired V2 command palette must look and behave disabled')
    assert.equal(await page.locator('[data-weftmate-session-pulse]').count(), 0, 'legacy alpha2 implementation status must not occupy the V2 composer')
    const wideNewSession = page.locator('.sess-new button').first()
    await wideNewSession.waitFor({ state: 'visible' })
    assert.deepEqual(await wideNewSession.evaluate(button => {
      const style = getComputedStyle(button)
      return { text: button.textContent?.trim(), background: style.backgroundColor, color: style.color }
    }), { text: '新会话', background: 'rgb(46, 91, 255)', color: 'rgb(255, 255, 255)' }, 'V2 shallow sidebar must preserve a readable primary new-session button')
    // Welcome acknowledgement acceptance stops here: creating or selecting
    // sessions is covered by the dedicated Session Remote smoke and would
    // conflate this auth regression with upstream workspace navigation.
    // The native workspace remains outside the WeftMate left lane. Its
    // exact upstream tab label is version-owned, so this acceptance keeps the
    // structural right-pane assertion above instead of selecting a label.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'native workspace remains unobstructed by the WeftMate lane')
    const widePath = join(evidence, `alpha2-weave-shell-clear-${Date.now()}-1440px.png`)
    const wideShot = await page.screenshot({ path: widePath, fullPage: true })
    assert.ok(wideShot.byteLength > 10_000, 'wide browser screenshot must be freshly rendered')
    await page.setViewportSize({ width: 687, height: 900 })
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'narrow shell must not create horizontal overflow')
    // V2 intentionally collapses the session column below the responsive
    // breakpoint. The real affordance is its 60px rail: expand the drawer and
    // prove that the official WorkspaceBrowser (not a copied list) becomes
    // reachable, then collapse it again.
    const narrowRail = page.locator('nav[aria-label="WeftMate"]')
    await narrowRail.waitFor({ state: 'visible' })
    const railBox = await narrowRail.boundingBox()
    assert.ok(railBox && railBox.x >= 0 && railBox.width <= 60 && railBox.x + railBox.width <= 687, `V2 narrow rail must remain visible (${JSON.stringify(railBox)})`)
    const expandSessionColumn = narrowRail.getByRole('button', { name: '展开会话列' })
    await expandSessionColumn.click()
    await page.locator('[data-sidebar-collapsed]').waitFor({ state: 'detached', timeout: 5_000 })
    await sessionPanel.waitFor({ state: 'visible', timeout: 5_000 })
    const nativeNewSession = page.locator('.sess-new button').first()
    await nativeNewSession.waitFor({ state: 'visible', timeout: 5_000 })
    assert.equal(await nativeNewSession.getAttribute('aria-label'), '新建会话', 'expanded V2 drawer must retain the native new-session control')
    await nativeNewSession.click()
    await page.locator('[data-conversation-content]').waitFor({ state: 'visible', timeout: 5_000 })
    const narrowBox = await sessionPanel.boundingBox()
    assert.ok(narrowBox && narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 430, `expanded narrow session drawer must remain in the V2 left lane (${JSON.stringify(narrowBox)})`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'expanded narrow session drawer must not create horizontal overflow')
    const narrowPath = join(evidence, `alpha2-weave-shell-clear-${Date.now()}-687px.png`)
    const narrowShot = await page.screenshot({ path: narrowPath, fullPage: true })
    assert.ok(narrowShot.byteLength > 10_000, 'narrow browser screenshot must be freshly rendered')
    await narrowRail.getByRole('button', { name: '收起会话列' }).click()
    await sessionPanel.waitFor({ state: 'hidden', timeout: 5_000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'collapsed narrow rail must not create horizontal overflow')
    const welcomePath = join(root, 'profiles', 'weftmate-alpha2', 'weftmate-alpha2-welcome.json')
    const welcome = JSON.parse(await readFile(welcomePath, 'utf8'))
    assert.deepEqual(Object.keys(welcome).sort(), ['schemaVersion', 'welcomeNoticeVersion'])
    assert.equal(typeof welcome.welcomeNoticeVersion, 'string')

    await browser.close(); browser = undefined
    await runtime.close(); runtime = new DshWebRuntime(options)
    const restartedOrigin = await runtime.start()
    browser = await chromium.launch({ executablePath: chrome })
    const restarted = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    const restartedErrors: string[] = []
    restarted.on('console', (message: any) => { if (message.type() === 'error') restartedErrors.push(message.text()) })
    await restarted.goto(restartedOrigin, { waitUntil: 'load' })
    await restarted.waitForTimeout(800)
    assert.equal(await restarted.locator('text=内测声明').count(), 0, 'actual welcome acknowledgement must persist into the next signed secure snapshot')
    assert.ok(await restarted.getByLabel('WeftMate', { exact: true }).count() >= 1, 'native WeftMate brand survives browser restart')
    const protectedWrite = await restarted.evaluate(async () => {
      const response = await fetch('/api/settings/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'secure-nonwelcome-write', method: 'settings/update', payload: { args: { ns: 'llm-pi-ai', patch: { providers: {} }, expectedRevision: 0 } } }) })
      return { status: response.status, body: await response.text() }
    })
    assert.equal(protectedWrite.status, 200)
    assert.match(protectedWrite.body, /secure_settings_requires_restart/)
    assert.deepEqual(await restarted.evaluate(async () => ({ status: (await fetch('/api/weftmate/status')).status, models: (await fetch('/api/weftmate/models')).status })), { status: 200, models: 200 })
    assert.ok(await restarted.getByLabel('WeftMate', { exact: true }).count() >= 1, 'native WeftMate brand remains after durable session recovery')
    assert.equal(restartedErrors.some(error => /remote\.mux|HTTP Authentication failed|\b401\b/i.test(error)), false)
  } finally {
    await browser?.close()
    await runtime.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('tampered welcome JSON is rejected before a new secure child can replace the signed overlay', { timeout: 25_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-secure-welcome-tamper-'))
  let runtime = new DshWebRuntime({ homeDir: root, workspaceDir: join(root, 'workspace'), runtimePath: vendor, profileName: 'weftmate-alpha2', profilePolicy: 'alpha2', noOpen: true, credentialRequestHandler: async () => ({}) })
  try {
    await runtime.start(); await runtime.close()
    const profile = join(root, 'profiles', 'weftmate-alpha2')
    const overlay = join(profile, 'weftmate-alpha2-welcome.patch.yml')
    const before = await readFile(overlay).catch(() => Buffer.from('absent'))
    await writeFile(join(profile, 'weftmate-alpha2-welcome.json'), JSON.stringify({ schemaVersion: 1, welcomeNoticeVersion: 7, extra: 'rejected' }), 'utf8')
    runtime = new DshWebRuntime({ homeDir: root, workspaceDir: join(root, 'workspace'), runtimePath: vendor, profileName: 'weftmate-alpha2', profilePolicy: 'alpha2', noOpen: true, credentialRequestHandler: async () => ({}) })
    await assert.rejects(runtime.start(), /invalid schema/)
    assert.deepEqual(await readFile(overlay).catch(() => Buffer.from('absent')), before)
  } finally { await runtime.close().catch(() => undefined); await rm(root, { recursive: true, force: true }) }
})

/**
 * Browser acceptance for the Alpha.2 Weave conversation view.
 *
 * This test intentionally boots the official Web composition through its
 * public scaffold.  The replay adapter is a private, deterministic model
 * lane: no D:\AI model, ModelSwitcher, production DSH home, or user session
 * is reached.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)))
const checkout = resolve(repository, '..', 'Runtime', 'HarnessWorktrees', 'dsh-00102833-alpha2')
const scaffoldUrl = pathToFileURL(join(checkout, 'apps', 'web', 'tests', 'scaffold.ts')).href
const supportUrl = pathToFileURL(join(checkout, 'apps', 'web', 'tests', 'support.ts')).href
const chromiumExecutable = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const evidencePath = resolve(repository, '..', 'Runtime', 'HarnessStores', 'dsh-v0.1.7-alpha.2', 'evidence', 'alpha2-weave-stream-stop-687px.png')

function chunks(texts: readonly string[]) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...texts.map(text => ({ type: 'text-delta', index: 0, text })),
    { type: 'block-end', index: 0, block: { type: 'text', text: texts.join('') } },
    { type: 'usage', usage: { inputTokens: 12, outputTokens: texts.join('').length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

it('Alpha.2 Weave view sends, streams, waits for durable stop, and restores history', { timeout: 45_000 }, async () => {
  const [{ chromium }, scaffoldModule, support] = await Promise.all([
    import(pathToFileURL(join(checkout, 'node_modules', '.pnpm', 'playwright@1.61.1', 'node_modules', 'playwright', 'index.js')).href),
    import(scaffoldUrl),
    import(supportUrl),
  ])
  const root = await mkdtemp(join(tmpdir(), 'weftmate-alpha2-chat-e2e-'))
  const replayOverride = join(root, 'replay.override.json')
  const fixture = join(root, 'override-only.jsonl')
  const persistenceRoot = join(root, 'sessions')
  const harnessHome = join(root, 'home')
  const clientDir = resolve(repository, 'src', 'plugins', 'weftmate-alpha2-client')
  const clientOverlay = resolve(repository, 'tests', 'fixtures', 'weftmate-alpha2-client.patch.yml')
  const firstPrompt = 'WEFTMATE_ALPHA2_BROWSER_FIRST'
  const firstReply = 'WEFTMATE_ALPHA2_BROWSER_FIRST_REPLY'
  const streamedPrefix = 'WEFTMATE_ALPHA2_BROWSER_STREAMING'
  const secondStreamedPrefix = 'WEFTMATE_ALPHA2_BROWSER_STREAMING_AGAIN'
  const longReply = Array.from({ length: 30 }, (_, index) => `${streamedPrefix}_${String(index).padStart(2, '0')} `)
  const secondLongReply = Array.from({ length: 30 }, (_, index) => `${secondStreamedPrefix}_${String(index).padStart(2, '0')} `)
  await writeFile(replayOverride, JSON.stringify([
    { kind: 'chunks', chunks: chunks([firstReply]) },
    { kind: 'chunks', chunks: chunks(longReply) },
    { kind: 'chunks', chunks: chunks(secondLongReply) },
  ]))

  let browser: any
  let scaffold: any
  let failed = false
  try {
    scaffold = await scaffoldModule.launchWebScaffold({
      persistenceRoot,
      harnessHome,
      replayFixture: fixture,
      replayOverride,
      paceMs: 120,
      profile: { packages: [{ dir: clientDir }] },
      extraOverlayPath: clientOverlay,
    })
    const events: any[] = []
    scaffold.ctx.on('session/event', (_session: unknown, event: unknown) => events.push(event))
    browser = await chromium.launch({ executablePath: chromiumExecutable })
    const page = await browser.newPage({ viewport: { width: 687, height: 900 }, locale: 'zh-CN' })
    const consoleState = scaffoldModule.watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await support.connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    await expect.poll(() => page.locator('[data-weftmate-alpha2-header]').count(), { timeout: 20_000 }).toBe(1)

    const officialComposer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await officialComposer.fill(firstPrompt)
    const firstSettled = scaffold.whenTurnSettled(20_000)
    await page.getByRole('button', { name: /发送消息|Send message/ }).click()
    await page.getByText(firstReply, { exact: false }).waitFor({ timeout: 10_000 })
    const sessionId = await firstSettled

    // conversation.view is intentionally absent for a blank session.  After a
    // real durable turn, choose the registered Weave tab through the official
    // Conversation view selector rather than rendering an out-of-band clone.
    const weaveTab = page.getByRole('tab', { name: /织语|Weave/, exact: false })
    await weaveTab.waitFor({ timeout: 20_000 })
    await weaveTab.click()
    const weave = page.locator('[data-weftmate-alpha2-weave-view]')
    await weave.waitFor({ timeout: 20_000 })
    await weave.getByText(firstPrompt, { exact: true }).waitFor({ timeout: 20_000 })
    await weave.getByText(firstReply, { exact: false }).waitFor({ timeout: 20_000 })

    await officialComposer.fill('WEFTMATE_ALPHA2_BROWSER_STOP')
    await page.getByRole('button', { name: /发送消息|发送|Send message/ }).click()
    await page.getByText(streamedPrefix, { exact: false }).waitFor({ timeout: 10_000 })
    await weave.getByRole('button', { name: '停止', exact: true }).click()
    // The replay Agent may settle abort inside one animation frame. Assert the
    // durable journal boundary, rather than asserting a transient button label.
    await expect.poll(() => events.filter(event => event && (event as any).type === 'turn/end').length, { timeout: 10_000 }).toBe(2)
    await page.getByText('DSH 已确认 turn/end：本轮已停止。', { exact: true }).waitFor({ timeout: 10_000 })
    await weave.getByRole('button', { name: '停止', exact: true }).waitFor({ timeout: 10_000 })
    const ends = events.filter(event => event && (event as any).type === 'turn/end')
    expect(ends).toHaveLength(2)
    expect(ends[1].data.reason.kind).toBe('aborted')
    // A new turn must reset the local Stop latch without replacing the page.
    await officialComposer.fill('WEFTMATE_ALPHA2_BROWSER_STOP_AGAIN')
    await page.getByRole('button', { name: /发送消息|发送|Send message/ }).click()
    await page.getByText(secondStreamedPrefix, { exact: false }).waitFor({ timeout: 10_000 })
    const secondStop = weave.getByRole('button', { name: '停止', exact: true })
    await secondStop.waitFor({ timeout: 10_000 })
    expect(await secondStop.isEnabled()).toBe(true)
    await secondStop.click()
    await expect.poll(() => events.filter(event => event && (event as any).type === 'turn/end').length, { timeout: 10_000 }).toBe(3)
    const endsAfterSecondStop = events.filter(event => event && (event as any).type === 'turn/end')
    expect(endsAfterSecondStop[2].data.reason.kind).toBe('aborted')
    expect(await weave.getByText('permission/preset', { exact: true }).count()).toBe(0)
    expect(await weave.getByText('sandbox/mode', { exact: true }).count()).toBe(0)
    expect(await weave.getByText('agent/inbox/spliced', { exact: true }).count()).toBe(0)
    expect(await weave.getByText('Current runtime context.', { exact: false }).count()).toBe(0)
    expect(await weave.locator('textarea').count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(consoleState.pageErrors).toEqual([])
    await page.screenshot({ path: evidencePath, fullPage: true })

    // Reconnect the actual browser surface to the same official Remote. This
    // verifies that the durable transcript, including the aborted turn, is
    // reconstructed rather than kept only in this React component's state.
    await page.reload({ waitUntil: 'load' })
    await page.getByText(firstPrompt, { exact: true }).waitFor({ timeout: 10_000 })
    await page.getByText(firstReply, { exact: true }).waitFor({ timeout: 10_000 })
    expect((await scaffold.ctx.sessions.get(sessionId).snapshotEvents()).some((event: any) => event.type === 'turn/end' && event.data.reason.kind === 'aborted')).toBe(true)
  } catch (error) {
    failed = true
    throw error
  } finally {
    await browser?.close()
    if (failed) {
      await scaffold?.close().catch(() => {})
    } else {
      await scaffold?.close()
    }
    await rm(root, { recursive: true, force: true })
  }
})

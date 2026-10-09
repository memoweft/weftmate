/** Semantic interactions: locators describe names/roles and stay independent of component placement. */
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { startTimelineCandidate } from './timeline-ui-candidate.mjs'
import { localUiSession } from '../helpers/local-ui-session.mjs'
const root = resolve(import.meta.dirname, '../..')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = createRequire(import.meta.url)('electron')
const errors = []
let application, candidate
async function until(check) { const deadline = performance.now() + 25000; while (performance.now() < deadline) { if (await check()) return; await new Promise(done => setTimeout(done, 100)) } throw Error('Interaction condition timed out') }
async function start() {
  candidate = await startTimelineCandidate({ historyCount: 0, interactive: true, riskApproval: true, baseTime: Date.now() - 80000 })
  application = await _electron.launch({ executablePath, args: ['tests/integration/desktop-ui-1.cjs', candidate.origin + '/personal/v1/ui/'], cwd: root, env })
  const page = await application.firstWindow(); page.setDefaultTimeout(25000)
  page.on('pageerror', error => errors.push(error.message))
  await localUiSession(page, candidate.credentials)
  await page.getByRole('button', { name: '停止回复', exact: true }).waitFor()
  return page
}
async function close() { await application?.close(); await candidate?.close(); application = null; candidate = null }
try {
  for (const theme of ['light', 'dark']) {
    const page = await start()
    await page.getByRole('button', { name: '账户菜单' }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '外观', exact: true }).click()
      await page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click()
    await page.getByRole('combobox', { name: /^主题色/ }).click()
    await page.getByRole('option', { name: '松绿', exact: true }).click()
    await page.getByRole('combobox', { name: /^字号/ }).click()
    await page.getByRole('option', { name: '大 · 17', exact: true }).click()
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    await page.getByRole('button', { name: '批准', exact: true }).waitFor({state:'visible'})
    assert.equal(await page.getByRole('button', { name: '批准', exact: true }).count(), 1)
    await page.getByRole('region', { name: '待批准操作' }).getByText(/要运行命令/).click()
    await page.getByRole('button', { name: '总是允许此类', exact: true }).waitFor()
    await page.getByRole('button', { name: '拒绝', exact: true }).waitFor()
    async function selectMode(label) {
      await page.getByRole('button', { name: '账户菜单' }).click()
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '常规', exact: true }).click()
      await page.getByRole('combobox', { name: '回复进行中时发送的消息', exact: true }).click()
      await page.getByRole('option', { name: label, exact: true }).click()
      await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    }
    await selectMode('引导')
    const input = page.getByRole('textbox', { name: '输入消息', exact: true })
    await input.fill('把报告写得简短一些'); await input.press('Enter')
    await until(() => candidate.operations.some(op => op.text === '把报告写得简短一些' && op.mode === 'steer'))
    await until(async () => (await input.inputValue()) === '')
    await until(async () => await page.getByRole('button', { name: /新对话/ }).isEnabled())
    await selectMode('排队')
    await new Promise(done => setTimeout(done, 850))
    await input.fill('下一件事：整理会议记录'); await input.press('Enter')
    await until(() => candidate.operations.some(op => op.text === '下一件事：整理会议记录' && op.mode === 'queue'))
    await until(async () => (await input.inputValue()) === '')
    await page.getByRole('button', { name: '读取了 3 个文件、已运行 1 个命令，已收起', exact: true }).click()
    await page.getByText(/^读取 3 个文件/).click()
    await page.getByText(/Read 3 files successfully/).waitFor()
    await page.getByRole('radio', { name: '简要报告', exact: true }).check()
    await page.getByRole('button', { name: '提交回答', exact: true }).click()
    await page.getByRole('button', { name: '批准', exact: true }).click()
    await page.getByRole('region', { name: '待批准操作' }).waitFor({ state: 'hidden' })
    await candidate.complete(true)
    await page.getByRole('button', { name: /^项目进度报告(?:\s|$)/ }).click()
    await page.getByText('报告已保存，测试全部通过。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '发送', exact: true }).waitFor()
    await page.getByRole('button', { name: '打开成果', exact: true }).click()
    const preview = page.getByRole('complementary', { name: '成果与来源预览' })
    await preview.getByRole('heading', { name: '项目进度报告', exact: true }).waitFor()
    await preview.getByText('已读取 3 个文件。42 项测试通过。', { exact: true }).waitFor()
    const before = await preview.boundingBox()
    await preview.getByRole('separator', { name: '调整预览宽度' }).press('ArrowLeft')
    assert.ok((await preview.boundingBox()).width > before.width)
    await page.keyboard.press('Escape'); await preview.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '输出与来源', exact: true }).click()
    await page.getByRole('dialog', { name: '输出与来源' }).getByRole('button', { name: /README/ }).click()
    await preview.getByText('读取 1 次', { exact: true }).waitFor()
    await preview.getByText(/读取 3 个文件 ·/).click()
    await preview.getByText('详情', { exact: true }).click()
    await preview.getByText(/Read 3 files successfully/).waitFor()
    await preview.getByRole('button', { name: '复制', exact: true }).click()
    await preview.getByRole('button', { name: '已复制', exact: true }).waitFor()
    await preview.getByRole('button', { name: '再打开一项' }).click()
    await page.getByRole('dialog', { name: '输出与来源' }).getByRole('button', { name: '项目进度报告.md', exact: true }).click()
    assert.equal(await preview.getByRole('tab').count(), 2)
    await preview.getByRole('button', { name: /关闭标签 README/ }).click()
    assert.equal(await preview.getByRole('tab').count(), 1)
    await preview.getByRole('button', { name: '收起右侧面板', exact: true }).click()
    await page.keyboard.press('Control+k')
    const search = page.getByRole('searchbox', { name: '搜索会话', exact: true })
    assert.equal(await search.evaluate(element => element === document.activeElement), true)
    await search.fill('不存在的会话'); await page.getByText('没有找到会话。', { exact: true }).waitFor()
    await search.fill('项目'); assert.equal(await page.getByRole('button', { name: /^项目进度报告(?:\s|$)/ }).count(), 1)
    await search.fill('')
    await page.reload(); await page.getByRole('button', { name: /^项目进度报告(?:\s|$)/ }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
    assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), 'green')
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '17px')
    // Paste/drop target semantic controls; neither operation depends on their layout slot.
    await input.evaluate(element => {
      const files = new DataTransfer(); files.items.add(new File(['synthetic paste'], '粘贴.txt', { type: 'text/plain' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: files, bubbles: true, cancelable: true }))
    })
    await page.getByText('粘贴.txt', { exact: true }).waitFor()
    await input.evaluate(element => {
      const files = new DataTransfer(); files.items.add(new File(['synthetic drop'], '拖拽.txt', { type: 'text/plain' }))
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }))
    })
    await page.getByText('拖拽.txt', { exact: true }).waitFor()
    const shifted = await input.evaluate(element => { const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }); element.dispatchEvent(event); return event.defaultPrevented })
    assert.equal(shifted, false)
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`UI-1 ${theme} interactions passed.`)
    await close()
  }
  for (const method of ['button', 'escape']) {
    const page = await start(), input = page.getByRole('textbox', { name: '输入消息', exact: true })
    await input.fill('保留这个草稿')
    if (method === 'button') { await input.fill(''); await page.getByRole('button', { name: '停止回复', exact: true }).click(); await input.fill('保留这个草稿'); }
    else await page.keyboard.press('Escape')
    await until(() => candidate.operations.some(op => op.kind === 'cancel'))
    assert.equal(await input.inputValue(), '保留这个草稿')
    await until(async () => !(await page.getByRole('button', { name: /新对话/ }).isDisabled()))
    await page.keyboard.press('Control+n')
    await page.getByText('今天想做什么？',{exact:true}).waitFor(); assert.equal(candidate.operations.filter(op=>op.kind==='create').length,1,'opening a new draft defers host creation until the first send')
    console.log(`UI-1 ${method} stop passed.`)
    await close()
  }
  assert.deepEqual(errors, [])
  console.log('UI-1 Chromium interactions passed (semantic names/roles, isolated Electron).')
} catch (error) { console.error('Synthetic operations:', candidate?.operations); if (application) console.error((await (await application.firstWindow()).locator('body').innerText()).slice(-1200)); throw error; } finally { await close() }


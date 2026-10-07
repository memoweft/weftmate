/** Real Chromium UI checks against an isolated host and synthetic native log. */
const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const { mkdirSync, mkdtempSync, writeFileSync, realpathSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
app.setPath('userData', realpathSync(mkdtempSync(join(tmpdir(), 'weftmate-ui-1-browser-'))))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const capture = !process.argv.includes('--verify-only'), output = resolve(__dirname, '../evidence/ui-1')
const delay = ms => new Promise(done => setTimeout(done, ms))
const findings = [], errors = []
async function wait(win, expression) {
  for (let i = 0; i < 140; i++) { if (await win.webContents.executeJavaScript(expression)) return; await delay(100) }
  throw Error(`UI wait failed: ${expression}; ${await win.webContents.executeJavaScript('document.body.innerText.slice(-2500)')}`)
}
async function shot(win, name, selector) {
  if (selector) await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'})`)
  await delay(220)
  if (capture) writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
}
app.whenReady().then(async () => {
  let win, candidate
  try {
    const { startTimelineCandidate } = await import(pathToFileURL(join(__dirname, 'timeline-ui-candidate.mjs')).href)
    if (capture) mkdirSync(output, { recursive: true })
    for (const theme of ['light', 'dark']) {
      candidate = await startTimelineCandidate({ historyCount: 0, baseTime: Date.now() - 80000, interactive: true })
      win = new BrowserWindow({ width: 1440, height: 960, show: false, useContentSize: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } })
      win.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); process.stderr.write(`Renderer: ${event.message}\n`) } })
      await win.loadURL(candidate.origin + '/personal/v1/ui/')
      await win.webContents.executeJavaScript(`fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(candidate.credentials)})}).then(r=>{if(!r.ok)throw Error('login failed')})`)
      await win.reload()
      await wait(win, "document.querySelector('.conversation-approval') && document.querySelector('.conversation-question') && document.querySelector('.execution-step')")
      await win.webContents.executeJavaScript(`document.getElementById('show-account').click();const t=document.getElementById('appearance-theme');t.value=${JSON.stringify(theme)};t.dispatchEvent(new Event('change'));document.getElementById('account-back').click()`)
      await wait(win, "document.querySelector('.conversation-approval') && document.getElementById('send-message').dataset.action==='stop'")
      const initial = await win.webContents.executeJavaScript(`({theme:document.documentElement.dataset.theme,headerHidden:getComputedStyle(document.querySelector('.site-header')).display==='none',markdown:!!document.querySelector('.message.assistant strong'),stop:document.getElementById('send-message').getAttribute('aria-label'),singleButton:getComputedStyle(document.getElementById('cancel-turn')).display==='none',placeholder:getComputedStyle(document.getElementById('message-text')).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth,group:document.querySelector('.session-group').textContent})`)
      assert.equal(initial.theme, theme); assert.equal(initial.stop, '停止'); assert.ok(initial.headerHidden && initial.markdown && initial.singleButton && !initial.overflow)
      assert.equal(initial.group, '会话', 'missing server timestamps remain undated')
      assert.doesNotMatch(initial.placeholder, /monospace/i)
      await shot(win, `${theme}-running`, '.message.user')
      await shot(win, `${theme}-approval`, '.conversation-approval')
      await shot(win, `${theme}-question`, '.conversation-question')

      // Two levels only; details are fetched only when the individual step opens.
      await win.webContents.executeJavaScript("document.querySelector('.execution-block').open=true;document.querySelector('.execution-step').open=true")
      await wait(win, "document.querySelector('.execution-step pre').textContent.includes('Read 3 files')")
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.execution-same-type').length"), 0)
      await shot(win, `${theme}-steps`, '.execution-block')

      // Enter inserts a steer message while the visible button remains Stop.
      await win.webContents.executeJavaScript("var text=document.getElementById('message-text');text.value='把报告写得简短一些';text.dispatchEvent(new Event('input'));text.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))")
      for (let i = 0; i < 100 && candidate.operations.length < 3; i++) await delay(50)
      assert.equal(candidate.operations.at(-1).mode, 'steer')
      assert.equal(candidate.operations.at(-1).text, '把报告写得简短一些')
      await wait(win, "document.getElementById('message-text').value==='' && document.getElementById('operation-status').hidden")
      await delay(850)
      await win.webContents.executeJavaScript("var mode=document.getElementById('message-mode');mode.value='queue';var text=document.getElementById('message-text');text.value='下一件事：整理会议记录';text.dispatchEvent(new Event('input'));text.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))")
      for (let i = 0; i < 100 && candidate.operations.length < 4; i++) await delay(50)
      assert.equal(candidate.operations.length, 4, 'both message commands reached the isolated host')
      assert.equal(candidate.operations.at(-1).mode, 'queue', 'queue uses existing command mode; no fake queue event')

      await win.webContents.executeJavaScript("document.querySelector('[data-conversation-approval-action=\"allowed-once\"]').click()")
      await wait(win, "document.querySelector('.conversation-approval').textContent.includes('已提交允许')")
      await win.webContents.executeJavaScript("document.querySelector('.question-option input').click();document.querySelector('.conversation-question form').requestSubmit()")
      await wait(win, "document.querySelector('.conversation-question').textContent.includes('已提交回答') || document.querySelector('.conversation-question').textContent.includes('已回答')")
      await candidate.complete(true)
      await win.webContents.executeJavaScript("document.querySelector('#session-list button').click()")
      await wait(win, "document.getElementById('transcript').textContent.includes('报告已保存') && document.getElementById('send-message').dataset.action==='send'")
      assert.ok(await win.webContents.executeJavaScript("[...document.querySelectorAll('.execution-block')].every(d=>!d.open)"))
      await win.webContents.executeJavaScript("document.getElementById('chat-scroll').scrollTop=document.getElementById('chat-scroll').scrollHeight")
      await shot(win, `${theme}-completed`)

      await win.webContents.executeJavaScript("[...document.querySelectorAll('.artifact-action')].find(b=>b.textContent==='打开成果').click()")
      await wait(win, "document.querySelector('.preview-content')?.textContent.includes('42 项测试通过')")
      const panel = await win.webContents.executeJavaScript(`({markdown:!!document.querySelector('.preview-content h1'),label:[...document.querySelectorAll('[data-timeline-artifact] p')].map(p=>p.textContent),bounds:document.querySelector('.timeline-preview').getBoundingClientRect().left,mainRight:document.querySelector('.assistant-main').getBoundingClientRect().right})`)
      assert.ok(panel.markdown); assert.ok(panel.label.some(label => /Markdown · 68 字节/.test(label))); assert.ok(panel.bounds >= panel.mainRight - 1)
      const priorWidth = await win.webContents.executeJavaScript("document.querySelector('.timeline-preview').getBoundingClientRect().width")
      await win.webContents.executeJavaScript("document.querySelector('.preview-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))")
      assert.ok(await win.webContents.executeJavaScript("document.querySelector('.timeline-preview').getBoundingClientRect().width") > priorWidth)
      await shot(win, `${theme}-artifact-panel`)
      await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
      assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.timeline-preview')"), false)

      await win.webContents.executeJavaScript("document.getElementById('conversation-resources').click()")
      await wait(win, "!!document.querySelector('.resource-picker [data-resource-key=\"file:README.md\"]')")
      await win.webContents.executeJavaScript("document.querySelector('.resource-picker [data-resource-key=\"file:README.md\"]').click()")
      await wait(win, "document.querySelector('.preview-content')?.textContent.includes('读取 1 次')")
      await win.webContents.executeJavaScript("document.querySelector('.resource-usage summary').click()")
      await wait(win, "document.querySelector('.resource-usage pre')?.textContent.includes('Read 3 files successfully')")
      await win.webContents.executeJavaScript("document.querySelector('.preview-add').click()")
      await wait(win, "!!document.querySelector('.resource-picker [data-resource-key^=\"artifact:\"]')")
      await win.webContents.executeJavaScript("document.querySelector('.resource-picker [data-resource-key^=\"artifact:\"]').click()")
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('[role=tab]').length"), 2)
      await win.webContents.executeJavaScript("document.querySelector('.preview-tab-close').click()")
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('[role=tab]').length"), 1)
      await win.webContents.executeJavaScript("window.WeftDesktop.closePreview(false)")
      await win.webContents.executeJavaScript("document.querySelector('.execution-block').open=true;document.querySelector('.execution-step').open=true")
      await wait(win, "!!document.querySelector('.step-reference')")
      await win.webContents.executeJavaScript("document.querySelector('.step-reference').click()")
      await wait(win, "document.querySelector('.preview-content')?.textContent.includes('读取 1 次')")
      await win.webContents.executeJavaScript("window.WeftDesktop.closePreview(false)")

      await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));var search=document.getElementById('session-search');search.value='项目';search.dispatchEvent(new Event('input'))")
      assert.equal(await win.webContents.executeJavaScript("document.activeElement.id"), 'session-search')
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#session-list button').length"), 1)
      await shot(win, `${theme}-search`)
      await win.webContents.executeJavaScript("var search=document.getElementById('session-search');search.value='不存在的会话';search.dispatchEvent(new Event('input'))")
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#session-list button').length"), 0)
      await win.webContents.executeJavaScript("document.getElementById('session-search').value='';document.getElementById('session-search').dispatchEvent(new Event('input'));document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',metaKey:true,bubbles:true,cancelable:true}))")
      assert.ok(await win.webContents.executeJavaScript("document.body.classList.contains('rail-collapsed')"))
      await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true,cancelable:true}))")

      // Appearance persists across a reload and the account settings retain all functions.
      await win.webContents.executeJavaScript("document.getElementById('show-account').click();const accent=document.getElementById('appearance-accent');accent.value='green';accent.dispatchEvent(new Event('change'));const size=document.getElementById('appearance-fontSize');size.value='17';size.dispatchEvent(new Event('change'))")
      await shot(win, `${theme}-appearance`, '.appearance-settings')
      await win.reload(); await wait(win, "document.getElementById('assistant-view').hidden===false")
      assert.equal(await win.webContents.executeJavaScript("document.documentElement.dataset.theme"), theme)
      assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.documentElement).fontSize"), '17px')
      assert.equal(await win.webContents.executeJavaScript("document.documentElement.dataset.accent"), 'green')
      await wait(win, "document.getElementById('message-attachments').disabled===false")
      const dropped = await win.webContents.executeJavaScript(`var pasted=new DataTransfer();pasted.items.add(new File(['synthetic paste'],'粘贴.txt',{type:'text/plain'}));document.getElementById('message-text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:pasted,bubbles:true,cancelable:true}));var dropped=new DataTransfer();dropped.items.add(new File(['synthetic drop'],'拖拽.txt',{type:'text/plain'}));document.getElementById('message-form').dispatchEvent(new DragEvent('drop',{dataTransfer:dropped,bubbles:true,cancelable:true}));document.getElementById('attachment-draft-list').children.length`)
      assert.equal(dropped, 2, 'paste and drag share the real attachment draft pipeline')
      const shiftEnter = await win.webContents.executeJavaScript(`var enter=new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true});document.getElementById('message-text').dispatchEvent(enter);enter.defaultPrevented`)
      assert.equal(shiftEnter, false)
      // Responsive browser shared surface still fits, including panel full screen.
      win.setContentSize(1024, 768); await delay(100)
      assert.equal(await win.webContents.executeJavaScript("document.documentElement.scrollWidth>innerWidth"), false)
      await shot(win, `${theme}-1024`)
      findings.push({ theme, initial, panel, queue: true, steer: true, appearancePersists: true, width1024: true })
      win.destroy(); win = null; await candidate.close(); candidate = null
    }

    // Stop is a real click and a real Esc, without submitting the typed draft.
    for (const method of ['button', 'escape']) {
      candidate = await startTimelineCandidate({ historyCount: 0, baseTime: Date.now() - 80000, interactive: true })
      win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } })
      await win.loadURL(candidate.origin + '/personal/v1/ui/')
      await win.webContents.executeJavaScript(`fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(candidate.credentials)})})`)
      await win.reload(); await wait(win, "document.getElementById('send-message').dataset.action==='stop'")
      await win.webContents.executeJavaScript("document.getElementById('message-text').value='保留这个草稿'")
      await win.webContents.executeJavaScript(method === 'button' ? "document.getElementById('send-message').click()" : "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
      for (let i = 0; i < 100 && !candidate.operations.some(op => op.kind === 'cancel'); i++) await delay(50)
      assert.equal(candidate.operations.filter(op => op.kind === 'cancel').length, 1)
      assert.equal(candidate.operations.filter(op => op.kind === 'message').length, 1)
      assert.equal(await win.webContents.executeJavaScript("document.getElementById('message-text').value"), '保留这个草稿')
      await wait(win, "document.getElementById('new-session').disabled===false")
      await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true,bubbles:true,cancelable:true}))")
      for (let i = 0; i < 100 && candidate.operations.filter(op => op.kind === 'create').length < 2; i++) await delay(50)
      assert.equal(candidate.operations.filter(op => op.kind === 'create').length, 2)
      win.destroy(); win = null; await candidate.close(); candidate = null
    }
    assert.deepEqual(errors, [], 'no browser script or CSP errors')
    if (capture) writeFileSync(join(output, 'verification.json'), JSON.stringify({ synthetic: true, findings, stopButton: true, escapeStop: true, newShortcut: true, errors }, null, 2) + '\n')
    process.stdout.write('UI-1 Chromium interactions passed (light/dark, isolated host).\n')
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1 }
  finally { win?.destroy(); await candidate?.close(); app.exit(process.exitCode || 0) }
})

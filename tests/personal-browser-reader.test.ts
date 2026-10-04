import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { browserCaptureSegments, browserCaptureVersion,
  createPersonalBrowserReader, MAX_CAPTURE_BYTES } from '../src/personal-browser/index.mjs'

test('UTF-8 browser capture segments stay bounded and carry one stable capture version', () => {
  const url = 'https://public-domain.com/long'
  const captured = Buffer.from('标题🙂\n' + '甲乙丙丁🙂'.repeat(14_000), 'utf8')
  assert.ok(captured.length < MAX_CAPTURE_BYTES)
  const parts = browserCaptureSegments(captured)
  assert.ok(parts.length > 8 && parts.length <= 32)
  assert.equal(parts.map((item) => item.text).join(''), captured.toString('utf8'))
  for (const part of parts) {
    assert.ok(Buffer.byteLength(part.text) <= 8192)
    assert.equal(part.byteEnd - part.byteStart, Buffer.byteLength(part.text))
    assert.equal(captured.subarray(part.byteStart, part.byteEnd).toString('utf8'), part.text)
  }
  assert.notEqual(browserCaptureVersion(url, captured),
    browserCaptureVersion(url, Buffer.from(captured.toString('utf8') + '后来改变的内容')))
  assert.throws(() => browserCaptureSegments(Buffer.alloc(MAX_CAPTURE_BYTES + 1, 0x61)),
    (error: { code?: string }) => error.code === 'BROWSER_CAPTURE_INVALID')
})

function fakeElectron(mode: 'downgrade' | 'navigation-change' | 'normal', failCleanup = false,
  pageText = 'Visible rendered body') {
  const partitions: string[] = []
  const sessions: Array<{ downloadListeners: number }> = []
  class Contents extends EventEmitter {
    current = ''
    setWebRTCIPHandlingPolicy() {}
    setWindowOpenHandler() {}
    getURL() { return this.current }
    async executeJavaScriptInIsolatedWorld() {
      if (mode === 'navigation-change') this.current = 'https://public-domain.com/changed'
      return { title: 'Synthetic', text: pageText, needsLogin: false, links: [],
        headings: ['Overview', 'Later section'] }
    }
  }
  class Window {
    webContents = new Contents()
    destroyed = false
    async loadURL(url: string) {
      this.webContents.current = url
      this.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      if (mode === 'downgrade') {
        this.webContents.emit('will-redirect', {
          url: 'http://public-domain.com/landing', isMainFrame: true, preventDefault() {},
        })
      }
    }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
  const session = { fromPartition: (partition: string) => { partitions.push(partition)
    const counters = { downloadListeners: 0 }; sessions.push(counters); return {
    closeAllConnections: async () => {}, setProxy: async () => {},
    clearStorageData: async () => { if (failCleanup) throw new Error('synthetic cleanup failure') },
    clearAuthCache: async () => {},
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    on(name: string) { if (name === 'will-download') counters.downloadListeners++ },
    webRequest: { onBeforeRequest() {}, onCompleted() {} },
  } } }
  return { BrowserWindow: Window, session, partitions, sessions }
}

test('hidden reader rejects a top-level HTTPS downgrade and DOM/URL navigation mismatch', async () => {
  for (const [mode, expected] of [
    ['downgrade', 'BROWSER_DOWNGRADE_BLOCKED'],
    ['navigation-change', 'BROWSER_PAGE_CHANGED'],
  ] as const) {
    const reader = createPersonalBrowserReader(fakeElectron(mode))
    try {
      await assert.rejects(reader.read({ ownerId: 'owner-test', taskId: 'task-test',
        sessionId: 'session-test', receiptId: 'receipt-test', callId: `call-${mode}`,
        url: 'https://public-domain.com/start' }),
      (error: { code?: string }) => error.code === expected)
    } finally { await reader.close() }
  }
})

test('a cleaned slot reuses one in-memory session with one fixed download-deny handler', async () => {
  const electron = fakeElectron('normal')
  const reader = createPersonalBrowserReader(electron)
  try {
    for (let i = 0; i < 3; i++) {
      const result = await reader.read({ ownerId: i % 2 ? 'owner-B' : 'owner-A', taskId: `task-${i}`,
        sessionId: 'session-test', receiptId: `receipt-${i}`, callId: `call-${i}`,
        url: 'https://public-domain.com/start' })
      assert.match(result.text, /Visible rendered body/)
    }
    assert.equal(electron.partitions.length, 1)
    assert.equal(electron.sessions[0].downloadListeners, 1)
    assert.equal(reader.status().quarantinedSessions, 0)
  } finally { await reader.close() }
})

test('a long rendered page exposes a small lead and marks capture beyond its 256 KiB limit incomplete', async () => {
  const reader = createPersonalBrowserReader(fakeElectron('normal', false, '甲乙🙂'.repeat(70_000)))
  try {
    const result = await reader.read({ ownerId: 'owner-long', taskId: 'task-long',
      sessionId: 'session-long', receiptId: 'receipt-long', callId: 'call-long',
      url: 'https://public-domain.com/long' })
    assert.equal(result.captureTruncated, true)
    assert.equal(result.truncated, true)
    assert.equal(result.segmentCount, 32)
    assert.ok(result.totalCapturedBytes <= MAX_CAPTURE_BYTES)
    assert.ok(Buffer.byteLength(result.text) <= 8192)
    assert.ok(Buffer.byteLength(result.outline) <= 2048)
    assert.equal(result.versionHash,
      browserCaptureVersion(result.url, Buffer.from(result.capturedText)))
    assert.equal(result.text, browserCaptureSegments(result.capturedText)[0].text)
  } finally { await reader.close() }
})

test('failed cleanup quarantines each partition and reports bounded failure without sharing state', async () => {
  const electron = fakeElectron('normal', true)
  const reader = createPersonalBrowserReader(electron)
  try {
    for (let i = 0; i < 4; i++) {
      const read = await reader.read({ ownerId: i % 2 ? 'owner-B' : 'owner-A', taskId: `task-${i}`,
        sessionId: 'session-test', receiptId: `receipt-${i}`, callId: `call-${i}`,
        url: 'https://public-domain.com/start' })
      assert.match(read.text, /Visible rendered body/)
    }
    assert.equal(new Set(electron.partitions).size, 4)
    assert.deepEqual({ available: reader.status().available,
      quarantined: reader.status().quarantinedSessions,
      lastFailure: reader.status().lastFailure },
    { available: false, quarantined: 4, lastFailure: 'BROWSER_CLEANUP_FAILED' })
    await assert.rejects(reader.read({ ownerId: 'owner-A', taskId: 'task-more',
      sessionId: 'session-test', receiptId: 'receipt-more', callId: 'call-more',
      url: 'https://public-domain.com/start' }),
    (error: { code?: string }) => error.code === 'BROWSER_CLEANUP_FAILED')
  } finally { await reader.close() }
})

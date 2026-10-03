import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createPersonalBrowserReader } from '../src/personal-browser/index.mjs'

function fakeElectron(mode: 'downgrade' | 'navigation-change' | 'normal', failCleanup = false) {
  const partitions: string[] = []
  const sessions: Array<{ downloadListeners: number }> = []
  class Contents extends EventEmitter {
    current = ''
    setWebRTCIPHandlingPolicy() {}
    setWindowOpenHandler() {}
    getURL() { return this.current }
    async executeJavaScriptInIsolatedWorld() {
      if (mode === 'navigation-change') this.current = 'https://public-domain.com/changed'
      return { title: 'Synthetic', text: 'Visible rendered body', needsLogin: false, links: [] }
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

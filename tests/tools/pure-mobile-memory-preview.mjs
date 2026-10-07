/** Synthetic visual preview only. No account store, MemoWeft Core, model, or production connection. */
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleMobileMemoryPreview } from './mobile-memory-preview.mjs'
import { handleFixtureEvidence } from './mobile-evidence-handler.mjs'

const candidateRoot = fileURLToPath(new URL('../../', import.meta.url))
const mobileRoot = join(candidateRoot, 'apps', 'mobile-ui', 'www')
const ownerId = 'synthetic-owner-A'
const now = '2026-09-27T00:00:00.000Z'
const items = [
  { id: 'synthetic-cognition-1', kind: 'cognition', text: '合成账户A偏好先看清楚的结论。', currentState: 'current',
    createdAt: now, updatedAt: now, lifecycle: { invalidAt: null, archivedAt: null, mutedAt: null }, sourceCount: 1 },
  { id: 'synthetic-entity-1', kind: 'entity', text: '合成项目“晨星”是一项演示资料。', currentState: 'current',
    createdAt: now, updatedAt: now, lifecycle: { invalidAt: null, archivedAt: null, mutedAt: null }, sourceCount: 1 },
]
const source = { evidenceId: 'synthetic-evidence-1', relation: 'supports', currentnessState: 'current',
  permissions: { allowLocalRead: true, allowCloudRead: false, allowInference: true }, contentAvailable: true,
  rawContentTruncated: false, summary: '合成来源摘要，仅供界面验收。', rawContent: '合成来源原文，没有读取私人资料。', recordedAt: now }
let origin = ''

function readMemory(_request, path) {
  const url = new URL(path, origin)
  if (url.pathname === '/personal/v1/memory/status') return { ownerId, state: 'ready', worldRevision: 1,
    capabilities: { list: true, source: true, inject: true, correct: false, mute: false,
      deleteEvidence: false, deleteWorldItem: false }, pendingBoundaryCount: 0, blockedBoundaryCount: 0,
    discardedBoundaryCount: 0, lastFailureCode: null }
  if (url.pathname === '/personal/v1/memory/items') {
    const kind = url.searchParams.get('kind')
    if (!['cognition', 'entity', 'relationship', 'event'].includes(kind)) throw new Error('INVALID_REQUEST')
    const query = (url.searchParams.get('query') ?? '').normalize('NFKC').toLocaleLowerCase()
    return { ownerId, items: items.filter((item) => item.kind === kind && (!query ||
      item.text.normalize('NFKC').toLocaleLowerCase().includes(query))), worldRevision: 1,
    nextCursor: null, hasMore: false, searchScope: 'account_snapshot' }
  }
  const match = /^\/personal\/v1\/memory\/items\/(cognition|entity|relationship|event)\/([A-Za-z0-9_-]+)(\/sources)?$/.exec(url.pathname)
  if (match) {
    const item = items.find((entry) => entry.kind === match[1] && entry.id === match[2])
    if (!item) throw new Error('NOT_FOUND')
    if (match[3]) return { ownerId, sources: [source], worldRevision: 1 }
    return { ownerId, item, worldRevision: 1, availableActions: {
      correct: { available: false, reasonCode: 'MEMORY_ACTION_UNSUPPORTED' },
      mute: { available: false }, delete: { available: false } } }
  }
  throw new Error('NOT_FOUND')
}

const session = { ownerId, username: '合成账户A', displayName: '合成账户A' }
const server = createServer(async (request, response) => {
  try {
    if (await handleFixtureEvidence(request, response, { root: candidateRoot,
      fixtureHost: new URL(origin).host, fixtureOrigin: origin })) return
    if (await handleMobileMemoryPreview(request, response, { root: mobileRoot, origin,
      resolveSession: async () => session, readMemory })) return
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成手机记忆预览</title><body><h1>合成验收，仅供390布局截图</h1><p>没有真实账户、MemoWeft Core、模型或私人数据。</p><a href="/personal/v1/__fixture/mobile">打开手机记忆预览</a></body></html>')
      return
    }
    response.writeHead(404); response.end()
  } catch {
    if (!response.headersSent) response.writeHead(500)
    response.end('Synthetic preview unavailable')
  }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.2', resolve) })
origin = `http://127.0.0.2:${server.address().port}`
console.log(JSON.stringify({ previewUrl: `${origin}/personal/v1/__fixture/mobile`,
  evidenceUrl: `${origin}/__fixture/evidence`,
  warning: 'SYNTHETIC VISUAL PREVIEW ONLY; no real account database, MemoWeft Core, model, or private data.' }))

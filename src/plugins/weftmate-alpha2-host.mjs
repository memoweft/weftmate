/**
 * V4 candidate host seam.  It is deliberately independent from the legacy
 * gateway because alpha.2 no longer supplies its apiProxy dependency.
 */
import { createAlpha2SessionBridge } from './weftmate-alpha2-session-bridge.mjs'

export const name = 'weftmate-alpha2-host'
// `connection.fetch` is the only public status route.  It runs inside the
// official `/api` browser trust and cookie-admission fence; a plain web-server
// route outside Connection would not inherit that fence.
export const inject = ['connection', 'typertGateway', 'sessionController', 'permissionPresets']

export function apply(ctx) {
  const bridge = createAlpha2SessionBridge({
    gateway: ctx.typertGateway,
    sessionController: ctx.sessionController,
    permissionPresets: ctx.permissionPresets,
  })
  ctx.provide('weftmateAlpha2Runtime', bridge)
  const payload = () => JSON.stringify({
    app: { name: 'WeftMate', version: process.env.WEFTMATE_APP_VERSION ?? 'alpha2-candidate' },
    runtime: { engine: 'dsh', generation: 'v4', integration: 'weave-v2-foundation' },
    conversation: {
      api: '/api', controller: 'official-sessionController', data: 'isolated-candidate-home',
      recovery: 'official-session-follow-snapshot',
    },
    credentials: { provider: 'weftmate-safe-storage', records: 'browser-auth-in-memory-only' },
    capabilities: { chatShell: true, weaveV2Foundation: true, legacyGateway: false, ...bridge.capabilities },
    // This authenticated endpoint deliberately publishes no session rows.
    // Live state is read through official `session/list` and `session/follow`,
    // which retain their native failure and recovery semantics.
    status: { sessionState: 'official-session-list-follow', memoWeft: 'not-integrated', mods: 'not-integrated' },
  })
  // This route reports only assembled candidate identity and declared limits.
  // Session health remains the formal `session/list` / `session/follow` API.
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/weftmate/status',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => new Response(payload(), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    }),
  }), 'weftmate-alpha2-host: status')
}

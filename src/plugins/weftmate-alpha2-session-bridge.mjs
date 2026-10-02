/**
 * WeftMate's small V4 host-side facade over the official Typert Remote API.
 *
 * This is intentionally not a replacement HTTP gateway.  Every session
 * mutation goes through the alpha.2 `typertGateway` dispatcher, so its
 * generated descriptor remains the source of input validation, cancellation,
 * and Remote error identity.  The browser uses the matching `ctx.remote`
 * client surface; this facade gives the host the same contract for status,
 * recovery, and future WeftMate-owned integrations.
 */

const SESSION_NAMESPACE = 'session'
const PERMISSION_PRESETS_NAMESPACE = 'permissionPresets'

const sessionMethods = Object.freeze([
  'list', 'create', 'modelCatalog', 'selectModel', 'prompt', 'cancel',
  'page', 'follow', 'projections',
])

function assertGateway(gateway) {
  if (gateway === null || typeof gateway !== 'object'
    || typeof gateway.invoke !== 'function' || typeof gateway.stream !== 'function') {
    throw new TypeError('weftmate alpha2 requires the official typertGateway service')
  }
}

function assertSessionController(controller) {
  if (controller === null || typeof controller !== 'object' || typeof controller.resolveAgent !== 'function') {
    throw new TypeError('weftmate alpha2 requires the official sessionController service')
  }
}

function assertPermissionPresets(permissionPresets) {
  if (permissionPresets === null || typeof permissionPresets !== 'object'
    || !Array.isArray(permissionPresets.names) || typeof permissionPresets.set !== 'function') {
    throw new TypeError('weftmate alpha2 requires the official permissionPresets service')
  }
}

/**
 * Construct the host facade from already-composed official services.
 * No protocol fields are reimplemented here: `typertGateway` dispatches the
 * actual alpha.2 Remote methods and preserves its business failures.
 */
export function createAlpha2SessionBridge({ gateway, sessionController, permissionPresets }) {
  assertGateway(gateway)
  assertSessionController(sessionController)
  assertPermissionPresets(permissionPresets)

  // Generated alpha.2 Remote descriptors use their TypeScript parameter name
  // as the wire key.  Keep that narrow mapping here rather than flattening
  // request fields into a made-up WeftMate protocol.
  const invoke = (method, request, signal) => gateway.invoke({
    namespace: SESSION_NAMESPACE,
    method,
    args: method === 'list' ? { _request: request } : { request },
    ...(signal === undefined ? {} : { signal }),
  })

  return Object.freeze({
    /** Stable capability declaration for WeftMate-owned UI and host features. */
    capabilities: Object.freeze({
      transport: 'official-typert-remote-v4',
      sessionController: 'official',
      list: true,
      create: true,
      modelCatalog: true,
      prompt: true,
      cancel: true,
      follow: true,
      recover: true,
      permissionPresets: true,
      workspace: true,
      memoWeft: false,
      mods: false,
    }),

    list(signal) { return invoke('list', {}, signal) },
    create(request) { return invoke('create', request) },
    modelCatalog() {
      return gateway.invoke({ namespace: SESSION_NAMESPACE, method: 'modelCatalog', args: {} })
    },
    selectModel(request) { return invoke('selectModel', request) },
    prompt(request, signal) { return invoke('prompt', request, signal) },
    cancel(sessionId) { return invoke('cancel', { sessionId }) },
    page(request, signal) { return invoke('page', request, signal) },
    projections(sessionId, signal) { return invoke('projections', { sessionId }, signal) },

    /**
     * Re-open the canonical durable session journal after a UI or host restart.
     * The first frame is an authoritative snapshot; subsequent frames are
     * contiguous durable events plus optional transient assistant chunks.
     */
    follow(request, signal) {
      return gateway.stream({
        namespace: SESSION_NAMESPACE,
        method: 'follow',
        args: { request },
        ...(signal === undefined ? {} : { signal }),
      })
    },

    permissionCatalog() {
      return gateway.invoke({ namespace: PERMISSION_PRESETS_NAMESPACE, method: 'catalog', args: {} })
    },

    /** Official prerequisite for an isolated Mod-maintainer session. */
    createWorkspace(request) {
      return gateway.invoke({ namespace: 'workspace', method: 'create', args: { request } })
    },

    /**
     * Apply one official preset to the live Agent.  The underlying service
     * writes the durable `permission/preset` event and canonical sandbox /
     * approval events; this facade never invents a second permission store.
     */
    async setPermissionPreset(sessionId, preset) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new TypeError('sessionId is required')
      }
      if (typeof preset !== 'string' || !permissionPresets.names.includes(preset)) {
        throw new TypeError('permission preset is not available')
      }
      const resolved = await sessionController.resolveAgent(sessionId)
      if (resolved === null || typeof resolved !== 'object' || !('agent' in resolved)) {
        throw resolved?.error ?? new Error('session agent is unavailable')
      }
      permissionPresets.set(resolved.agent.session, preset)
      return Object.freeze({ accepted: true, preset: permissionPresets.current(resolved.agent.session) })
    },

    /** Read-only liveness snapshot. This never starts a model request. */
    async status(signal) {
      const [listed, permissions] = await Promise.all([
        invoke('list', {}, signal),
        gateway.invoke({ namespace: PERMISSION_PRESETS_NAMESPACE, method: 'catalog', args: {} }),
      ])
      return Object.freeze({
        sessionCount: Array.isArray(listed?.items) ? listed.items.length : 0,
        sessions: listed,
        permissionCatalog: permissions,
      })
    },
  })
}

export const ALPHA2_SESSION_METHODS = sessionMethods

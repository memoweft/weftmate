// Small, dependency-free bridge used by the classic DSH client plugin. Keeping
// it as an ES module gives the integration tests a real executable boundary.
export function validModAction(value) {
  return !!(value && value.type === 'weftmate-mod-action'
    && typeof value.action === 'string' && value.action.length > 0 && value.action.length <= 80
    && typeof value.requestId === 'string' && value.requestId.length > 0 && value.requestId.length <= 80
    && (value.payload === undefined || (value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload))))
}

export function modRequestPayload(sessionId, action, data = {}) {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('A real session id is required')
  if (typeof action !== 'string' || !action || action.length > 80) throw new Error('Invalid Mod action')
  var body = Object.assign({ session_id: sessionId, action: action }, data)
  var encoded = JSON.stringify(body)
  if (new TextEncoder().encode(encoded).byteLength > 64 * 1024) throw new Error('Mod request exceeds 64 KiB')
  return { body: body, encoded: encoded }
}

export function createModFrameBridge(options) {
  var frame = options.frame
  var token = options.token
  var Channel = options.MessageChannel || globalThis.MessageChannel
  var onAction = options.onAction
  var onReady = options.onReady
  var channel = null
  var port = null
  var disposed = false

  function closePort(value) {
    if (value && typeof value.close === 'function') value.close()
  }

  function receiveWindowMessage(event) {
    var data = event && event.data
    if (disposed || !frame || event.source !== frame.contentWindow) return false
    if (!data || data.type !== 'weftmate-mod-ready' || data.token !== token || !Channel) return false
    closePort(port)
    if (channel) closePort(channel.port2)
    channel = new Channel()
    port = channel.port1
    port.onmessage = function (portEvent) {
      var message = portEvent && portEvent.data
      if (disposed || !validModAction(message) || message.token !== token) return
      Promise.resolve().then(function () { return onAction({ requestId: message.requestId, action: message.action, payload: message.payload }) })
        .then(function (result) {
          if (!disposed && port) port.postMessage({ type: 'weftmate-mod-result', token: token, requestId: message.requestId, result: result })
        }, function (error) {
          if (!disposed && port) port.postMessage({ type: 'weftmate-mod-error', token: token, requestId: message.requestId, error: error && error.message ? error.message : String(error || '请求失败') })
        })
    }
    // Opaque sandbox frames have no stable origin. This '*' is narrowly scoped:
    // it is sent only to the iframe whose ready event passed the source+token check.
    frame.contentWindow.postMessage({ type: 'weftmate-mod-connect', token: token }, '*', [channel.port2])
    if (typeof onReady === 'function') onReady()
    return true
  }

  return Object.freeze({
    receiveWindowMessage: receiveWindowMessage,
    requestHandshake: function () {
      if (disposed || !frame || !frame.contentWindow) return false
      // This is not a capability grant. It merely supplies the per-frame token
      // that lets the child send its first ready message after its load event.
      frame.contentWindow.postMessage({ type: 'weftmate-mod-init', token: token }, '*')
      return true
    },
    dispose: function () {
      if (disposed) return
      disposed = true
      if (port) port.onmessage = null
      closePort(port)
      if (channel) closePort(channel.port2)
      port = null
      channel = null
    },
  })
}

if (typeof window !== 'undefined') {
  window.__WeftMateModFrameBridge__ = Object.freeze({ validAction: validModAction, create: createModFrameBridge })
}

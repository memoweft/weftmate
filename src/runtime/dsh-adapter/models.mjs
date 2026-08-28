/**
 * P1-04 DSH model adapter.
 *
 * Model catalog (`llm.models`, host-scoped), the per-session selection view
 * (`session.models`), and the session-local selection write
 * (`session.selectModel`).  Receives the already-composed in-process client;
 * failures surface as redacted `DshAdapterError`s.
 */
import { DshAdapterError, unwrap } from './sessions.mjs'

/**
 * Build the model-side adapter around the supported client methods only.
 * Catalog groups/failures and the selection view pass through verbatim —
 * they are provider names and identifiers, never credentials.
 */
export function createDshModelAdapter(client) {
  if (!client?.llm || !client?.sessions) throw new TypeError('supported DSH client is required')
  return {
    /** Host-scoped catalog: successfully loaded provider groups plus per-provider failures. */
    async catalog() {
      return unwrap(await client.llm.models({}), 'models.catalog')
    },

    /** One session's current selection with the routable catalog snapshot. */
    async sessionModels(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('sessionId must be a non-empty string')
      return unwrap(await client.sessions.models({ sessionId }), 'models.session')
    },

    /**
     * Select the complete model selection for a session.  `reasoningEffort`
     * is forwarded only when the caller supplies one; an omitted field must
     * not arrive as an explicit undefined on the wire.
     */
    async selectSessionModel(sessionId, { provider, model, reasoningEffort } = {}) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('sessionId must be a non-empty string')
      if (typeof provider !== 'string' || provider.length === 0) throw new TypeError('provider must be a non-empty string')
      if (typeof model !== 'string' || model.length === 0) throw new TypeError('model must be a non-empty string')
      const payload = reasoningEffort === undefined
        ? { sessionId, provider, model }
        : { sessionId, provider, model, reasoningEffort }
      const value = await unwrap(await client.sessions.selectModel(payload), 'models.select')
      return { selected: value?.selected ?? null }
    },
  }
}

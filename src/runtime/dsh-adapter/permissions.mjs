/**
 * P1-04 DSH permission-preset adapter.
 *
 * Permission presets are the pinned settings namespace `permission` (the
 * user-settings seam), not a dedicated RPC domain.  Every value that leaves
 * the settings seam is already redacted host-side: `role('secret')` fields
 * never ride a response, and the `secrets` slot list only reports whether a
 * write-only field is configured.  This adapter forwards those redacted views
 * verbatim and adds nothing.
 */
import { DshAdapterError, unwrap } from './sessions.mjs'

const PERMISSION_NS = 'permission'

/**
 * Build the permission-side adapter around the supported client methods only.
 */
export function createDshPermissionAdapter(client) {
  if (!client?.settings) throw new TypeError('supported DSH client is required')
  return {
    /**
     * The redacted `permission` namespace view (schema envelope, layered
     * value, secret slots, applies, revision), or null when the namespace is
     * not registered in this composition.
     */
    async describe() {
      const value = await unwrap(await client.settings.describe({}), 'permissions.describe')
      const namespaces = Array.isArray(value?.namespaces) ? value.namespaces : []
      return namespaces.find((namespace) => namespace?.ns === PERMISSION_NS) ?? null
    },

    /** Merge a patch into the permission user layer; responds with the new redacted view. */
    async update({ patch, expectedRevision } = {}) {
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch must be an object')
      const payload = expectedRevision === undefined ? { ns: PERMISSION_NS, patch } : { ns: PERMISSION_NS, patch, expectedRevision }
      return unwrap(await client.settings.update(payload), 'permissions.update')
    },

    /** Wholesale reset of the permission user section (`section: {}` restores composition defaults). */
    async replace({ section, expectedRevision } = {}) {
      if (section === null || typeof section !== 'object' || Array.isArray(section)) throw new TypeError('section must be an object')
      const payload = expectedRevision === undefined ? { ns: PERMISSION_NS, section } : { ns: PERMISSION_NS, section, expectedRevision }
      return unwrap(await client.settings.replace(payload), 'permissions.replace')
    },
  }
}

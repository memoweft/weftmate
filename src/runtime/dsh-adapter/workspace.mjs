/**
 * P1-04 DSH workspace adapter.
 *
 * Wire projection of the pinned `workspace.*` RPC domain (registry of stable
 * ids over existing directories).  Receives the already-composed in-process
 * client; every failure surfaces as a redacted `DshAdapterError`.
 */
import { DshAdapterError, unwrap } from './sessions.mjs'

function requireWorkspaceId(value) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('workspaceId must be a non-empty string')
}

/**
 * Build the workspace-side adapter around the supported client methods only.
 * Views pass through verbatim: `WorkspaceView` is host-owned and carries no
 * secret-role fields (a directory path and display title only).
 */
export function createDshWorkspaceAdapter(client) {
  if (!client?.workspace) throw new TypeError('supported DSH client is required')
  return {
    /** Registry display order plus the global archive set. */
    async list() {
      return unwrap(await client.workspace.list({}), 'workspaces.list')
    },

    /** Create (or idempotently resolve) a workspace over an existing directory. */
    async create({ path }) {
      if (typeof path !== 'string' || path.length === 0) throw new TypeError('path must be a non-empty string')
      const value = await unwrap(await client.workspace.create({ path }), 'workspaces.create')
      return { workspace: value?.workspace ?? null, created: value?.created === true }
    },

    async rename({ workspaceId, title }) {
      requireWorkspaceId(workspaceId)
      if (typeof title !== 'string' || title.trim().length === 0) throw new TypeError('title must be a non-empty string')
      const value = await unwrap(await client.workspace.rename({ workspaceId, title }), 'workspaces.rename')
      return { workspace: value?.workspace ?? null }
    },

    /** Removes the registration only; directories and session logs stay untouched. */
    async remove({ workspaceId }) {
      requireWorkspaceId(workspaceId)
      const value = await unwrap(await client.workspace.delete({ workspaceId }), 'workspaces.delete')
      return { deleted: value?.deleted === true }
    },
  }
}

export { DshAdapterError }

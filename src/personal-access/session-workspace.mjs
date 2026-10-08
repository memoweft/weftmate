import path from 'node:path'
import { createHash } from 'node:crypto'
export function sessionWorkspace(root, ownerId, sessionId) {
  if (!root || typeof ownerId !== 'string' || !ownerId ||
      !/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new TypeError('invalid session workspace')
  return path.join(root, createHash('sha256').update(ownerId).digest('hex'), sessionId)
}

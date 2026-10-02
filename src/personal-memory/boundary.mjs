import { createHash } from 'node:crypto';

const fail = () => Object.assign(new Error('MEMORY_BOUNDARY_INVALID'), { code: 'MEMORY_BOUNDARY_INVALID' });
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EVENT = /^weftmate-turn-boundary-v1:[a-f0-9]{32}:[a-f0-9]{64}$/;
const canonicalJson = (value) => {
  const sorted = (item) => item === null || typeof item !== 'object' ? item
    : Array.isArray(item) ? item.map(sorted)
      : Object.fromEntries(Object.keys(item).sort().map((key) => [key, sorted(item[key])]));
  return JSON.stringify(sorted(value)).replace(/[\u007f-\uffff]/g,
    (letter) => `\\u${letter.charCodeAt(0).toString(16).padStart(4, '0')}`);
};

/** Recheck the managed child payload against the owner-bound DSH session before any write. */
export function assertOwnerBoundBoundary(sessionId, boundary) {
  if (typeof sessionId !== 'string' || !ID.test(sessionId) ||
      !boundary || typeof boundary !== 'object' || Array.isArray(boundary) ||
      Object.keys(boundary).sort().join(',') !==
        'event_id,mode,parent_session_id,payload_hash,provider_name,result_session_id,schema_version,source_messages' ||
      boundary.schema_version !== 1 || boundary.provider_name !== 'memoweft' ||
      boundary.mode !== 'turn' || boundary.parent_session_id !== sessionId ||
      boundary.result_session_id !== sessionId || !EVENT.test(boundary.event_id ?? '') ||
      !/^[a-f0-9]{64}$/.test(boundary.payload_hash ?? '') ||
      !Array.isArray(boundary.source_messages) || boundary.source_messages.length < 1 ||
      boundary.source_messages.length > 50 ||
      Buffer.byteLength(JSON.stringify(boundary), 'utf8') > 128 * 1024) throw fail();
  let userCount = 0;
  for (const [index, message] of boundary.source_messages.entries()) {
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
        !['user', 'assistant'].includes(message.role) ||
        (message.role === 'user' && ++userCount > 25) ||
        typeof message.content !== 'string' || !message.content.trim() || message.content.length > 16_384 ||
        message.source_ref !== `source:${index}` ||
        (message.message_id !== undefined && (typeof message.message_id !== 'string' || message.message_id.length > 160)) ||
        (message.timestamp !== undefined && (!Number.isSafeInteger(message.timestamp) || message.timestamp < 0)) ||
        Object.keys(message).some((key) => !['role', 'content', 'source_ref', 'message_id', 'timestamp'].includes(key))) {
      throw fail();
    }
  }
  if (!userCount) throw fail();
  const { event_id: _eventId, payload_hash: _payloadHash, ...payload } = boundary;
  const hash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
  if (hash !== boundary.payload_hash || !boundary.event_id.endsWith(hash)) throw fail();
  return boundary;
}

import { hash } from './crypto.mjs';
import { failure } from '../personal-access/common.mjs';

export const REPLICA_LIMITS = Object.freeze({ items: 500, text: 2000, source: 240, bytes: 2 * 1024 * 1024, conversations: 10, messages: 20 });
const permission = p => p?.allow_local_read === true && p.allow_cloud_read === true && p.allow_inference === true;

/** Core owns permissions and currentness. Never send unrestricted World exports to a model. */
export async function memorySnapshot(manager, ownerId) {
  if (!manager?.enabled) return { worldRevision: null, items: [], truncated: false };
  const result = await manager.query(ownerId, 'query_world', { operation: 'list', include_history: false });
  if (!Array.isArray(result.items) || !Number.isSafeInteger(result.world_revision)) throw failure('MEMORY_UNAVAILABLE', 503);
  const items = [];
  for (const item of result.items) {
    if (item.current_state !== 'current' || !item.provenance?.length || !item.permissions?.length ||
        !item.permissions.every(permission) || item.value?.redacted || item.lifecycle?.muted_at || item.lifecycle?.archived_at || item.lifecycle?.invalid_at) continue;
    const sources = item.provenance;
    if (sources.some(s => !permission(s.permissions) || s.currentness_state !== 'current' || s.evidence?.content_available !== true)) continue;
    const text = item.value.content ?? item.value.canonical_name;
    if (typeof text !== 'string' || !text.trim()) continue;
    items.push({ id: item.item_id, kind: item.object_kind, text: text.slice(0, REPLICA_LIMITS.text),
      viewpoint: item.value.perspective_holder ?? item.value.perspective_entity_id ?? null,
      confidence: item.value.confidence ?? null, evidenceStatus: item.value.cred_status ?? null,
      validAt: item.value.valid_at ?? null,
      // A current formal item may be usable while its full Evidence also explains an
      // alias, a superseded item or a correction. Do not export that broader source text.
      sources: sources.map(s => ({ id: s.evidence_id, summary: s.model_content_available === true
        ? String(s.evidence.summary || s.evidence.raw_content || '').slice(0, REPLICA_LIMITS.source) : null })),
      updatedAt: item.updated_at, currentState: 'current' });
  }
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.id.localeCompare(b.id));
  const final = await manager.query(ownerId, 'query_world', { operation: 'revision' });
  if (final.world_revision !== result.world_revision) throw failure('MEMORY_REVISION_CHANGED', 409);
  return { worldRevision: result.world_revision, items: items.slice(0, REPLICA_LIMITS.items), truncated: items.length > REPLICA_LIMITS.items };
}

export function replicaDelta(snapshot, known = {}) {
  if (!known || typeof known !== 'object' || Array.isArray(known) || Object.keys(known).length > 1000 ||
      Object.entries(known).some(([id, digest]) => id.length > 512 || !/^[a-f0-9]{64}$/.test(digest))) throw failure('INVALID_REQUEST');
  const hashes = Object.fromEntries(snapshot.items.map(item => [item.id, hash(item)]));
  return { ...snapshot, items: snapshot.items.filter(item => known[item.id] !== hashes[item.id]),
    remove: Object.keys(known).filter(id => !Object.hasOwn(hashes, id)), hashes };
}

export function offlineBoundary(deviceId, turn) {
  const sessionId = `offline-${hash(`${deviceId}:${turn.conversationId}`).slice(0, 48)}`;
  const payload = { schema_version: 1, provider_name: 'memoweft', mode: 'turn', parent_session_id: sessionId,
    result_session_id: sessionId, source_messages: turn.messages.map((message, i) => ({ role: message.role,
      content: message.text, source_ref: `source:${i}`, message_id: `${turn.id}:${i}`, timestamp: Math.floor(turn.timestamp / 1000) })) };
  const sort = value => value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(sort)
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  const canonical = JSON.stringify(sort(payload)).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const digest = hash(canonical);
  return { ...payload, payload_hash: digest, event_id: `weftmate-turn-boundary-v1:${hash(`${deviceId}:${turn.id}`).slice(0, 32)}:${digest}` };
}

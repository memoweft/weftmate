const KINDS = new Set(['cognition', 'entity', 'relationship', 'event']);
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const ITEM_ID = /^[A-Za-z0-9._:-]{1,512}$/;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_ITEMS = 5_000;
const MAX_DETAIL_BYTES = 256 * 1024;

const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, required = []) => {
  if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key)) ||
      required.some((key) => !Object.hasOwn(value, key))) throw failure('INVALID_REQUEST');
};
const bounded = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const safeNumber = (value) => Number.isSafeInteger(value) && value >= 0;
export const canonicalMemoryPathname = (pathname) => {
  if (typeof pathname !== 'string' || !pathname.startsWith('/personal/v1/memory/')) return null;
  if (!pathname.includes('%')) return pathname;
  if (/%(?:2f|5c)/i.test(pathname)) return null;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (!decoded.startsWith('/personal/v1/memory/') || decoded.includes('%') || decoded.includes('\\') ||
      decoded.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return decoded;
};
async function ownerQuery(manager, ownerId, method, params) {
  try { return await manager.query(ownerId, method, params); }
  catch (cause) {
    if (['world_item_not_found', 'evidence_not_found'].includes(cause?.code)) throw failure('NOT_FOUND', 404);
    throw cause;
  }
}

export function forgetPreviewView(result) {
  if (!record(result) || !safeNumber(result.world_revision) || !Array.isArray(result.items) ||
      result.item_count !== result.items.length || !safeNumber(result.evidence_count) || !Array.isArray(result.evidence_ids))
    throw failure('MEMORY_RESPONSE_INVALID', 503);
  return { worldRevision: result.world_revision, itemCount: result.item_count, evidenceCount: result.evidence_count,
    evidenceIds: result.evidence_ids, items: result.items.map(item => {
      if (!(KINDS.has(item.object_kind) || item.object_kind === 'interaction_commitment') || typeof item.item_id !== 'string' || typeof item.name !== 'string')
        throw failure('MEMORY_RESPONSE_INVALID', 503);
      return { kind: item.object_kind, id: item.item_id, text: item.name, itemType: item.item_type };
    }) };
}

function itemView(value) {
  if (!record(value) || typeof value.item_id !== 'string' || !ITEM_ID.test(value.item_id) ||
      !KINDS.has(value.object_kind) || !record(value.value)) throw failure('MEMORY_RESPONSE_INVALID', 503);
  const text = bounded(value.value.content ?? value.value.canonical_name, 4_000);
  return { id: value.item_id, kind: value.object_kind, text,
    truncated: typeof (value.value.content ?? value.value.canonical_name) === 'string' &&
      (value.value.content ?? value.value.canonical_name).length > 4_000,
    currentState: value.current_state === 'current' ? 'current' : 'not_current',
    createdAt: bounded(value.created_at, 64), updatedAt: bounded(value.updated_at, 64),
    lifecycle: { invalidAt: value.lifecycle?.invalid_at ?? null,
      archivedAt: value.lifecycle?.archived_at ?? null, mutedAt: value.lifecycle?.muted_at ?? null },
    sourceCount: Array.isArray(value.provenance) ? value.provenance.length : 0 };
}

function cursor(value, ownerId, kind, query, revision) {
  if (!value) return 0;
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw failure('INVALID_REQUEST');
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw failure('INVALID_REQUEST'); }
  if (!record(parsed) || parsed.ownerId !== ownerId || parsed.kind !== kind ||
      parsed.query !== query || !safeNumber(parsed.offset) || !safeNumber(parsed.worldRevision)) {
    throw failure('INVALID_REQUEST');
  }
  if (parsed.worldRevision !== revision) throw failure('MEMORY_REVISION_CHANGED', 409);
  return parsed.offset;
}

function publicReceipt(value, requestId) {
  const receipt = value?.receipt ?? value;
  if (!record(receipt) || !['applied', 'no_change', 'revision_conflict', 'rejected'].includes(receipt.result_state) ||
      !safeNumber(receipt.after_revision) || typeof receipt.command_id !== 'string') {
    throw failure('MEMORY_RESPONSE_INVALID', 503);
  }
  const rawReason = receipt.rejection_code;
  const isDelete = ['delete_evidence', 'delete_world_item'].includes(value?.operation);
  const reasonCode = receipt.result_state === 'rejected'
    ? isDelete && rawReason === 'source_origin_unrecoverable' ? 'MEMORY_SOURCE_UNRECOVERABLE'
      : isDelete && ['shared_source', 'source_evidence_shared', 'source_origin_reused',
        'world_item_has_dependents'].includes(rawReason) ? 'MEMORY_DELETE_CONFLICT'
        : isDelete && rawReason === 'source_provenance_missing' ? 'MEMORY_DELETE_SOURCE_UNKNOWN'
          : 'MEMORY_COMMAND_REJECTED'
    : undefined;
  const cleanup = receipt.storage_cleanup;
  const storageCleanup = record(cleanup) && ['complete', 'pending'].includes(cleanup.state) &&
    ['current_journal_committed', 'current_wal_truncated', 'wal_reader_busy',
      'checkpoint_pending', 'host_journal_cleanup_pending'].includes(cleanup.detail_code)
    ? { state: cleanup.state, detailCode: cleanup.detail_code } : undefined;
  return { commandId: receipt.command_id, requestId, state: receipt.result_state,
    worldRevision: receipt.after_revision, ...(reasonCode ? { reasonCode } : {}),
    ...(storageCleanup ? { storageCleanup } : {}) };
}

/** Authenticated owner has already been resolved by personal-access. */
export async function handlePersonalMemoryHttp({ manager, ownerId, request, pathname, url, readJson }) {
  const method = request.method;
  const path = canonicalMemoryPathname(pathname);
  if (path === null) throw failure('INVALID_REQUEST');
  if (method === 'GET' && path === '/personal/v1/memory/status') {
    if (url.search) throw failure('INVALID_REQUEST');
    return { status: 200, body: await manager.status(ownerId) };
  }
  const previewMatch = /^\/personal\/v1\/memory\/(?:items\/(entity|relationship|event|cognition)|(?<evidence>evidence))\/([^/]+)\/forget-preview$/.exec(path);
  if (method === 'GET' && previewMatch) {
    if (url.search || !ITEM_ID.test(previewMatch[3])) throw failure('INVALID_REQUEST');
    const result = await ownerQuery(manager, ownerId, 'preview_forget', {
      target_kind: previewMatch[1] ?? 'evidence', target_id: previewMatch[3],
    });
    return { status: 200, body: forgetPreviewView(result) };
  }
  if (method === 'GET' && path === '/personal/v1/memory/items') {
    if ([...url.searchParams.keys()].some((key) => !['kind', 'query', 'limit', 'after'].includes(key))) {
      throw failure('INVALID_REQUEST');
    }
    const kind = url.searchParams.get('kind') ?? 'cognition';
    const rawQuery = url.searchParams.get('query') ?? '';
    const query = rawQuery.normalize('NFKC').trim().toLocaleLowerCase();
    const limit = Number(url.searchParams.get('limit') ?? '50');
    if (!KINDS.has(kind) || rawQuery.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw failure('INVALID_REQUEST');
    }
    const result = await manager.query(ownerId, 'query_world', {
      operation: 'list', object_kind: kind, include_history: true,
    });
    if (!record(result) || !safeNumber(result.world_revision) || !Array.isArray(result.items) ||
        result.items.length > MAX_SNAPSHOT_ITEMS ||
        Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_SNAPSHOT_BYTES) {
      throw failure('MEMORY_SEARCH_LIMIT', 413);
    }
    const items = result.items.filter((item) => {
      if (!query) return true;
      const fullText = item?.value?.content ?? item?.value?.canonical_name;
      return typeof fullText === 'string' && fullText.normalize('NFKC').toLocaleLowerCase().includes(query);
    }).map(itemView);
    const offset = cursor(url.searchParams.get('after'), ownerId, kind, query, result.world_revision);
    if (offset > items.length) throw failure('INVALID_REQUEST');
    const page = items.slice(offset, offset + limit);
    const hasMore = offset + page.length < items.length;
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({ ownerId, kind, query,
      worldRevision: result.world_revision, offset: offset + page.length })).toString('base64url') : null;
    return { status: 200, body: { items: page, worldRevision: result.world_revision,
      nextCursor, hasMore, searchScope: 'account_snapshot' } };
  }
  if (method === 'GET' && path === '/personal/v1/memory/export') {
    keys(Object.fromEntries(url.searchParams), ['format']);
    const format = url.searchParams.get('format') ?? 'json';
    if (!['json', 'markdown'].includes(format)) throw failure('INVALID_REQUEST');
    const exported = [];
    let revision = null;
    for (const kind of KINDS) {
      const result = await ownerQuery(manager, ownerId, 'query_world', {
        operation: 'list', object_kind: kind, include_history: true,
      });
      if (!safeNumber(result.world_revision) || !Array.isArray(result.items)) throw failure('MEMORY_RESPONSE_INVALID', 503);
      if (revision !== null && revision !== result.world_revision) throw failure('MEMORY_REVISION_CHANGED', 409);
      revision = result.world_revision;
      for (const item of result.items) {
        const provenance = await ownerQuery(manager, ownerId, 'query_provenance', {
          object_kind: kind, item_id: item.item_id, projection: 'history',
        });
        if (provenance.world_revision !== revision || !Array.isArray(provenance.provenance)) throw failure('MEMORY_REVISION_CHANGED', 409);
        exported.push({ ...itemView(item), value: item.value, sources: provenance.provenance.map(source => ({
          evidenceId: source.evidence_id, currentnessState: source.currentness_state,
          summary: source.evidence?.content_available === true
            ? (bounded(source.evidence.summary, 2000).trim() || bounded(source.evidence.raw_content, 240) || null) : null,
          recordedAt: source.evidence?.recorded_at ?? null,
        })) });
      }
    }
    // Check again after the final read: an export is one coherent World revision.
    const final = await manager.query(ownerId, 'query_world', { operation: 'revision' });
    if (final.world_revision !== revision) throw failure('MEMORY_REVISION_CHANGED', 409);
    const bundle = { schemaVersion: 1, worldRevision: revision, exportedAt: new Date().toISOString(), items: exported };
    const content = format === 'json' ? JSON.stringify(bundle, null, 2) :
      ['# 我的记忆', '', `导出时间：${bundle.exportedAt}`, '', ...exported.flatMap(item => [
        `## ${item.kind} · ${item.id}`, '', item.value.content ?? item.value.canonical_name ?? item.text, '',
        ...item.sources.map(source => `- 来源摘要：${source.summary ?? '当前不可读'}（${source.recordedAt ?? '时间未记录'}）`), '',
      ])].join('\n');
    return { status: 200, body: { format, filename: `weftmate-memory.${format === 'json' ? 'json' : 'md'}`,
      contentType: format === 'json' ? 'application/json' : 'text/markdown', content, worldRevision: revision } };
  }
  const itemMatch = /^\/personal\/v1\/memory\/items\/(cognition|entity|relationship|event)\/([A-Za-z0-9._:-]+)(?:\/(sources|correct|mute))?$/.exec(path);
  if (itemMatch) {
    const [, kind, id, action] = itemMatch;
    if (!ITEM_ID.test(id) || url.search) throw failure('INVALID_REQUEST');
    if (method === 'GET' && !action) {
      const status = await manager.status(ownerId);
      const result = await ownerQuery(manager, ownerId, 'query_world', {
        operation: 'get', object_kind: kind, item_id: id, include_history: true,
      });
      if (!record(result) || !safeNumber(result.world_revision) ||
          Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_DETAIL_BYTES) {
        throw failure('MEMORY_RESPONSE_INVALID', 503);
      }
      const item = itemView(result.item);
      const current = item.currentState === 'current';
      const noAction = (reasonCode) => ({ available: false, reasonCode });
      return { status: 200, body: { item, worldRevision: result.world_revision,
        availableActions: {
          correct: kind === 'entity' ? noAction('MEMORY_ACTION_UNSUPPORTED')
            : status.capabilities.correct && current ? { available: true }
              : noAction(status.capabilities.correct ? 'MEMORY_NOT_CURRENT' : 'MEMORY_UNAVAILABLE'),
          mute: status.capabilities.mute && current ? { available: true }
            : noAction(status.capabilities.mute ? 'MEMORY_NOT_CURRENT' : 'MEMORY_UNAVAILABLE'),
          delete: status.capabilities.deleteWorldItem ? { available: true }
            : noAction('MEMORY_DELETE_UNAVAILABLE'),
        } } };
    }
    if (method === 'GET' && action === 'sources') {
      const result = await ownerQuery(manager, ownerId, 'query_provenance', {
        object_kind: kind, item_id: id, projection: 'history',
      });
      if (!record(result) || !safeNumber(result.world_revision) || !Array.isArray(result.provenance) ||
          result.provenance.length > 200 || Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_DETAIL_BYTES) {
        throw failure('MEMORY_RESPONSE_INVALID', 503);
      }
      const sources = result.provenance.map((source) => ({
        evidenceId: bounded(source.evidence_id, 512), relation: bounded(source.relation, 64),
        currentnessState: bounded(source.currentness_state, 64),
        permissions: { allowLocalRead: source.permissions?.allow_local_read === true,
          allowCloudRead: source.permissions?.allow_cloud_read === true,
          allowInference: source.permissions?.allow_inference === true },
        contentAvailable: source.evidence?.content_available === true,
        summary: typeof source.evidence?.summary === 'string'
          ? bounded(source.evidence.summary, 2_000) : null,
        rawContent: typeof source.evidence?.raw_content === 'string'
          ? bounded(source.evidence.raw_content, 8_192) : null,
        rawContentTruncated: typeof source.evidence?.raw_content === 'string' &&
          source.evidence.raw_content.length > 8_192,
        recordedAt: bounded(source.evidence?.recorded_at, 64),
      }));
      return { status: 200, body: { sources, worldRevision: result.world_revision } };
    }
    if (method === 'POST' && ['correct', 'mute'].includes(action)) {
      const body = await readJson(request, 16 * 1024);
      keys(body, action === 'correct' ? ['requestId', 'expectedWorldRevision', 'text']
        : ['requestId', 'expectedWorldRevision'], ['requestId', 'expectedWorldRevision',
        ...(action === 'correct' ? ['text'] : [])]);
      if (action === 'correct' && (kind === 'entity' || typeof body.text !== 'string' ||
          !body.text.trim() || body.text.length > 4_000)) throw failure('MEMORY_ACTION_UNSUPPORTED', 422);
      return submit({ manager, ownerId, body, operation: action === 'correct' ? 'correct_world_item' : 'mute_world_item',
        targetKind: kind, targetId: id, payload: action === 'correct' ? { correction_text: body.text } : {} });
    }
    if (method === 'DELETE' && !action) {
      const body = await readJson(request, 12 * 1024);
      keys(body, ['requestId', 'expectedWorldRevision', 'deleteConversationSnippets'], ['requestId', 'expectedWorldRevision']);
      if (body.deleteConversationSnippets !== undefined && typeof body.deleteConversationSnippets !== 'boolean') throw failure('INVALID_REQUEST');
      return submit({ manager, ownerId, body, operation: 'delete_world_item', targetKind: kind,
        targetId: id, payload: body.deleteConversationSnippets === true ? { delete_conversation_snippets: true } : {} });
    }
  }
  const evidenceMatch = /^\/personal\/v1\/memory\/evidence\/([A-Za-z0-9._:-]+)$/.exec(path);
  if (method === 'DELETE' && evidenceMatch) {
    if (url.search || !ITEM_ID.test(evidenceMatch[1])) throw failure('INVALID_REQUEST');
    const body = await readJson(request, 12 * 1024);
    keys(body, ['requestId', 'expectedWorldRevision', 'deleteConversationSnippets'], ['requestId', 'expectedWorldRevision']);
    if (body.deleteConversationSnippets !== undefined && typeof body.deleteConversationSnippets !== 'boolean') throw failure('INVALID_REQUEST');
    return submit({ manager, ownerId, body, operation: 'delete_evidence', targetKind: 'evidence',
      targetId: evidenceMatch[1], payload: body.deleteConversationSnippets === true ? { delete_conversation_snippets: true } : {} });
  }
  const receiptMatch = /^\/personal\/v1\/memory\/commands\/by-request\/([A-Za-z0-9_.:-]+)$/.exec(path);
  if (method === 'GET' && receiptMatch) {
    if (url.search || !REQUEST_ID.test(receiptMatch[1])) throw failure('INVALID_REQUEST');
    try {
      const result = await manager.receiptByRequest(ownerId, receiptMatch[1]);
      return { status: 200, body: { receipt: publicReceipt(result, receiptMatch[1]) } };
    } catch (cause) {
      if (cause?.code === 'command_receipt_not_found') throw failure('NOT_FOUND', 404);
      throw cause;
    }
  }
  const cleanupMatch = /^\/personal\/v1\/memory\/commands\/by-request\/([A-Za-z0-9_.:-]+)\/retry-cleanup$/.exec(path);
  if (method === 'POST' && cleanupMatch) {
    if (url.search || !REQUEST_ID.test(cleanupMatch[1])) throw failure('INVALID_REQUEST');
    keys(await readJson(request, 1024), [], []);
    let result;
    try { result = await manager.retryCleanupByRequest(ownerId, cleanupMatch[1]); }
    catch (cause) {
      if (cause?.code === 'command_receipt_not_found') throw failure('NOT_FOUND', 404);
      if (cause?.code === 'MEMORY_ACTION_UNSUPPORTED') throw failure('MEMORY_ACTION_UNSUPPORTED', 422);
      throw failure('SERVICE_UNAVAILABLE', 503);
    }
    return { status: 200, body: { receipt: publicReceipt(result, cleanupMatch[1]) } };
  }
  throw failure('NOT_FOUND', 404);
}

async function submit({ manager, ownerId, body, operation, targetKind, targetId, payload }) {
  if (!REQUEST_ID.test(body.requestId) || !safeNumber(body.expectedWorldRevision)) throw failure('INVALID_REQUEST');
  const status = await manager.status(ownerId);
  if (status.state === 'disabled' || status.state === 'unavailable') throw failure('MEMORY_UNAVAILABLE', 503);
  const operationAllowed = operation === 'correct_world_item' ? status.capabilities.correct
    : operation === 'mute_world_item' ? status.capabilities.mute
      : operation === 'delete_evidence' ? status.capabilities.deleteEvidence
        : status.capabilities.deleteWorldItem;
  if (!operationAllowed) throw failure(operation.startsWith('delete_')
    ? 'MEMORY_DELETE_UNAVAILABLE' : 'MEMORY_ACTION_UNSUPPORTED', 503);
  if (targetKind === 'evidence') await ownerQuery(manager, ownerId, 'query_evidence',
    { operation: 'get', evidence_id: targetId });
  else await ownerQuery(manager, ownerId, 'query_world',
    { operation: 'get', object_kind: targetKind, item_id: targetId, include_history: true });
  let result;
  try {
    result = await manager.submitCommand(ownerId, { requestId: body.requestId,
      expectedWorldRevision: body.expectedWorldRevision, operation, targetKind, targetId, payload,
      ...(operation.startsWith('delete_') ? { deleteConversationSnippets: body.deleteConversationSnippets === true } : {}) });
  } catch (cause) {
    if (cause?.code === 'MEMORY_REQUEST_CONFLICT') throw failure('MEMORY_REQUEST_CONFLICT', 409);
    if (cause?.code === 'MEMORY_REPLAY_REDACTED') throw failure('MEMORY_REPLAY_REDACTED', 409);
    // Once dispatch was entered, even a named RPC error may follow a committed command.
    // Never reuse an error code that the client treats as certainly pre-dispatch.
    throw failure('SERVICE_UNAVAILABLE', 503);
  }
  const receipt = publicReceipt({ ...result, operation }, body.requestId);
  return { status: ['applied', 'no_change'].includes(receipt.state) ? 200 : 409, body: { receipt } };
}

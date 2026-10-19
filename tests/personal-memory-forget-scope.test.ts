import assert from 'node:assert/strict';
import test from 'node:test';
import { forgetPreviewView, handlePersonalMemoryHttp } from '../src/personal-memory/http.mjs';

const scope = 'forget-scope-v1:' + 'a'.repeat(64);
test('Core forget preview preserves its scope and distinguishes derived copies from source deletion', () => {
  const result = forgetPreviewView({ world_revision: 1, forget_scope: scope, evidence_count: 1, evidence_ids: ['source'],
    item_count: 2, items: [{ object_kind: 'interaction_context', item_id: 'copy', name: 'You like tea.', item_type: 'interaction_context' },
      { object_kind: 'evidence_context', item_id: 'independent', name: 'You like tea.', item_type: 'preceding_ai_context' }] });
  assert.equal(result.forgetScope, scope);
  assert.deepEqual(result.evidenceIds, ['source']);
  assert.equal(result.items[1].kind, 'evidence_context');
});

test('page deletion forwards the confirmed scope unchanged and exposes stale-scope rejection', async () => {
  const writes: any[] = [];
  const manager: any = { status: async () => ({ state: 'ready', capabilities: { deleteWorldItem: true } }),
    query: async () => ({}), checkForgetCompletion: async () => ({ state: 'complete', worldRevision: 1 }),
    submitCommand: async (_owner: string, value: any) => { writes.push(value); return { receipt: {
      command_id: 'command', result_state: 'rejected', rejection_code: 'forget_scope_changed', after_revision: 1 } }; } };
  const url = new URL('http://memory/personal/v1/memory/items/cognition/target');
  const result = await handlePersonalMemoryHttp({ manager, ownerId: 'owner', pathname: url.pathname, url,
    request: { method: 'DELETE' }, readJson: async () => ({ requestId: 'request', expectedWorldRevision: 1, forgetScope: scope }) });
  assert.deepEqual(writes[0].payload, { forget_scope: scope });
  assert.equal(result.body.receipt.reasonCode, 'MEMORY_REVISION_CHANGED');
  assert.equal(writes.length, 1);
});

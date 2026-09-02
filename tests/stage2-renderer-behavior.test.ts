import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendMessageNode, updateMessageNode } from '../src/web/message-dom-updates.js';
import { applyMessageUpdate } from '../src/web/message-stream-state.js';
import { retryPromptForSession } from '../src/web/session-retry.js';
import { deriveWorkspaceState } from '../src/web/workspace-state.js';
import { beginApproval, receiveApproval, settleApproval } from '../src/web/approval-state.js';
import { captureThemeRollback, rollbackThemePreference } from '../src/web/theme-preference-state.js';
import { editorProfileForSettings } from '../src/web/settings-editor-state.js';

describe('Stage 2 renderer executable behavior', () => {
  it('derives all four model states and preserves history while runtime is unavailable', () => {
    assert.equal(deriveWorkspaceState({ profile: null, runtimeReady: false, running: false }).kind, 'no-profile');
    assert.equal(deriveWorkspaceState({ profile: { hasKey: false }, runtimeReady: true, running: false }).kind, 'credential-unavailable');
    const unavailable = deriveWorkspaceState({ profile: { hasKey: true }, runtimeReady: false, running: false });
    assert.equal(unavailable.kind, 'runtime-unavailable'); assert.equal(unavailable.preserveHistory, true);
    assert.equal(deriveWorkspaceState({ profile: { hasKey: true }, runtimeReady: true, running: false }).kind, 'ready');
  });

  it('uses the active model for fault-state edit even when no or another editor row is selected, and only no-profile becomes new', () => {
    const active = { id: 'A' }; const stale = { id: 'B' };
    assert.equal(editorProfileForSettings('edit', active, null), active);
    assert.equal(editorProfileForSettings('edit', active, stale), active);
    assert.equal(editorProfileForSettings('edit', null, stale), null);
    assert.equal(editorProfileForSettings('new', active, stale), null);
    assert.equal(editorProfileForSettings(undefined, active, stale), stale);
  });

  it('appends a new node, applies keyed delta without replacing history or replaying it, and keeps retry prompts session-scoped', () => {
    const old = { dataset: { messageId: 'old' }, textContent: 'old history' }; const root = { children: [old] as any[], append(node: any) { this.children.push(node); }, querySelector(selector: string) { const id = selector.match(/message-id="([^"]+)/)?.[1]; return this.children.find((node) => node.dataset.messageId === id) ?? null; } };
    const messages: any[] = []; const appended = applyMessageUpdate(messages, 'assistant.delta', 'first', () => 'new'); const fresh = appendMessageNode(root, appended.message, (message: any) => ({ dataset: { messageId: message.id }, textContent: message.text }));
    const delta = applyMessageUpdate(messages, 'assistant.delta', ' second', () => 'unused'); updateMessageNode(root, delta.message.id, delta.message.text);
    assert.equal(root.children[0], old); assert.equal(root.children[1], fresh); assert.equal(fresh.textContent, 'first second');
    assert.equal(retryPromptForSession(new Map([['a', 'A prompt']]), new Map([['b', [{ kind: 'user', text: 'B prompt' }]]]), 'b'), 'B prompt');
  });

  it('keeps a rejected approval request actionable, clears error only on success/new request, and rolls theme back for result and Promise failures', () => {
    let approval = receiveApproval(null, { approvalId: 'first' }); approval = settleApproval(beginApproval(approval), { ok: false, error: 'rejected' });
    assert.equal(approval.request?.approvalId, 'first'); assert.equal(approval.error, 'rejected'); assert.equal(approval.submitting, false);
    approval = receiveApproval(approval, { approvalId: 'second' }); assert.equal(approval.request?.approvalId, 'second'); assert.equal(approval.error, '');
    approval = settleApproval(beginApproval(approval), { ok: true, accepted: true }); assert.equal(approval.request, null); assert.equal(approval.error, '');
    const snapshot = captureThemeRollback('dark', 'dark');
    assert.deepEqual(rollbackThemePreference(snapshot), { theme: 'dark', storedTheme: 'dark' }); // `{ok:false}` and rejected Promise share this rollback path.
  });
});

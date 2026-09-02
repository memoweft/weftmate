import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const vendorConversation = readFileSync(new URL('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('WeftMate conversation workspace surface', () => {
  it('styles only stable official DSH conversation structure', () => {
    const start = client.indexOf('function installConversationWorkspaceSurface()');
    const end = client.indexOf('// Stage 4B is a projection', start);
    assert.ok(start >= 0 && end > start, 'conversation surface installer must remain separately auditable');
    const source = client.slice(start, end);

    for (const marker of ['data-phase', 'data-conversation-scroll', 'data-chat-flow-kind', 'data-approval-key', 'data-composer-card']) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(source, /\[data-phase="hero"\] \[data-conversation-scroll\]/);
    assert.match(source, /data-weftmate-hero-composer/);
    assert.match(source, /\[data-composer-card\]:has\(textarea\[aria-haspopup="menu"\]\)::after/);
    assert.doesNotMatch(source, /ctx\.slots|fetch\(|useState|MutationObserver/);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i);
  });

  it('groups the official hero controls and official input in one vendor-owned layout seam', () => {
    const start = vendorConversation.indexOf('const composerBar =');
    const end = vendorConversation.indexOf('const phase =', start);
    const source = vendorConversation.slice(start, end);

    assert.ok(start >= 0 && end > start, 'official conversation composer must stay auditable');
    assert.match(source, /"data-weftmate-hero-composer": ""/);
    assert.match(source, /heroWorkspaceRow/);
    assert.match(source, /inputBar/);
    assert.doesNotMatch(source, /HeroShell/);
  });

  it('keeps the official graph as the only interactive owner', () => {
    const applyStart = client.indexOf("apply: function (ctx) {");
    const shellOnlyReturn = client.indexOf('        return', applyStart);
    const oldOverlay = client.indexOf("ctx.slots.inject('shell.overlay'", applyStart);

    assert.ok(applyStart >= 0 && shellOnlyReturn > applyStart);
    assert.match(client.slice(applyStart, shellOnlyReturn), /installElectronWindowChrome\(\)/);
    assert.match(client.slice(applyStart, shellOnlyReturn), /installConversationWorkspaceSurface\(\)/);
    assert.ok(oldOverlay > shellOnlyReturn, 'no WeftMate overlay is registered for the official conversation');
  });
});

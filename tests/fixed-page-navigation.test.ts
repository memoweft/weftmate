import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('#622 new conversation cancels a library read that is still loading', async () => {
  let ready!: () => void;
  const reading = new Promise<void>(resolve => { ready = resolve; });
  let reads = 0, focus = 0;
  const nodes = new Map<string, any>();
  const node = (tag = '', className = ''): any => ({ tag, className, dataset: {}, hidden: true, append() {}, after(next: any) { this.following = next; },
    setAttribute() {}, querySelector: () => ({ textContent: '' }) });
  const get = (id: string) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const listeners = new Map<string, any>();
  const document = { body: { classList: { add() {}, remove() {} } }, addEventListener: (name: string, fn: any) => listeners.set(name, fn) };
  const core: any = { state: { personalCapabilities: { library: 1 } }, show(view: string) { core.state.currentView = view; },
    selectSession() {}, selectMainChat() {}, readLibrary: () => { reads++; return reading; }, resetLibrary() {} };
  const ui: any = { byId: get, element: node, fixedPageNavigation: () => node(), closeRail() {},
    paintSelectedSession() {}, resetIdentityControls() {}, updateAvailability() {}, renderTimeline() {} };
  const global: any = { WeftUiComponents: { factories: {} }, document, WeftIcons: { create: () => node() },
    WeftLibraryView: { mount: () => ({ focus() { focus++; }, deactivate() {} }) } };
  runInNewContext(readFileSync(new URL('../src/personal-access-ui/components/library.js', import.meta.url), 'utf8'), global);
  Object.assign(ui, global.WeftUiComponents.factories.library(core, ui)); ui.mountLibrary();
  const opening = ui.openLibrary();
  assert.equal(reads, 1, 'the library read must actually be pending');
  assert.equal(get('conversation-pane').following.hidden, false, 'the library appears immediately while its content loads');
  listeners.get('weftmate:fixed-page')({ detail: 'conversation' });
  ready(); await opening;
  assert.equal(get('conversation-pane').hidden, false, 'the late library open must not cover the new conversation');
  assert.equal(get('conversation-pane').following.hidden, true);
  assert.equal(focus, 0, 'the late read must not reclaim keyboard focus');
});

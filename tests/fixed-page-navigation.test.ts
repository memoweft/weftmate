import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('#622 new conversation cancels a library open that is still entering the assistant', async () => {
  let ready!: () => void;
  const entering = new Promise<void>(resolve => { ready = resolve; });
  const nodes = new Map<string, any>();
  const node = (tag = '', className = ''): any => ({ tag, className, dataset: {}, hidden: true, append() {}, after() {},
    setAttribute() {}, querySelector: () => ({ textContent: '' }) });
  const get = (id: string) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const listeners = new Map<string, any>();
  const document = { body: { classList: { add() {}, remove() {} } }, addEventListener: (name: string, fn: any) => listeners.set(name, fn) };
  const core: any = { state: { personalCapabilities: { library: 1 } }, enterAssistant: () => entering,
    selectSession() {}, selectMainChat() {}, readLibrary: async () => {}, resetLibrary() {} };
  const ui: any = { byId: get, element: node, fixedPageNavigation: () => node(), closeRail() {},
    paintSelectedSession() {}, resetIdentityControls() {}, updateAvailability() {}, renderTimeline() {} };
  const global: any = { WeftUiComponents: { factories: {} }, document, WeftIcons: { create: () => node() },
    WeftLibraryView: { mount: () => ({ focus() {}, deactivate() {} }) } };
  runInNewContext(readFileSync(new URL('../src/personal-access-ui/components/library.js', import.meta.url), 'utf8'), global);
  Object.assign(ui, global.WeftUiComponents.factories.library(core, ui)); ui.mountLibrary();
  const opening = ui.openLibrary();
  listeners.get('weftmate:fixed-page')({ detail: 'conversation' });
  ready(); await opening;
  assert.equal(get('conversation-pane').hidden, false, 'the late library open must not cover the new conversation');
});

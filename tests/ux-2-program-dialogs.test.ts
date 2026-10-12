import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

test('UI sources never call browser/system confirm, alert or prompt', () => {
  const violations: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (/vendor|node_modules|tests/.test(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { scan(path); continue; }
      if (!/\.(?:js|mjs|ts|html)$/.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      const scripts = path.endsWith('.html') ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]) : [source];
      for (const script of scripts) {
        const tree = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        function visit(node: ts.Node) {
          if (ts.isCallExpression(node)) {
            const call = node.expression;
            const native = ts.isIdentifier(call) && ['alert','prompt'].includes(call.text)
              || ts.isPropertyAccessExpression(call) && ['window','globalThis','self'].includes(call.expression.getText(tree)) && ['alert','confirm','prompt'].includes(call.name.text);
            if (native) violations.push(`${path}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`);
          }
          ts.forEachChild(node, visit);
        }
        visit(tree);
      }
    }
  }
  for (const path of ['src/personal-access-ui','src/ui-core','src/plugins/weftmate-client','src/web','apps/mobile-ui/www']) scan(path);
  assert.deepEqual(violations, []);
  const main = readFileSync('src/main.mjs','utf8');
  assert.doesNotMatch(main, /dialog\.showMessageBox\s*\(/);
  assert.equal((main.match(/dialog\.showErrorBox\s*\(/g) || []).length, 1, 'only fatal startup fallback remains');
});

test('async approval confirmation waits, cancellation preserves mode and switching account/session cancels the pending change', async () => {
  const realm: any = { WeftUiCore: { factories: {} } }; vm.createContext(realm);
  vm.runInContext(readFileSync('src/ui-core/approvals.js','utf8'), realm);
  let answer: (v: boolean) => void = () => {}; let writes = 0;
  const state = { selectedSessionId: 'synthetic-session', identityGeneration: 1, activeChatSource: 'desktop', approvalModeLoading: false };
  const effects = new Proxy({ acceptApprovalRisk: () => new Promise<boolean>(resolve => { answer = resolve; }) }, { get: (target, key) => target[key as keyof typeof target] || (() => {}) });
  const core = { state, accessApi: async () => { writes++; return { mode:'allow-all' }; } };
  const api = realm.WeftUiCore.factories.approvals(core, effects);
  const cancel = api.saveApprovalMode('allow-all'); assert.equal(writes, 0); answer(false); await cancel; assert.equal(writes, 0);
  const stale = api.saveApprovalMode('allow-all'); state.identityGeneration++; answer(true); await stale; assert.equal(writes, 0);
  const switched = api.saveApprovalMode('allow-all'); state.selectedSessionId = 'other-session'; answer(true); await switched; assert.equal(writes, 0);
  const accept = api.saveApprovalMode('allow-all'); assert.equal(writes, 0); answer(true); await accept; assert.equal(writes, 1);
});

test('desktop preload retains notices received before the UI listener is ready', () => {
  for (const path of ['src/personal-desktop-preload.cjs','src/dsh-surface-preload.cjs']) {
    const listeners = new Map<string, Function>(); let bridge: any;
    const electron = { contextBridge: { exposeInMainWorld: (_name: string, api: any) => { bridge = api; } }, ipcRenderer: { on: (name: string, listener: Function) => listeners.set(name, listener) }, webUtils:{} };
    vm.runInNewContext(readFileSync(path,'utf8'), { require:() => electron, process:{ platform:'win32' } });
    const received: any[] = [];
    listeners.get('wm:ui:notice')!(null, { id:'early', title:'合成提示', message:'请稍后重试。' });
    const unsubscribe = bridge.onNotice((notice: any) => received.push(notice));
    assert.equal(received[0].id,'early');
    listeners.get('wm:ui:notice')!(null, { id:'ready' }); assert.equal(received[1].id,'ready');
    unsubscribe(); listeners.get('wm:ui:notice')!(null, { id:'between-listeners' });
    bridge.onNotice((notice: any) => received.push(notice)); assert.equal(received[2].id,'between-listeners');
  }
});

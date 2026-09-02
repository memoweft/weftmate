import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const preload = readFileSync(new URL('../src/dsh-surface-preload.cjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('阶段 1 的 DSH 产品面收敛', () => {
  it('将首开、会话、工具、审批和 Models 都交给同一个官方 DSH runtime，而不是加载旧聊天页', () => {
    assert.match(main, /let origin = await ensureSharedRuntime\(\{ reload: true \}\)/);
    assert.match(main, /await navigateToRuntimeSurface\(origin\)/);
    assert.match(main, /sessionReferenceScan = \{ state: 'ready', error: null \};/);
    assert.doesNotMatch(main, /await win\.loadURL\(legacyRendererUrl\)/);
    assert.match(main, /preload: join\(import\.meta\.dirname, 'dsh-surface-preload\.cjs'\)/);
  });

  it('官方页面只得到调和原生标题栏所需的 theme bridge，不能调用旧模型或对话 IPC', () => {
    assert.match(preload, /contextBridge\.exposeInMainWorld\('weftmateSurface'/);
    assert.match(preload, /wm:dsh-surface:theme/);
    for (const forbidden of ['wm:stage1:', 'wm:stage2:', 'ipcRenderer.on', 'runtimeOrigin', 'apiKey', "require('node:"]) {
      assert.doesNotMatch(preload, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(main, /dshSurfaceTrusted\(event\)/);
  });

  it('WeftMate 仅保留一个非交互式原生壳：冻结的 44px 拖拽区、产品字标和官方页面主题同步', () => {
    assert.match(client, /height: 44px/);
    assert.match(client, /-webkit-app-region: drag/);
    assert.match(client, /dragRegion\.innerHTML = '<span class="weftmate-mark">W<\/span><span class="weftmate-wordmark">WeftMate<\/span>/);
    assert.match(client, /background: var\(--dsw-alias-bg-base, Canvas\)/);
    assert.match(client, /getComputedStyle\(dragRegion\)\.backgroundColor/);
    assert.match(client, /attributeFilter: \['data-ds-dark-theme', 'style'\]/);
    assert.match(main, /page-title-updated/);
    assert.match(main, /win\.setTitle\('WeftMate'\)/);
  });
});

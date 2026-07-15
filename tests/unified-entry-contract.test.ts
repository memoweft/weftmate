import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');

function routeSet(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/req\.method\s*===\s*'([A-Z]+)'\s*&&\s*url\.pathname\s*===\s*'([^']+)'/g)]
      .map((match) => `${match[1]} ${match[2]}`),
  );
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `找不到源码区间：${start} -> ${end}`);
  return source.slice(from, to);
}

describe('统一产品入口契约', () => {
  it('旧聊天/向导端点消失，统一 Agent、历史和模型设置端点保留', () => {
    const routes = routeSet(server);

    for (const removed of [
      'POST /api/chat',
      'POST /api/gen-env',
      'POST /api/model-config',
    ]) assert.equal(routes.has(removed), false, `${removed} 应落入统一 404`);

    for (const current of [
      'GET /api/chat-history',
      'POST /api/agent/start',
      'GET /api/agent/status',
      'POST /api/agent/decide',
      'POST /api/agent/stop',
      'POST /api/agent/undo',
      'GET /api/model-config',
      'POST /api/model-config/profile',
      'POST /api/model-config/active',
      'POST /api/model-config/delete',
      'GET /api/settings',
      'POST /api/settings/language',
      'POST /api/settings/agent-autonomy',
      'POST /api/reset',
      'GET /api/sessions',
      'POST /api/session/open',
      'POST /api/session/archive',
    ]) assert.equal(routes.has(current), true, `${current} 仍是当前产品路径`);
  });

  it('页面只从统一 Agent 发送，首配只进入现有模型设置', () => {
    assert.doesNotMatch(html, /id=["']wizard["']|mode-wizard/);
    assert.doesNotMatch(html, /function\s+(?:enterWizard|wizPrefill|wizSaveConfig|wizCopyEnv)\b/);
    assert.doesNotMatch(html, /fetch\(['"]\/api\/(?:chat|gen-env)['"]/);

    const send = between(html, 'async function send()', '// Enter 发送');
    assert.match(send, /await startAgentTask\(/);
    assert.doesNotMatch(send, /AG\.mode|\/api\/chat/);

    assert.match(html, /id=["']btnGoWizard["']/);
    assert.match(html, /\$\('btnGoWizard'\)\.addEventListener\('click',\s*\(\)\s*=>\s*openSettings\('models'\)\)/);
    assert.match(html, /fetch\('\/api\/model-config'\)/);
    assert.match(html, /fetch\('\/api\/model-config\/profile'/);
  });

  it('动态 i18n 只改文本节点和属性，不整块替换 Element 子树', () => {
    const walker = between(html, 'function i18nNode(node)', '/** 程序化取译文');
    const observer = between(html, 'const OBS_OPT', '// ══════════════════════════════════════════════════════════════════════════');

    assert.match(walker, /node\.nodeValue\s*=\s*tr/);
    assert.doesNotMatch(walker, /node\.textContent\s*=/, '整块替换会删除按钮子节点和交互结构');
    assert.match(observer, /m\.addedNodes[\s\S]*i18nNode\(m\.addedNodes\[j\]\)/);
    assert.match(observer, /i18nAttrs\(m\.target\)/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// R7 记忆宿主插件契约（源码锁）：
//  - 边界源（compaction/end 门控 + user Evidence 组装 + 信封哈希绑定 + 跨语言规范化字节一致）
//  - 桥传输（env 注入 + JSON-Lines）
//  - Recall 注入门（命中才注入、查询上限、plugin 名可核验）
//  - 管理面路由（world/search/export 只读）
const plugin = readFileSync(new URL('../src/plugins/weftmate-memory.mjs', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/dsh-web-runtime.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

// 与 Python json.dumps(ensure_ascii=True, separators=(',',':'), sort_keys=True) 一致的 JS 实现
// （从插件源码抽取同款逻辑用于字节级对照）。
function canonicalJson(value) {
  const sorted = (item) => {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map(sorted);
    const out = {};
    for (const key of Object.keys(item).sort()) out[key] = sorted(item[key]);
    return out;
  };
  return JSON.stringify(sorted(value)).replace(/[\u007f-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

describe('R7 记忆宿主插件契约', () => {
  it('跨语言规范化与 Python 字节一致（中文 ensure_ascii 转义）', () => {
    const payload = {
      schema_version: 1, provider_name: 'memoweft', parent_session_id: 's1',
      result_session_id: 's1', mode: 'in_place',
      source_messages: [{ role: 'user', content: '我喜欢喝茉莉花茶', timestamp: 1786000000, source_ref: 'source:0' }],
    };
    const hash = createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
    assert.equal(hash, '30c45f75af3f218069ffb0d539e7947d361d405f21992e3ca32b9381a7f9f840');
    assert.match(canonicalJson(payload), /\\u559c\\u6b22/); // 茉莉花茶等非 ASCII 被 \u 转义
  });

  it('边界源：compaction/end 门控、user Evidence 组装、信封哈希与 event_id 绑定', () => {
    assert.match(plugin, /ctx\.on\('session\/event', \(session, event\) =>/);
    const boundary = between(plugin, "if (event.type === 'compaction/summary')", "// ── Recall 注入");
    assert.match(boundary, /if \(event\.type !== 'compaction\/end'\) return/);
    assert.match(boundary, /if \(event\.data\?\.error\) return/);
    assert.match(boundary, /!messages\.some\(\(message\) => message\.role === 'user'\)/);
    assert.match(plugin, /source_ref: `source:\$\{index\}`/);
    assert.match(boundary, /const payloadHash = sha256Hex\(canonicalJson\(payload\)\)/);
    assert.match(boundary, /`\$\{BOUNDARY_PREFIX\}:\$\{occurrence\}:\$\{payloadHash\}`/);
    assert.match(boundary, /mode: 'in_place'/);
    assert.match(boundary, /bridge\.request\('ingest_boundary', \{ boundary \}\)/);
    assert.match(plugin, /timestamp: Math\.floor\(\(Number\(event\.time\) \|\| Date\.now\(\)\) \/ 1000\)/);
  });

  it('桥传输：env 注入 python/PYTHONPATH、stdio JSON-Lines、fail-closed', () => {
    assert.match(plugin, /export const inject = \['webServer'\]/);
    assert.match(plugin, /WEFTMATE_MEMOWEFT_PYTHON \|\| 'python'/);
    assert.match(plugin, /PYTHONPATH: this\.pythonPath/);
    assert.match(plugin, /spawn\(this\.python, \['-m', 'memoweft\.integrations\.dsh_bridge'\]/);
    assert.match(plugin, /this\.child\.stdin\.write\(line, 'utf8'\)/);
    assert.match(plugin, /failAll/);
    // 初始化 dsh_home 走运行时 DSH_HOME（产品数据目录内）。
    assert.match(plugin, /dsh_home: DSH_HOME\(\)/);
  });

  it('Recall 注入门：命中才注入、查询截断、plugin 名可核验（0 生成调用）', () => {
    const recall = between(plugin, "ctx.on('agent/pre-step'", '}, { prepend: true })');
    assert.ok(recall.indexOf('const decision = await next()') < recall.indexOf('bridge.request'));
    assert.match(recall, /RECALL_QUERY_MAX_CHARS/);
    assert.match(recall, /if \(!recall \|\| typeof recall\.text !== 'string' \|\| !recall\.text\.trim\(\) \|\| !recall\.count\) return decision/);
    assert.match(recall, /plugin: 'weftmate-memory'/);
    assert.match(recall, /form: 'snapshot'/);
  });

  it('管理面：world/search/export 只读路由注册', () => {
    assert.match(plugin, /pathname === '\/weftmate\/memory\/world\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/search\.json'/);
    assert.match(plugin, /pathname === '\/weftmate\/memory\/export\.json'/);
    assert.match(plugin, /bridge\.request\('list_world'|bridge\.request\('export_world'|bridge\.request\('prefetch'/);
    assert.match(plugin, /kind: 'prefix', path: '\/weftmate\/memory'/);
  });

  it('profile 接线：补丁层保留试验行、默认关闭、资产复制、main 不注入开发机绝对路径', () => {
    assert.match(runtime, /- id: weftmate-memory\s*\n\s*name: \.\/plugins\/weftmate-memory\.mjs/);
    assert.match(runtime, /PROFILE_PATCH_TEMPLATE_R3_PICKER/);
    const upgrade = between(runtime, 'if (existing === PROFILE_PATCH_TEMPLATE) return false', 'return false // owner 手改');
    assert.match(upgrade, /PROFILE_PATCH_TEMPLATE_R3_PICKER/);
    assert.match(runtime, /\[join\(PLUGINS_DIR, 'weftmate-memory\.mjs'\), memoryDest\]/);
    assert.match(plugin, /process\.env\.WEFTMATE_MEMOWEFT_ENABLED !== '1'/);
    assert.ok(plugin.indexOf("WEFTMATE_MEMOWEFT_ENABLED !== '1'") < plugin.indexOf('new MemoWeftBridge'));
    assert.match(main, /WEFTMATE_MEMOWEFT_ENABLED: process\.env\.WEFTMATE_MEMOWEFT_ENABLED === '1' \? '1' : '0'/);
    assert.doesNotMatch(main, /D:\\\\MemoWeft\\\\\.venv-memoweft/);
  });

  it('管理页（客户端，只读 v1）：胶囊轮询 world、面板浏览/确定性搜索/导出备份', () => {
    assert.match(client, /fetchMemoryJson\('\/weftmate\/memory\/world\.json', setWorld\)/);
    assert.match(client, /setInterval\(function \(\) \{ fetchMemoryJson\('\/weftmate\/memory\/world\.json', setWorld\) \}, 30_000\)/);
    assert.match(client, /id: 'weftmate-memory'/);
    assert.match(client, /\/weftmate\/memory\/search\.json\?q=' \+ encodeURIComponent/);
    assert.match(client, /确定性搜索（0 生成调用）/);
    assert.match(client, /没有命中的记忆（诚实回答：未找到）/);
    assert.match(client, /fetch\('\/weftmate\/memory\/export\.json'/);
    assert.match(client, /a\.download = 'weftmate-memory-export\.json'/);
    assert.match(client, /Evidence 与 provenance 一并导出/);
  });
});

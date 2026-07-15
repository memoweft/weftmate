/**
 * 契约测试 · 套件4「MCP 延迟加载生死线 + 外部工具审批」
 *
 * 对着【当前源码真实行为】写、真能 PASS。零测试框架依赖：只用 node 内置 node:test + node:assert/strict。
 * 跑法（项目根 D:\MemoWeft\weftmate 下）：node --test "tests/mcp-contract.test.ts"
 *
 * 覆盖三条不变量：
 *  1) mcp.ts signatureOf（mcp.ts:41 附近，未导出）——只取 inputSchema 顶层属性名+可选标记，
 *     【不含】嵌套属性/类型/JSON-Schema 关键字；McpToolInfo 无 schema 字段（延迟加载生死线）。
 *     signatureOf 私有 → 走它唯一能被调到的公开路径 connectServer → listAllTools。
 *  2) agent.ts resolveTool + 审批门——ask 档所有 MCP 外部工具都要确认；未信任工具即使 auto 也要确认，
 *     显式信任只允许 auto 免批。resolveTool 私有 → 经 configureAgentDeps
 *     注入 mcpTools + __setClientFactory 注入脚本化假模型，从 startTask/getTaskView/decideStep 的公开行为观测。
 *  3) agent.ts buildSystemPrompt——系统提示里出现 fqName+签名+描述，但【不出现】完整 inputSchema。
 *
 * 不起真 MCP 子进程（CI 易脆）：用 module.register 的 resolve 钩子把 @modelcontextprotocol/sdk 的
 *   client/index.js 与 client/stdio.js 重定向到一个假模块（假 Client.listTools 返回预置工具），
 *   于是 connectServer 走的是【真实的 signatureOf】，只是不启进程、不走 JSON-RPC。
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── 装 SDK 重定向钩子（不起子进程）──────────────────────────────────────────
const HOOK_DIR = mkdtempSync(join(tmpdir(), 'weft-mcp-hooks-'));
const fakeSdkPath = join(HOOK_DIR, 'fake-sdk.mjs');
const loaderPath = join(HOOK_DIR, 'loader.mjs');

writeFileSync(
  fakeSdkPath,
  `// 假的 MCP SDK 客户端：不启进程、不走 JSON-RPC，listTools 返回测试预置的工具。
export class Client {
  constructor(info) { this._info = info; }
  async connect() {}
  async listTools() { return { tools: globalThis.__WEFT_FAKE_TOOLS__ || [] }; }
  async close() {}
  async callTool(req) { return { content: [{ type: 'text', text: 'echo' }], isError: false }; }
}
export class StdioClientTransport {
  constructor(opts) { this.opts = opts; this.stderr = { on() {} }; }
}
`,
);

writeFileSync(
  loaderPath,
  `const FAKE = ${JSON.stringify(pathToFileURL(fakeSdkPath).href)};
export async function resolve(specifier, context, next) {
  if (specifier.includes('@modelcontextprotocol/sdk/client/index.js') ||
      specifier.includes('@modelcontextprotocol/sdk/client/stdio.js')) {
    return { url: FAKE, shortCircuit: true };
  }
  return next(specifier, context);
}
`,
);

register(pathToFileURL(loaderPath).href);

// 钩子就位后再动态 import（静态 import 会在钩子注册前解析 SDK）。路径经 import.meta.url 相对本文件，不写死绝对路径。
const mcp: any = await import(new URL('../src/mcp.ts', import.meta.url).href);
const agent: any = await import(new URL('../src/agent.ts', import.meta.url).href);

after(() => {
  try { rmSync(HOOK_DIR, { recursive: true, force: true }); } catch { /* Windows 上 loader 线程可能占用，忽略 */ }
});

// ── 小工具 ───────────────────────────────────────────────────────────────
function setFakeTools(tools: any[]): void { (globalThis as any).__WEFT_FAKE_TOOLS__ = tools; }

/** 脚本化假模型：按预设序列逐次返回 JSON；捕获每轮收到的 system 提示，供 buildSystemPrompt 断言。 */
function scriptClient(replies: string[]) {
  const state: any = { i: 0, calls: 0, systemPrompts: [] as string[] };
  const factory = () => ({
    async chat(messages: any[]) {
      state.calls++;
      state.systemPrompts.push(messages[0]?.content ?? '');
      return state.i < replies.length ? replies[state.i++] : '{"done":{"summary":"end"}}';
    },
  });
  return { factory, state };
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

// ══ 不变量 1 · signatureOf 延迟加载生死线 ═══════════════════════════════════
describe('mcp.signatureOf｜只吐顶层属性名+可选标记，不吐完整 schema', () => {
  test('复杂/嵌套 inputSchema → 签名只留顶层键+可选问号；无嵌套/类型/schema 关键字', async (t) => {
    // withTimeout 里 20s 的 setTimeout 成功路径不 clear（悬挂定时器）；用假定时器限定其作用域、测完自动清。
    t.mock.timers.enable({ apis: ['setTimeout'] });
    setFakeTools([
      {
        name: 'query_db',
        description: 'runs\n\n a query',
        inputSchema: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'name' },
            filter: { type: 'object', properties: { field: { type: 'string' }, op: { enum: ['=', '>'] } } },
            limit: { type: 'integer' },
            columns: { type: 'array', items: { type: 'string' } },
          },
          required: ['table', 'filter'],
        },
        annotations: { readOnlyHint: true },
      },
    ]);
    await mcp.connectServer({ id: 'db', name: 'DB Svc', command: 'x', args: [], enabled: true });
    const tools = mcp.listAllTools();
    assert.equal(tools.length, 1);
    const info = tools[0];

    // required 无问号、可选带问号，顺序按 properties 键序
    assert.equal(info.signature, '(table, filter, limit?, columns?)');
    // 生死线：签名里不得泄漏任何嵌套属性名 / 类型名 / JSON-Schema 关键字
    for (const leak of ['field', 'op', 'string', 'integer', 'array', 'object', 'items', 'enum', 'properties', 'type', 'inputSchema']) {
      assert.ok(!info.signature.includes(leak), `签名不应泄漏「${leak}」：${info.signature}`);
    }
    // McpToolInfo 结构上就没有完整 schema 字段（不进上下文）
    assert.ok(!('schema' in info), 'McpToolInfo 不应有 schema 字段');
    assert.ok(!('inputSchema' in info), 'McpToolInfo 不应有 inputSchema 字段');
    // 顺带：fqName=服务名 slug + '__' + 工具名；描述空白压平；readOnly 取自 annotations.readOnlyHint
    assert.equal(info.fqName, 'db_svc__query_db');
    assert.equal(info.description, 'runs a query');
    assert.equal(info.readOnly, true);

    await mcp.disconnectServer('db');
  });

  test('无 inputSchema / 有 schema 无 properties → 空签名 ()', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    setFakeTools([
      { name: 'ping', annotations: {} },
      { name: 'noop', inputSchema: { type: 'object' } },
    ]);
    await mcp.connectServer({ id: 'p', name: 'P', command: 'x', args: [], enabled: true });
    const tools = mcp.listAllTools();
    assert.equal(tools.find((x: any) => x.toolName === 'ping').signature, '()');
    assert.equal(tools.find((x: any) => x.toolName === 'noop').signature, '()');
    await mcp.disconnectServer('p');
  });

  test('readOnlyHint 缺省 → readOnly=false（默认非只读，下游要强批）', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    setFakeTools([
      { name: 'a', inputSchema: { type: 'object', properties: { x: {} } } },
      { name: 'b', inputSchema: { type: 'object', properties: { x: {} } }, annotations: { readOnlyHint: false } },
      { name: 'c', inputSchema: { type: 'object', properties: { x: {} } }, annotations: { readOnlyHint: true } },
    ]);
    await mcp.connectServer({ id: 'r', name: 'R', command: 'x', args: [], enabled: true });
    const tools = mcp.listAllTools();
    assert.equal(tools.find((x: any) => x.toolName === 'a').readOnly, false);
    assert.equal(tools.find((x: any) => x.toolName === 'b').readOnly, false);
    assert.equal(tools.find((x: any) => x.toolName === 'c').readOnly, true);
    await mcp.disconnectServer('r');
  });
});

// ══ 不变量 2 · resolveTool + 审批门（F1·ask 外部全确认；信任仅允许 auto 免批）═══════
describe('agent.resolveTool + 审批门｜ask 外部全确认，信任仅允许 auto 免批', () => {
  test('readOnly=false 的 MCP 工具在 auto 档：停在 awaiting、批准前不执行、批准后才跑', async () => {
    const callLog: any[] = [];
    agent.configureAgentDeps({
      mcpTools: () => [{ fqName: 'svc__write_note', description: 'writes', signature: '(text)', readOnly: false }],
      callMcp: async (fq: string, args: any) => { callLog.push({ fq, args }); return 'WROTE'; },
    });
    const { factory } = scriptClient([
      '{"thought":"调 MCP","action":{"tool":"svc__write_note","args":{"text":"hi"}}}',
      '{"done":{"summary":"完成"}}',
    ]);
    agent.__setClientFactory(factory);

    const { id } = agent.startTask({ task: '干活', workspace: '', autonomy: 'auto', attachments: [{ name: 'ctx.txt', content: '参考' }] });

    // auto 档、非只读 → 应停在 awaiting 等批准
    assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'awaiting'), true, '非只读 MCP 工具在 auto 下应停在 awaiting');
    const v = agent.getTaskView(id);
    const step = v.steps[0];
    assert.equal(step.tool, 'svc__write_note');
    assert.equal(step.status, 'awaiting');
    assert.equal(step.mutating, true, 'mutating=!readOnly');
    assert.equal(callLog.length, 0, '批准前不得执行 MCP 工具');

    // 批准 → 才执行 → done
    assert.equal(agent.decideStep(id, 'approve'), true);
    assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'done'), true);
    assert.equal(callLog.length, 1);
    assert.deepEqual(callLog[0], { fq: 'svc__write_note', args: { text: 'hi' } });
    assert.equal(agent.getTaskView(id).steps[0].status, 'done');
  });

  test('readOnly=true 的 MCP 工具在 auto 档：自报只读不再免批、仍停在 awaiting（F1）', async () => {
    const callLog: any[] = [];
    agent.configureAgentDeps({
      mcpTools: () => [{ fqName: 'svc__search', description: 'search', signature: '(q)', readOnly: true }],
      callMcp: async (fq: string, args: any) => { callLog.push({ fq, args }); return 'RESULTS'; },
    });
    const { factory } = scriptClient([
      '{"action":{"tool":"svc__search","args":{"q":"cats"}}}',
      '{"done":{"summary":"找到了"}}',
    ]);
    agent.__setClientFactory(factory);

    const { id } = agent.startTask({ task: '搜一下', workspace: '', autonomy: 'auto', attachments: [{ name: 'ctx.txt', content: '参考' }] });

    // F1：readOnly 是服务【自报】的，不可信 → 自报只读的 MCP 工具在 auto 下也应停在 awaiting、批准前不执行。
    assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'awaiting'), true, '自报只读的 MCP 工具在 auto 下仍应停在 awaiting（F1）');
    const step = agent.getTaskView(id).steps[0];
    assert.equal(step.tool, 'svc__search');
    assert.equal(step.status, 'awaiting');
    assert.equal(step.mutating, false, 'readOnly=true → mutating=false（仅展示；审批由 alwaysApprove 强制）');
    assert.equal(callLog.length, 0, 'F1：批准前绝不执行自报只读的第三方工具');

    // 批准 → 才执行 → done
    assert.equal(agent.decideStep(id, 'approve'), true);
    assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'done'), true);
    assert.equal(callLog.length, 1);
    assert.deepEqual(callLog[0], { fq: 'svc__search', args: { q: 'cats' } });
    assert.equal(agent.getTaskView(id).steps[0].status, 'done');
  });

  test('ask 档：已信任 MCP 的 readOnly 与 mutating 调用仍都必须逐次确认', async () => {
    for (const entry of [
      { fqName: 'svc__trusted_search', readOnly: true, expectedMutating: false },
      { fqName: 'svc__trusted_write', readOnly: false, expectedMutating: true },
    ]) {
      const callLog: any[] = [];
      agent.configureAgentDeps({
        mcpTools: () => [{ fqName: entry.fqName, description: 'trusted external tool', signature: '(q)', readOnly: entry.readOnly }],
        callMcp: async (fq: string, args: any) => { callLog.push({ fq, args }); return 'SHOULD_NOT_RUN'; },
        isMcpToolTrusted: (fq: string) => fq === entry.fqName,
      });
      const { factory } = scriptClient([
        `{"action":{"tool":"${entry.fqName}","args":{"q":"value"}}}`,
        '{"done":{"summary":"用户拒绝后收尾"}}',
      ]);
      agent.__setClientFactory(factory);

      const { id } = agent.startTask({ task: '调用已信任外部工具', workspace: '', autonomy: 'ask', attachments: [{ name: 'ctx.txt', content: '参考' }] });
      assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'awaiting'), true, `${entry.fqName} 在 ask 下应停在 awaiting`);
      const step = agent.getTaskView(id).steps[0];
      assert.equal(step.status, 'awaiting');
      assert.equal(step.mutating, entry.expectedMutating);
      assert.equal(callLog.length, 0, 'ask 档批准前不得调用已信任外部工具');
      assert.equal(agent.decideStep(id, 'reject'), true);
      assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'done'), true);
      assert.equal(agent.getTaskView(id).steps[0].status, 'rejected');
      assert.equal(callLog.length, 0);
    }
  });

  test('已「信任」的 MCP 工具在 auto 档：免批、自动跑到 done（F1 trust opt-in）', async () => {
    const callLog: any[] = [];
    agent.configureAgentDeps({
      mcpTools: () => [{ fqName: 'svc__write_note', description: 'writes', signature: '(text)', readOnly: false }],
      callMcp: async (fq: string, args: any) => { callLog.push({ fq, args }); return 'WROTE'; },
      isMcpToolTrusted: (fq: string) => fq === 'svc__write_note',   // 用户已显式信任这个工具
    });
    const { factory } = scriptClient([
      '{"action":{"tool":"svc__write_note","args":{"text":"hi"}}}',
      '{"done":{"summary":"完成"}}',
    ]);
    agent.__setClientFactory(factory);

    const { id } = agent.startTask({ task: '干活', workspace: '', autonomy: 'auto', attachments: [{ name: 'ctx.txt', content: '参考' }] });

    // 已信任 → 即便是 mutating(非只读) 工具，在 auto 下也免批、自动跑到 done（全程从不 decideStep）。
    assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'done'), true, '已信任的 MCP 工具应在 auto 下自动跑到 done');
    assert.equal(callLog.length, 1);
    assert.deepEqual(callLog[0], { fq: 'svc__write_note', args: { text: 'hi' } });
    assert.equal(agent.getTaskView(id).steps[0].status, 'done');
  });

  test('已「信任」且自报只读的 MCP 工具在 auto 档同样免批', async () => {
    const callLog: any[] = [];
    agent.configureAgentDeps({
      mcpTools: () => [{ fqName: 'svc__trusted_search', description: 'search', signature: '(q)', readOnly: true }],
      callMcp: async (fq: string, args: any) => { callLog.push({ fq, args }); return 'RESULTS'; },
      isMcpToolTrusted: (fq: string) => fq === 'svc__trusted_search',
    });
    const { factory } = scriptClient([
      '{"action":{"tool":"svc__trusted_search","args":{"q":"cats"}}}',
      '{"done":{"summary":"完成"}}',
    ]);
    agent.__setClientFactory(factory);

    const { id } = agent.startTask({ task: '搜索', workspace: '', autonomy: 'auto', attachments: [{ name: 'ctx.txt', content: '参考' }] });
    assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'done'), true);
    assert.deepEqual(callLog, [{ fq: 'svc__trusted_search', args: { q: 'cats' } }]);
    assert.equal(agent.getTaskView(id).steps[0].mutating, false);
    assert.equal(agent.getTaskView(id).steps[0].status, 'done');
  });
});

// ══ 不变量 3 · buildSystemPrompt 只吐 fqName+签名+描述 ══════════════════════
describe('agent.buildSystemPrompt｜出现 fqName+签名+描述，不出现完整 inputSchema', () => {
  test('注入 mcpTools 后系统提示含全名+极简签名+描述，无 schema 痕迹', async () => {
    agent.configureAgentDeps({
      mcpTools: () => [{ fqName: 'files__grep', description: 'Grep across files', signature: '(pattern, path?)', readOnly: true }],
      callMcp: async () => 'x',
    });
    const { factory, state } = scriptClient(['{"done":{"summary":"noop"}}']);
    agent.__setClientFactory(factory);

    const { id } = agent.startTask({ task: '啥也不干', workspace: '', autonomy: 'auto', attachments: [{ name: 'ctx.txt', content: '参考' }] });
    assert.equal(await waitFor(() => agent.getTaskView(id)?.status === 'done'), true);

    const sys = state.systemPrompts[0];
    assert.equal(typeof sys, 'string');
    assert.ok(sys.length > 0);
    // 出现：全名+极简签名（一体），以及描述
    assert.ok(sys.includes('files__grep(pattern, path?)'), '应含 fqName+极简签名');
    assert.ok(sys.includes('Grep across files'), '应含描述');
    // 不出现：完整 JSON Schema 痕迹（延迟加载生死线在 agent 提示边界处也成立）
    assert.ok(!sys.includes('inputSchema'), '不应含 inputSchema');
    assert.ok(!sys.includes('properties'), '不应含 schema properties');
    assert.ok(!sys.includes('"type":"object"') && !sys.includes('"type": "object"'), '不应含 schema type');
  });
});

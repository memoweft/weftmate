/**
 * WeftMate · MCP 客户端管理（阶段2·帮你干活②「MCP 一键装」·作者拍板用官方 SDK）。
 *
 * 用 @modelcontextprotocol/sdk 当【客户端】连 stdio 型 MCP 服务（启子进程、JSON-RPC 通信），
 *   列它们的工具、按需调用。工具接进①的 agent 循环（server 经 configureAgentDeps 注入 listAllTools/callTool）。
 *
 * 延迟加载（PRODUCT.md 生死线）：给模型的系统提示里【只放 name + 一句话 + 极简参数签名】，
 *   完整的 inputSchema（啰嗦的 JSON Schema）留在这里、不进上下文——工具一多才不会撑爆 token。
 *
 * 安全：MCP 服务跑的是第三方代码。非只读工具（无 readOnlyHint）在 agent 里【一律要用户批准】（见 agent.ts resolveTool）。
 *   env 合并由 SDK 处理（getDefaultEnvironment 补 PATH 等，再叠用户 env）；Windows 上 spawn shell:false，
 *   故 npx 类要配成 command:'cmd' args:['/c','npx',...]（预置清单已按此，见 server.ts /api/mcp/catalog）。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServer } from './mcp-store.ts';

const CONNECT_TIMEOUT_MS = 20_000; // 连接 + 列工具的总超时（挡坏包/不响应的服务把启动挂死）

export interface McpToolInfo {
  fqName: string;      // 暴露给 agent 的唯一名（服务名 slug + '__' + 工具名，防跨服务重名）
  serverId: string;
  serverName: string;
  toolName: string;    // MCP 服务里的原始工具名（callTool 时用）
  description: string;
  signature: string;   // 极简参数签名 (a, b?, …)——不是完整 schema（延迟加载）
  readOnly: boolean;   // annotations.readOnlyHint：只读工具 agent 里免批准
}

interface Conn {
  server: McpServer;
  client?: Client;
  tools: McpToolInfo[];
  status: 'connecting' | 'ready' | 'error';
  error?: string;
}

const conns = new Map<string, Conn>();

/** 极简参数签名：从 inputSchema 取顶层属性名 + required，拼成 (a, b?, c?)。完整 schema 不外泄给模型。 */
function signatureOf(schema: unknown): string {
  const s = schema as { properties?: Record<string, unknown>; required?: unknown } | null;
  const props = s && typeof s === 'object' ? s.properties : null;
  if (!props || typeof props !== 'object') return '()';
  const required = new Set(Array.isArray(s?.required) ? (s!.required as string[]) : []);
  return '(' + Object.keys(props).map((k) => (required.has(k) ? k : k + '?')).join(', ') + ')';
}

function slug(name: string): string {
  return (name || 'mcp').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('连接超时')), ms))]);
}

/** 连一个 stdio MCP 服务：启子进程 → initialize 握手 → tools/list 缓存。失败记 error 不抛（单个坏不拖累其余）。 */
export async function connectServer(server: McpServer): Promise<void> {
  await disconnectServer(server.id); // 先断旧的（重连场景）
  const conn: Conn = { server, tools: [], status: 'connecting' };
  conns.set(server.id, conn);
  try {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args || [],
      env: server.env,          // SDK 会自动叠 getDefaultEnvironment()（补 PATH 等）
      stderr: 'ignore',
    });
    const client = new Client({ name: 'weftmate', version: '0.1.0' }, { capabilities: {} });
    await withTimeout((async () => {
      await client.connect(transport);
      const listed = await client.listTools();
      conn.client = client;
      conn.tools = (listed.tools || []).map((t) => ({
        fqName: slug(server.name) + '__' + t.name,
        serverId: server.id,
        serverName: server.name,
        toolName: t.name,
        description: (t.description || '').replace(/\s+/g, ' ').slice(0, 200),
        signature: signatureOf(t.inputSchema),
        readOnly: !!t.annotations?.readOnlyHint,
      }));
    })(), CONNECT_TIMEOUT_MS);
    conn.status = 'ready';
  } catch (e) {
    conn.status = 'error';
    conn.error = e instanceof Error ? e.message : String(e);
    try { await conn.client?.close(); } catch { /* 关不掉忽略 */ }
    conn.client = undefined;
  }
}

/** 断开并移除一个服务的连接（幂等）。 */
export async function disconnectServer(id: string): Promise<void> {
  const conn = conns.get(id);
  if (!conn) return;
  try { await conn.client?.close(); } catch { /* 关不掉忽略 */ }
  conns.delete(id);
}

/** 所有 ready 服务的工具（喂给 agent 循环；延迟加载=只带 name/desc/签名，无完整 schema）。 */
export function listAllTools(): McpToolInfo[] {
  const out: McpToolInfo[] = [];
  for (const c of conns.values()) if (c.status === 'ready') out.push(...c.tools);
  return out;
}

/** 调一个工具（fqName 路由到对应服务）。返回文本结果（拼 content 里的 text 段）。 */
export async function callTool(fqName: string, args: Record<string, unknown>): Promise<string> {
  let target: { client: Client; toolName: string } | null = null;
  for (const c of conns.values()) {
    if (c.status !== 'ready' || !c.client) continue;
    const t = c.tools.find((x) => x.fqName === fqName);
    if (t) { target = { client: c.client, toolName: t.toolName }; break; }
  }
  if (!target) throw new Error(`MCP 工具不存在或服务未连接：${fqName}`);
  const res = await target.client.callTool({ name: target.toolName, arguments: args || {} });
  const content = Array.isArray(res.content) ? res.content : [];
  const text = content.map((b) => (b && b.type === 'text' ? String(b.text) : `[${b?.type || '非文本'}内容]`)).join('\n');
  return (res.isError ? '[工具报错] ' : '') + (text || '（无输出）');
}

/** 连接状态（给前端能力管理面板）。 */
export function statusView(): Array<{ id: string; name: string; status: string; toolCount: number; error?: string; tools: string[] }> {
  return [...conns.values()].map((c) => ({
    id: c.server.id, name: c.server.name, status: c.status,
    toolCount: c.tools.length, error: c.error, tools: c.tools.map((t) => t.toolName),
  }));
}

/** 对账：并发连上所有 enabled 的、断开不在名单/已禁用的。启动时 + 配置变更后调。 */
export async function reconcile(servers: McpServer[]): Promise<void> {
  const enabled = servers.filter((s) => s.enabled);
  const wantIds = new Set(enabled.map((s) => s.id));
  await Promise.all([...conns.keys()].filter((id) => !wantIds.has(id)).map(disconnectServer));
  await Promise.all(enabled.filter((s) => !conns.has(s.id)).map(connectServer)); // connectServer 自吞错，Promise.all 不炸
}

/** 关掉所有连接（退出收尾）。 */
export async function shutdownAll(): Promise<void> {
  await Promise.all([...conns.keys()].map(disconnectServer));
}

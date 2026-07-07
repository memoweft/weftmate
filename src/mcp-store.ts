/**
 * WeftMate · MCP 服务配置存储（阶段2·帮你干活②「MCP 一键装」）。
 *
 * 存"装了哪些 MCP 工具包"的清单。整份走 Electron safeStorage 加密落盘——比照模型配置的隐私铁律
 *   （[[weftmate-config-apply]] / config-store.ts）：env 里常含第三方服务的密钥（如 GitHub token），
 *   所以【明文绝不落盘、绝不 log】；给渲染层的公开视图【剥掉 env 的值】（只留键名，标 hasEnv）。
 *
 * 与 config-store.ts 分开存两个文件：模型配置 weftmate-model.enc / MCP 配置 weftmate-mcp.enc，互不影响。
 */
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface McpServer {
  id: string;
  name: string;
  command: string;                 // 启动命令，如 'npx' / 'node' / 'uvx'
  args: string[];                  // 参数，如 ['-y','@modelcontextprotocol/server-filesystem','D:\\some\\dir']
  env?: Record<string, string>;    // 环境变量（可能含密钥）——加密落盘、公开视图剥值
  enabled: boolean;                // 是否启用（启用=启动连接、工具进 agent 循环）
}
interface Stored { servers: McpServer[] }

function cfgPath(): string { return join(app.getPath('userData'), 'weftmate-mcp.enc'); }

/** 解密整份配置（含 env 值）。仅本模块 + mcp.ts（连接时要真 env）用。文件不存在/无加密后端/解不开 → 空。 */
function read(): Stored {
  const p = cfgPath();
  if (!existsSync(p) || !safeStorage.isEncryptionAvailable()) return { servers: [] };
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(p)));
    return parsed && Array.isArray(parsed.servers) ? { servers: parsed.servers as McpServer[] } : { servers: [] };
  } catch { return { servers: [] }; }
}

/** 写盘：JSON → safeStorage 加密 → 落盘。无加密后端则拒绝并抛（绝不明文落盘）。不 log 任何字段。 */
function write(cfg: Stored): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('本机没有可用的加密后端，为保护密钥不明文落盘，暂时无法保存 MCP 配置');
  }
  writeFileSync(cfgPath(), safeStorage.encryptString(JSON.stringify(cfg)));
}

function genId(): string { return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

/** 全量服务（含 env 真值）——仅供 mcp.ts 连接用（要真密钥）。 */
export function listServers(): McpServer[] { return read().servers; }

/** 按 id 取单个（含 env 真值）——mcp.ts 连接单个时用。 */
export function getServer(id: string): McpServer | null { return read().servers.find((s) => s.id === id) ?? null; }

/** 给渲染层的【公开视图】：剥掉 env 的值，只留键名 + hasEnv（防密钥外泄到前端/日志）。 */
export function publicView(): {
  servers: Array<{ id: string; name: string; command: string; args: string[]; enabled: boolean; hasEnv: boolean; envKeys: string[] }>;
} {
  return {
    servers: read().servers.map((s) => ({
      id: s.id, name: s.name, command: s.command, args: s.args || [], enabled: s.enabled,
      hasEnv: !!(s.env && Object.keys(s.env).length),
      envKeys: s.env ? Object.keys(s.env) : [],
    })),
  };
}

/** 增/改一个服务。id 缺=新建（默认 enabled=true）；带 id=改（env 传空对象=清空；不传 env=沿用旧值，重配不必重输密钥）。返回 id。 */
export function upsertServer(input: {
  id?: string; name: string; command: string; args?: string[]; env?: Record<string, string> | null; enabled?: boolean;
}): string {
  const cfg = read();
  const idx = input.id ? cfg.servers.findIndex((s) => s.id === input.id) : -1;
  const prev = idx >= 0 ? cfg.servers[idx] : null;
  const srv: McpServer = {
    id: prev?.id ?? genId(),
    name: input.name || input.command || '未命名服务',
    command: input.command,
    args: Array.isArray(input.args) ? input.args : [],
    enabled: input.enabled ?? prev?.enabled ?? true,
  };
  // env：显式传对象=用它（含空对象=清空）；传 undefined/null=沿用旧的（重配不必重输密钥，比照模型 keepKey）。
  if (input.env !== undefined && input.env !== null) {
    if (Object.keys(input.env).length) srv.env = input.env;
  } else if (prev?.env) {
    srv.env = prev.env;
  }
  if (idx >= 0) cfg.servers[idx] = srv; else cfg.servers.push(srv);
  write(cfg);
  return srv.id;
}

/** 删一个服务。 */
export function deleteServer(id: string): void {
  const cfg = read();
  cfg.servers = cfg.servers.filter((s) => s.id !== id);
  write(cfg);
}

/** 开/关一个服务（返回是否成功）。 */
export function setEnabled(id: string, enabled: boolean): boolean {
  const cfg = read();
  const s = cfg.servers.find((x) => x.id === id);
  if (!s) return false;
  s.enabled = enabled;
  write(cfg);
  return true;
}

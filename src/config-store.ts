/**
 * WeftMate 模型配置存储 —— 模型 key 走 Electron safeStorage 加密落盘(不明文·隐私红线)。
 *
 * 隐私铁律(守 AGENTS.md / PRODUCT.md 红线):
 *   - apiKey 只以 safeStorage 加密后的【密文】落盘(userData/weftmate-model.enc)。明文绝不写盘、绝不 console.log。
 *   - readPublicView() 是唯一回给渲染层的视图,【剥掉所有 apiKey】,只留 baseUrl/model + hasKey 布尔。
 *   - 收进来的 apiKey 只在函数栈内流过 → 加密 → 落盘,不进任何模块级变量/缓存/日志。
 *
 * 为什么放这:server.ts 跑在 Electron 主进程内(main.mjs import 进来),可直接用 safeStorage,不必 preload/IPC。
 *   把 Electron 耦合(safeStorage / app.relaunch)全收拢在【本模块 + main.mjs】,server.ts 只调本模块门面。
 *
 * 生效方式(见记忆 weftmate-config-apply):库在 createCore 构造时【一次性读死】env 里的 key。所以——
 *   ① main 启动时先 injectEnv() 把密文解密塞进 process.env,再 import server.ts 建 core(构造即读到 key);
 *   ② 改配置则 saveConfig() 落盘后 applyAndRelaunch() 重启进程,新 env 重新构造 core。
 */
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ModelGroup {
  baseUrl: string;
  apiKey: string;
  model: string;
}
export interface ModelConfig {
  llm?: ModelGroup;
  write?: ModelGroup & { tier?: 'local' | 'cloud' };
  embed?: ModelGroup;
}

function configPath(): string {
  return join(app.getPath('userData'), 'weftmate-model.enc');
}

/** 读并【解密】整份配置(含 key)。仅本模块内部用(injectEnv / saveConfig 合并 / 安全视图)。
 *  文件不存在、无加密后端、或密文解不开(文件损坏/换了机器)→ 一律返回 {},当作"没配",让用户重配、绝不崩。 */
function readConfig(): ModelConfig {
  const p = configPath();
  if (!existsSync(p) || !safeStorage.isEncryptionAvailable()) return {};
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(p)));
    return parsed && typeof parsed === 'object' ? (parsed as ModelConfig) : {};
  } catch {
    return {};
  }
}

/** 合并:incoming 里某组的 apiKey 为空但旧配置该组有 key → 沿用旧 key(重配时不必重输密钥,又不误清空)。
 *  incoming 里【没有的组】= 用户清掉了 → 不保留(丢弃旧的)。 */
function mergeKeepingKeys(prev: ModelConfig, incoming: ModelConfig): ModelConfig {
  const out: ModelConfig = {};
  for (const k of ['llm', 'write', 'embed'] as const) {
    const inc = incoming[k];
    if (!inc) continue; // 用户清掉了这组
    const merged = { ...inc };
    if (!merged.apiKey && prev[k]?.apiKey) merged.apiKey = prev[k]!.apiKey; // 空 key 沿用旧的
    out[k] = merged as never;
  }
  return out;
}

/** 存配置:与旧配置合并(空 key 沿用)→ JSON → safeStorage 加密 → 写盘。
 *  无加密后端则【拒绝保存并抛错】——绝不明文落盘。全程不 console.log 任何字段。 */
export function saveConfig(incoming: ModelConfig): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('本机没有可用的加密后端,为保护密钥不明文落盘,暂时无法保存模型配置');
  }
  const merged = mergeKeepingKeys(readConfig(), incoming);
  writeFileSync(configPath(), safeStorage.encryptString(JSON.stringify(merged)));
}

/** 给渲染层的【安全视图】:剥掉所有 apiKey,只留 baseUrl/model + hasKey(是否已设过密钥) + tier。
 *  configured = 对话模型三项齐全(前端据此决定是否还要拦在配置页)。 */
export function readPublicView(): {
  llm: { baseUrl: string; model: string; hasKey: boolean } | null;
  write: { baseUrl: string; model: string; hasKey: boolean; tier?: string } | null;
  embed: { baseUrl: string; model: string; hasKey: boolean } | null;
  configured: boolean;
} {
  const c = readConfig();
  const pub = (g?: ModelGroup & { tier?: string }) =>
    g ? { baseUrl: g.baseUrl || '', model: g.model || '', hasKey: !!g.apiKey, tier: g.tier } : null;
  return {
    llm: pub(c.llm),
    write: pub(c.write),
    embed: pub(c.embed),
    configured: !!(c.llm?.baseUrl && c.llm?.apiKey && c.llm?.model),
  };
}

/** 启动时把已存配置【解密塞进 process.env】(键名遵 Core env 口径),供 createCore 构造时读到。
 *  必须在 import server.ts(建 core)【之前】调。已存在的同名 env 不覆盖(尊重外部显式设置)。 */
export function injectEnv(): void {
  const c = readConfig();
  const set = (k: string, v?: string): void => {
    if (v && !process.env[k]) process.env[k] = v;
  };
  if (c.llm) {
    set('MEMOWEFT_LLM_BASE_URL', c.llm.baseUrl);
    set('MEMOWEFT_LLM_API_KEY', c.llm.apiKey);
    set('MEMOWEFT_LLM_MODEL', c.llm.model);
  }
  if (c.write) {
    set('MEMOWEFT_WRITE_LLM_BASE_URL', c.write.baseUrl);
    set('MEMOWEFT_WRITE_LLM_API_KEY', c.write.apiKey);
    set('MEMOWEFT_WRITE_LLM_MODEL', c.write.model);
    set('MEMOWEFT_WRITE_LLM_TIER', c.write.tier === 'local' ? 'local' : c.write.tier === 'cloud' ? 'cloud' : undefined);
  }
  if (c.embed) {
    set('MEMOWEFT_EMBED_BASE_URL', c.embed.baseUrl);
    set('MEMOWEFT_EMBED_API_KEY', c.embed.apiKey);
    set('MEMOWEFT_EMBED_MODEL', c.embed.model);
  }
}

/** 保存后自动重启应用让新配置生效(库构造时读死 key,只能重建进程;作者拍板"改配置自动重启")。 */
export function applyAndRelaunch(): void {
  app.relaunch();
  app.exit(0);
}

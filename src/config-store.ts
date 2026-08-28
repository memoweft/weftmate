/**
 * WeftMate 模型配置存储 —— 多模型档 + safeStorage 加密落盘（不明文·隐私红线）。
 *
 * 隐私边界（与 PRODUCT.md 一致）:
 *   - apiKey 只以 safeStorage 加密后的【密文】落盘(userData/weftmate-model.enc)。明文绝不写盘、绝不 console.log。
 *   - readPublicView() 是唯一回给渲染层的视图,【剥掉所有 apiKey】,只留 name/baseUrl/model + hasKey 布尔。
 *   - 收进来的 apiKey 只在函数栈内流过 → 加密 → 落盘,不进任何模块级变量/缓存/日志。
 *
 * 多模型档（2026-07-07 二次拍板）:配置从单份改成 { profiles:[{id,name,llm,write?,embed?}], activeId }。
 *   底部模型选择器=下拉在档间切;设置弹窗里增删改档。injectEnv() 从 activeId 那档取值塞 env。
 *
 * 生效方式=进程内热重建(见 server.ts / 记忆 weftmate-config-apply):库在 createCore 构造时读死 env,
 *   所以切档/改配置时 server 先 injectEnv() 强刷 env、再重建 core（不重启进程、窗口不闪）。
 *   为此 injectEnv() 每次都【先清后设·强制覆盖】(不再 !env 守卫)，让重建拿到的 env 精确等于当前 active 档。
 */
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ModelGroup {
  baseUrl: string;
  apiKey: string;
  model: string;
}
export interface ModelProfile {
  id: string;
  name: string;
  llm: ModelGroup;
  write?: ModelGroup & { tier?: 'local' | 'cloud' };
  embed?: ModelGroup;
}
export interface StoredConfig {
  profiles: ModelProfile[];
  activeId: string | null;
}

function configPath(): string {
  return join(app.getPath('userData'), 'weftmate-model.enc');
}

/** 解密整份配置(含 key)。仅本模块内部用。文件不存在/无加密后端/密文解不开 → 空配置(让用户重配、绝不崩)。
 *  兼容 chunk2 旧单档格式(顶层直接 llm/write/embed)→ 迁移成单个 profile。 */
function readConfig(): StoredConfig {
  const p = configPath();
  if (!existsSync(p) || !safeStorage.isEncryptionAvailable()) return { profiles: [], activeId: null };
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(p)));
    if (parsed && Array.isArray(parsed.profiles)) {
      return { profiles: parsed.profiles as ModelProfile[], activeId: parsed.activeId ?? null };
    }
    // 旧单档格式迁移:{ llm, write?, embed? } → 一个 profile。
    if (parsed && parsed.llm && parsed.llm.model) {
      const prof: ModelProfile = { id: 'p-legacy', name: parsed.llm.model || '默认模型', llm: parsed.llm, write: parsed.write, embed: parsed.embed };
      return { profiles: [prof], activeId: prof.id };
    }
    return { profiles: [], activeId: null };
  } catch {
    return { profiles: [], activeId: null };
  }
}

/** 写盘:JSON → safeStorage 加密 → 原子落盘(tmp+rename,坏写不留半截密文,读侧兜底空配置不崩)。
 *  无加密后端则拒绝并抛错(绝不明文落盘)。不 log 任何字段。 */
function writeConfig(cfg: StoredConfig): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('本机没有可用的加密后端,为保护密钥不明文落盘,暂时无法保存模型配置');
  }
  const target = configPath();
  writeFileSync(`${target}.tmp`, safeStorage.encryptString(JSON.stringify(cfg)), { mode: 0o600 });
  renameSync(`${target}.tmp`, target);
}

/** 当前 active 档(完整含 key);仅内部用(injectEnv)。 */
function getActive(): ModelProfile | null {
  const c = readConfig();
  return c.profiles.find((p) => p.id === c.activeId) ?? null;
}

/** 给渲染层的【安全视图】:每档剥掉所有 apiKey,只留 id/name/baseUrl/model + hasKey + tier。 */
export function readPublicView(): {
  profiles: Array<{
    id: string; name: string;
    llm: { baseUrl: string; model: string; hasKey: boolean };
    write: { baseUrl: string; model: string; hasKey: boolean; tier?: string } | null;
    embed: { baseUrl: string; model: string; hasKey: boolean } | null;
  }>;
  activeId: string | null;
  configured: boolean;
} {
  const c = readConfig();
  const pub = (g?: ModelGroup & { tier?: string }) =>
    g ? { baseUrl: g.baseUrl || '', model: g.model || '', hasKey: !!g.apiKey, tier: g.tier } : null;
  const profiles = c.profiles.map((p) => ({
    id: p.id, name: p.name,
    llm: { baseUrl: p.llm?.baseUrl || '', model: p.llm?.model || '', hasKey: !!p.llm?.apiKey },
    write: pub(p.write),
    embed: pub(p.embed),
  }));
  const active = c.profiles.find((p) => p.id === c.activeId);
  return { profiles, activeId: c.activeId, configured: !!(active?.llm?.baseUrl && active?.llm?.apiKey && active?.llm?.model) };
}

/** 本机是否有可用的加密后端（safeStorage）。C7：Linux 无 keyring(libsecret) 时 false → 前端好提前警示、
 *  别到保存模型密钥才甩一句天书 500。Windows/macOS 一般有后端、恒 true。 */
export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/** 主进程专用（M1-04 凭据接缝）：取 active 档 llm 组（完整含 key）。
 *  只供 DSH 运行时凭据接缝注入子进程 env 用；key 经返回值直接进 env，绝不落盘、绝不 console.log。
 *  渲染层拿不到这个函数（config-store 只在 main 进程 import）。 */
export function readActiveLlms(): { llm: ModelGroup | null } {
  return { llm: getActive()?.llm ?? null };
}

/** 稳定 id(非 workflow 脚本环境,Date/random 可用)。 */
function genId(): string {
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/** 增/改一个模型档。id 缺=新建;带 id=改。空 apiKey 沿用该档旧 key(重配不必重输)。
 *  首次建档自动设为 active。返回该档 id。全程不 log。 */
export function upsertProfile(input: {
  id?: string; name: string;
  llm: ModelGroup;
  write?: (ModelGroup & { tier?: 'local' | 'cloud' }) | null;
  embed?: ModelGroup | null;
}): string {
  const c = readConfig();
  const idx = input.id ? c.profiles.findIndex((p) => p.id === input.id) : -1;
  const prev = idx >= 0 ? c.profiles[idx] : null;
  const keepKey = (g: ModelGroup | undefined, old?: ModelGroup) =>
    g && !g.apiKey && old?.apiKey ? { ...g, apiKey: old.apiKey } : g;

  const prof: ModelProfile = {
    id: prev?.id ?? genId(),
    name: input.name || input.llm.model || '未命名模型',
    llm: keepKey(input.llm, prev?.llm) as ModelGroup,
  };
  if (input.write && (input.write.baseUrl || input.write.model || input.write.apiKey)) {
    prof.write = keepKey(input.write, prev?.write) as ModelProfile['write'];
    prof.write!.tier = input.write.tier === 'local' ? 'local' : 'cloud';
  }
  if (input.embed && (input.embed.baseUrl || input.embed.model || input.embed.apiKey)) {
    prof.embed = keepKey(input.embed, prev?.embed) as ModelGroup;
  }

  if (idx >= 0) c.profiles[idx] = prof;
  else c.profiles.push(prof);
  if (!c.activeId) c.activeId = prof.id; // 首个档自动激活
  writeConfig(c);
  return prof.id;
}

/** 删一个档。若删的是 active,activeId 落到剩下第一个(没有则 null)。返回新 activeId。 */
export function deleteProfile(id: string): string | null {
  const c = readConfig();
  c.profiles = c.profiles.filter((p) => p.id !== id);
  if (c.activeId === id) c.activeId = c.profiles[0]?.id ?? null;
  writeConfig(c);
  return c.activeId;
}

/** 切 active 档(校验存在)。返回是否成功。 */
export function setActive(id: string): boolean {
  const c = readConfig();
  if (!c.profiles.some((p) => p.id === id)) return false;
  c.activeId = id;
  writeConfig(c);
  return true;
}

// Core env 口径的键名(清/设都用这套)。
const ENV_KEYS = [
  'MEMOWEFT_LLM_BASE_URL', 'MEMOWEFT_LLM_API_KEY', 'MEMOWEFT_LLM_MODEL',
  'MEMOWEFT_WRITE_LLM_BASE_URL', 'MEMOWEFT_WRITE_LLM_API_KEY', 'MEMOWEFT_WRITE_LLM_MODEL', 'MEMOWEFT_WRITE_LLM_TIER',
  'MEMOWEFT_EMBED_BASE_URL', 'MEMOWEFT_EMBED_API_KEY', 'MEMOWEFT_EMBED_MODEL',
];

/** 把【当前 active 档】解密塞进 process.env（键名遵 Core env 口径）。
 *  必须在【构造 core 之前】调（首启:import server.ts 前;热重建:重建 core 前）。
 *  【先清后设·强制覆盖】——因为热重建要让重建拿到的 env 精确等于当前 active 档
 *  （切到没配 write/embed 的档时,旧档残留的 WRITE_/EMBED_ env 必须被清掉,否则新 core 会错用旧值）。 */
export function injectEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
  const a = getActive();
  if (!a) return;
  const set = (k: string, v?: string): void => { if (v) process.env[k] = v; };
  set('MEMOWEFT_LLM_BASE_URL', a.llm?.baseUrl);
  set('MEMOWEFT_LLM_API_KEY', a.llm?.apiKey);
  set('MEMOWEFT_LLM_MODEL', a.llm?.model);
  if (a.write) {
    set('MEMOWEFT_WRITE_LLM_BASE_URL', a.write.baseUrl);
    set('MEMOWEFT_WRITE_LLM_API_KEY', a.write.apiKey);
    set('MEMOWEFT_WRITE_LLM_MODEL', a.write.model);
    set('MEMOWEFT_WRITE_LLM_TIER', a.write.tier === 'local' ? 'local' : 'cloud');
  }
  if (a.embed) {
    set('MEMOWEFT_EMBED_BASE_URL', a.embed.baseUrl);
    set('MEMOWEFT_EMBED_API_KEY', a.embed.apiKey);
    set('MEMOWEFT_EMBED_MODEL', a.embed.model);
  }
}

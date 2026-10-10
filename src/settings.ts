/**
 * WeftMate 非机密设置存储——明文 JSON 存 userData/weftmate-settings.json。
 *
 * 与 config-store 分工：模型 key 是机密、走 config-store 的 safeStorage 加密；这里只放【非机密偏好】
 *   （如"感知是否开启"），明文 JSON 即可，不必加密。跑在主进程（用 app.getPath('userData')）。
 * 感知默认【关】(opt-in)：文件不存在 / 无该字段 → false。感知敏感，尊重用户先手动开。
 *
 * R4 退役：v2 的 Agent 自主度、首次认识、MCP 信任表、语言/主题偏好随旧产品层删除；
 * 新基座下这些能力归官方 web（permission-presets / 官方设置面）。本文件只保留：
 *   - 感知偏好（R6 恢复感知采集用，opt-in 默认关）；
 *   - 桌面宠物窗口显示偏好（托盘+主窗口形态保留，R6 恢复完整桌宠）。
 */
import { app } from 'electron';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProductConfigStore, type PublicModelProfile, type ThemePreference } from './stage2-config.ts';
import { selectLegacyCompatibilityBackfill, type LegacyCompatibilityEvidence } from './legacy-compatibility-backfill.ts';

interface Settings {
  schemaVersion?: number;
  appearance?: { theme?: ThemePreference };
  models?: { profiles?: PublicModelProfile[]; activeId?: string | null };
  sessionBindings?: Record<string, { profileId: string; restoreInternalRoute: boolean }>;
  legacyCompatibilityProfileId?: string | null;
  perception?: {
    enabled?: boolean; // 旧扁平结构(迁移用):等价 sources.desktop.enabled
    /** 全局:是否允许感知数据(observed)上云。默认 false=不上云(红线);作者拍板加 opt-in 开关。 */
    cloudAllowed?: boolean;
    /** 多来源(桌面=第一个源;架构留位手机/穿戴等后续源)。 */
    sources?: {
      desktop?: { enabled?: boolean; capture?: 'app_title' | 'app_only' };
      mobile?: { enabled?: boolean };
    };
    /** 剪贴板感知（R6-01）：额外敏感，独立开关，默认关。 */
    clipboard?: { enabled?: boolean };
    /** 感知注入模型上下文（R6-01）：独立开关，默认关。 */
    inject?: { enabled?: boolean; intervalMs?: number };
  };
  /** 透明桌面宠物窗口的本机显示偏好与位置；不属于 Soul，也不会随人格包分享。 */
  desktopPet?: { visible?: boolean; x?: number; y?: number; roaming?: boolean; freeActivity?: boolean };
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'weftmate-settings.json');
}

function read(): Settings {
  return new ProductConfigStore(settingsPath()).read() as Settings;
}

function write(s: Settings): void {
  new ProductConfigStore(settingsPath()).write(s as never);
}

/** Stage 2 的唯一非敏感设置视图。不存在 API Key，也不会间接暴露存储路径。 */
export function readProductSettings(): {
  schemaVersion: number;
  appearance: { theme: ThemePreference };
  models: { profiles: PublicModelProfile[]; activeId: string | null };
} {
  const settings = read();
  return {
    schemaVersion: settings.schemaVersion ?? 2,
    appearance: { theme: settings.appearance?.theme ?? 'system' },
    models: { profiles: settings.models?.profiles ?? [], activeId: settings.models?.activeId ?? null },
  };
}

/** Main-process-only full non-secret snapshot used to compensate a failed
 * profile/vault/runtime mutation. It is never returned through IPC. */
export function snapshotSettings(): Settings { return structuredClone(read()); }
export function restoreSettings(snapshot: Settings): void { write(structuredClone(snapshot)); }
/** Raw public bytes are used only by the private recovery journal, so a crash
 * compensation can restore the exact prior file rather than reformatting it. */
export function snapshotSettingsBytes(): Buffer | null { return existsSync(settingsPath()) ? readFileSync(settingsPath()) : null; }
export function restoreSettingsBytes(snapshot: Buffer | null): void {
  const target = settingsPath();
  if (snapshot === null) { if (existsSync(target)) rmSync(target, { force: true }); return; }
  const temporary = `${target}.${process.pid}.${randomUUID()}.rollback.tmp`;
  try { writeFileSync(temporary, snapshot, { mode: 0o600 }); renameSync(temporary, target); }
  catch (error) { try { rmSync(temporary, { force: true }); } catch {} throw error; }
}

export function setThemePreference(theme: unknown): ThemePreference {
  const next: ThemePreference = theme === 'light' || theme === 'dark' ? theme : 'system';
  const settings = read();
  settings.appearance = { ...(settings.appearance ?? {}), theme: next };
  write(settings);
  return next;
}

export function listModelProfiles(): { profiles: PublicModelProfile[]; activeId: string | null } {
  const settings = readProductSettings();
  return { profiles: settings.models.profiles, activeId: settings.models.activeId };
}

/** 旧 Stage 1 密文档迁移时只导入尚不存在的 id，故可安全重试。 */
export function importLegacyModelProfiles(profiles: PublicModelProfile[], activeId: string | null): { accepted: string[]; rejected: string[] } {
  const settings = read();
  const current = settings.models?.profiles ?? [];
  if (profiles.length === 0) return { accepted: [], rejected: [] };
  if (current.length === 0) {
    const selected = profiles.some((item) => item.id === activeId) ? activeId : profiles[0]?.id ?? null;
    settings.models = { profiles, activeId: selected };
    // The sole durable source for empty/legacy DSH headers.  A later active
    // switch must never silently redirect an old session.
    settings.legacyCompatibilityProfileId = selected;
    write(settings);
  }
  const persisted = read().models?.profiles ?? [];
  const accepted = profiles.filter((profile) => persisted.some((item) => item.id === profile.id && item.provider === profile.provider && item.baseUrl === profile.baseUrl && item.model === profile.model)).map((profile) => profile.id);
  return { accepted, rejected: profiles.filter((profile) => !accepted.includes(profile.id)).map((profile) => profile.id) };
}

export function upsertModelProfile(profile: PublicModelProfile,
  options: { preserveActive?: boolean } = {}): PublicModelProfile {
  const settings = read();
  const models = settings.models?.profiles ?? [];
  const index = models.findIndex((item) => item.id === profile.id);
  if (index >= 0) models[index] = profile;
  else models.push(profile);
  settings.models = { profiles: models,
    activeId: options.preserveActive === true ? settings.models?.activeId ?? null
      : settings.models?.activeId ?? profile.id };
  write(settings);
  return profile;
}

export function removeModelProfile(id: string): string | null {
  const settings = read();
  const profiles = (settings.models?.profiles ?? []).filter((item) => item.id !== id);
  const activeId = settings.models?.activeId === id ? profiles[0]?.id ?? null : settings.models?.activeId ?? null;
  settings.models = { profiles, activeId };
  if (settings.legacyCompatibilityProfileId === id) settings.legacyCompatibilityProfileId = null;
  write(settings);
  return activeId;
}

/** A durable, non-secret fallback only for pre-Stage-2 sessions lacking a DSH model header. */
export function sessionModelBinding(sessionId: string): string | null {
  const value = read().sessionBindings?.[sessionId];
  return typeof value?.profileId === 'string' ? value.profileId : null;
}

export function sessionBindingNeedsInternalRoute(sessionId: string): boolean {
  return read().sessionBindings?.[sessionId]?.restoreInternalRoute === true;
}

export function bindSessionModel(sessionId: string, profileId: string, restoreInternalRoute = true): void {
  if (!sessionId || !profileId || sessionId.length > 240 || profileId.length > 160) throw new TypeError('invalid session binding');
  const settings = read();
  if (!(settings.models?.profiles ?? []).some((profile) => profile.id === profileId)) throw new Error('unknown model profile');
  settings.sessionBindings = { ...(settings.sessionBindings ?? {}), [sessionId]: { profileId, restoreInternalRoute } };
  write(settings);
}

export function profileHasSessionBinding(profileId: string): boolean {
  return Object.values(read().sessionBindings ?? {}).some((binding) => binding.profileId === profileId);
}
export function unbindSessionModel(sessionId: string): void {
  const settings=read();if(!settings.sessionBindings?.[sessionId])return;
  delete settings.sessionBindings[sessionId];write(settings);
}

/** Explicitly persisted by legacy migration; it is intentionally not activeId. */
export function legacyCompatibilityProfileId(): string | null {
  const settings = read();
  const id = settings.legacyCompatibilityProfileId;
  return typeof id === 'string' && (settings.models?.profiles ?? []).some((profile) => profile.id === id) ? id : null;
}

/** Backfill only from encrypted migration evidence that exactly matches the retained public route metadata. */
export function backfillLegacyCompatibilityProfile(evidence: LegacyCompatibilityEvidence | null): boolean {
  const settings = read();
  const id = selectLegacyCompatibilityBackfill({ recordedId: settings.legacyCompatibilityProfileId ?? null,
    profiles: settings.models?.profiles ?? [], evidence });
  if (!id) return false;
  settings.legacyCompatibilityProfileId = id;
  write(settings);
  return true;
}

export function setActiveModelProfile(id: string): boolean {
  return restoreActiveModelProfile(id);
}

/** Internal switch transaction hook; null restores the legitimate no-active state. */
export function restoreActiveModelProfile(id: string | null): boolean {
  const settings = read();
  if (id !== null && !(settings.models?.profiles ?? []).some((item) => item.id === id)) return false;
  settings.models = { profiles: settings.models?.profiles ?? [], activeId: id };
  write(settings);
  return true;
}

// ── 感知(多源 · opt-in · 默认关) ──
// 桌面源开关沿用 getPerceptionEnabled 名字(main 在用),读新结构 sources.desktop.enabled、
//   兼容旧扁平 perception.enabled(迁移)。cloudAllowed/capture 为新增。

/** 桌面感知源是否开启（默认关·opt-in;兼容旧扁平 enabled）。 */
export function getPerceptionEnabled(): boolean {
  const p = read().perception;
  return p?.sources?.desktop?.enabled === true || (p?.sources === undefined && p?.enabled === true);
}

/** 设置桌面感知源开关（写新结构;不动 cloudAllowed/capture）。 */
export function setPerceptionEnabled(on: boolean): void {
  const s = read();
  const p = s.perception ?? {};
  p.sources = { ...(p.sources ?? {}), desktop: { ...(p.sources?.desktop ?? {}), enabled: !!on } };
  delete p.enabled; // 迁移:清掉旧扁平位,统一走 sources.desktop
  s.perception = p;
  write(s);
}

/** 是否允许感知数据上云（默认 false=不上云·红线;true 时 server 才给 observed 显式放行 allowCloudRead）。 */
export function getPerceptionCloudAllowed(): boolean {
  return read().perception?.cloudAllowed === true;
}
export function setPerceptionCloudAllowed(on: boolean): void {
  const s = read();
  s.perception = { ...(s.perception ?? {}), cloudAllowed: !!on };
  write(s);
}

/** 桌面源采集内容：'app_title'(App+窗口标题·默认) / 'app_only'(仅 App 名·更省隐私)。 */
export function getDesktopCapture(): 'app_title' | 'app_only' {
  return read().perception?.sources?.desktop?.capture === 'app_only' ? 'app_only' : 'app_title';
}
export function setDesktopCapture(cap: 'app_title' | 'app_only'): void {
  const s = read();
  const p = s.perception ?? {};
  p.sources = { ...(p.sources ?? {}), desktop: { ...(p.sources?.desktop ?? {}), capture: cap === 'app_only' ? 'app_only' : 'app_title' } };
  s.perception = p;
  write(s);
}

/** 剪贴板感知（R6-01）：额外敏感，独立开关，默认关——感知总开关打开也不采，需单独开。 */
export function getClipboardEnabled(): boolean {
  return read().perception?.clipboard?.enabled === true;
}
export function setClipboardEnabled(on: boolean): void {
  const s = read();
  const p = s.perception ?? {};
  p.clipboard = { ...(p.clipboard ?? {}), enabled: !!on };
  s.perception = p;
  write(s);
}

/** 感知注入模型上下文（R6-01）：独立开关，默认关；注入内容由运行时宿主插件按快照生成。 */
export function getInjectEnabled(): boolean {
  return read().perception?.inject?.enabled === true;
}
export function setInjectEnabled(on: boolean): void {
  const s = read();
  const p = s.perception ?? {};
  p.inject = { ...(p.inject ?? {}), enabled: !!on };
  s.perception = p;
  write(s);
}

/** 注入最小间隔（毫秒，5s–1h 夹取；缺省 60s）。 */
export function getInjectIntervalMs(): number {
  const v = read().perception?.inject?.intervalMs;
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 60_000;
  return Math.min(3_600_000, Math.max(5_000, Math.round(n)));
}

/** 手机感知源（R8）：独立开关，默认关——手机 App 配对后上报的观察只在开启时进感知面。 */
export function getMobilePerceptionEnabled(): boolean {
  return read().perception?.sources?.mobile?.enabled === true;
}
export function setMobilePerceptionEnabled(on: boolean): void {
  const s = read();
  const p = s.perception ?? {};
  p.sources = { ...(p.sources ?? {}), mobile: { ...(p.sources?.mobile ?? {}), enabled: !!on } };
  s.perception = p;
  write(s);
}

/** 感知设置视图(多源结构 + 全局 cloudAllowed + 剪贴板/注入开关 + 手机源)，R6/R8 感知 UI 与主进程采集面共用。 */
export function readPerceptionView(): {
  cloudAllowed: boolean;
  sources: { desktop: { enabled: boolean; capture: 'app_title' | 'app_only' }; mobile: { enabled: boolean } };
  clipboard: { enabled: boolean };
  inject: { enabled: boolean; intervalMs: number };
} {
  return {
    cloudAllowed: getPerceptionCloudAllowed(),
    sources: {
      desktop: { enabled: getPerceptionEnabled(), capture: getDesktopCapture() },
      mobile: { enabled: getMobilePerceptionEnabled() },
    },
    clipboard: { enabled: getClipboardEnabled() },
    inject: { enabled: getInjectEnabled(), intervalMs: getInjectIntervalMs() },
  };
}

export interface DesktopPetWindowState {
  visible: boolean;
  x?: number;
  y?: number;
  freeActivity?: boolean;
}

/** 读取桌面宠物窗口状态；损坏坐标直接忽略，由主进程回到当前屏幕右下角。 */
export function getDesktopPetWindowState(): DesktopPetWindowState {
  const value = read().desktopPet;
  const finite = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate);
  return {
    visible: value?.visible === true,
    // 旧 roaming 只代表低频挪动，不能静默升级成会读取瞬时鼠标位置的新“自由活动”。
    freeActivity: value?.freeActivity === true,
    ...(finite(value?.x) ? { x: Math.round(value.x) } : {}),
    ...(finite(value?.y) ? { y: Math.round(value.y) } : {}),
  };
}

/** 只保存已验证的显示状态/整数坐标，不影响感知或其它偏好。 */
export function setDesktopPetWindowState(next: DesktopPetWindowState): DesktopPetWindowState {
  const s = read();
  const previous = s.desktopPet;
  const finite = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate);
  const normalized: DesktopPetWindowState = {
    visible: next.visible === true,
    freeActivity: typeof next.freeActivity === 'boolean' ? next.freeActivity : previous?.freeActivity === true,
    ...(finite(next.x) ? { x: Math.round(next.x) } : {}),
    ...(finite(next.y) ? { y: Math.round(next.y) } : {}),
  };
  s.desktopPet = normalized;
  write(s);
  return normalized;
}

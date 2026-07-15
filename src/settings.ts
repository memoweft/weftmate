/**
 * WeftMate 非机密设置存储（阶段2）—— 明文 JSON 存 userData/weftmate-settings.json。
 *
 * 与 config-store 分工：模型 key 是机密、走 config-store 的 safeStorage 加密；这里只放【非机密偏好】
 *   （如"感知是否开启"），明文 JSON 即可，不必加密。跑在主进程（用 app.getPath('userData')）。
 * 感知默认【关】(opt-in)：文件不存在 / 无该字段 → false。感知敏感，尊重用户先手动开。
 */
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface Settings {
  perception?: {
    enabled?: boolean; // 旧扁平结构(迁移用):等价 sources.desktop.enabled
    /** 全局:是否允许感知数据(observed)上云。默认 false=不上云(红线);作者拍板加 opt-in 开关。 */
    cloudAllowed?: boolean;
    /** 多来源(桌面=第一个源;架构留位手机/穿戴等后续源)。 */
    sources?: {
      desktop?: { enabled?: boolean; capture?: 'app_title' | 'app_only' };
    };
  };
  /** 库产出语言(认知/摘要):'auto'=跟系统 / 'zh' / 'en'。缺省 auto。见 [[weftmate 语言]] / MEMOWEFT_LANG。 */
  language?: 'auto' | 'zh' | 'en';
  /** 桌面外观主题。用设置文件持久化，避免动态 loopback 端口改变 localStorage origin。 */
  theme?: 'dark' | 'light';
  /** 已「信任·免批准」的 MCP 工具 fqName（F1 trust opt-in）。默认空=所有 MCP 工具都要批准。 */
  trustedMcpTools?: string[];
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'weftmate-settings.json');
}

function read(): Settings {
  try {
    if (existsSync(settingsPath())) {
      const parsed = JSON.parse(readFileSync(settingsPath(), 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch { /* 文件损坏/读不到 → 当空设置 */ }
  return {};
}

function write(s: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8');
}

// ── 感知(多源 · opt-in · 默认关) ──
// 桌面源开关沿用 getPerceptionEnabled 名字(main/server/collector 都在用),读新结构 sources.desktop.enabled、
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

/** 给渲染层的感知设置视图(多源结构 + 全局 cloudAllowed)。 */
export function readPerceptionView(): {
  cloudAllowed: boolean;
  sources: { desktop: { enabled: boolean; capture: 'app_title' | 'app_only' } };
} {
  return {
    cloudAllowed: getPerceptionCloudAllowed(),
    sources: { desktop: { enabled: getPerceptionEnabled(), capture: getDesktopCapture() } },
  };
}

/** 语言设置(原样存 'auto'/'zh'/'en';缺省 auto)。 */
export function getLanguage(): 'auto' | 'zh' | 'en' {
  const v = read().language;
  return v === 'zh' || v === 'en' ? v : 'auto';
}
export function setLanguage(lang: 'auto' | 'zh' | 'en'): void {
  const s = read();
  s.language = lang === 'zh' || lang === 'en' ? lang : 'auto';
  write(s);
}

/** 桌面主题（默认暗色）。 */
export function getTheme(): 'dark' | 'light' {
  return read().theme === 'light' ? 'light' : 'dark';
}
export function setTheme(theme: 'dark' | 'light'): void {
  const s = read();
  s.theme = theme === 'light' ? 'light' : 'dark';
  write(s);
}

/** 解析成 memoweft 认的 'zh'/'en'——auto 时跟系统语言(zh-* → zh,否则 en)。供设 MEMOWEFT_LANG / 改 config.language。 */
export function resolvedLang(): 'zh' | 'en' {
  const l = getLanguage();
  if (l === 'zh' || l === 'en') return l;
  try {
    return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

// ── MCP 工具信任（F1·trust opt-in）──────────────────────────────────
// 安全默认：所有 MCP（第三方代码）工具都要用户点头（resolveTool alwaysApprove=true）。用户对信得过的
//   具体工具显式「信任」后，它才降级为按自主度/mutating 走（同内置工具）。信任非机密→明文设置即可。
/** 已信任·免批的 MCP 工具 fqName 列表。 */
export function getTrustedMcpTools(): string[] {
  const t = read().trustedMcpTools;
  return Array.isArray(t) ? t.filter((x) => typeof x === 'string') : [];
}
/** 设某个 MCP 工具的信任（trusted=true 免批；false 撤回信任、恢复要批）。 */
export function setMcpToolTrust(fqName: string, trusted: boolean): void {
  const s = read();
  const set = new Set(getTrustedMcpTools());
  if (trusted) set.add(fqName); else set.delete(fqName);
  s.trustedMcpTools = [...set];
  write(s);
}

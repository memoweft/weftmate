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
  perception?: { enabled?: boolean };
  /** 库产出语言(认知/摘要):'auto'=跟系统 / 'zh' / 'en'。缺省 auto。见 [[weftmate 语言]] / MEMOWEFT_LANG。 */
  language?: 'auto' | 'zh' | 'en';
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

/** 感知是否开启（默认关·opt-in）。 */
export function getPerceptionEnabled(): boolean {
  return read().perception?.enabled === true;
}

/** 设置感知开关，落盘。 */
export function setPerceptionEnabled(on: boolean): void {
  const s = read();
  s.perception = { ...(s.perception ?? {}), enabled: !!on };
  write(s);
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

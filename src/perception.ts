/**
 * WeftMate 桌面感知（R6-01）——采集面全部在 Electron main。
 *
 * 为什么放 main：get-windows（N-API 原生模块）、powerMonitor（空闲/锁屏）、clipboard 都是 main
 * 侧原生能力；运行时子进程只拿到「读双工文件 → UI 展示 / 模型注入」的干净面，不碰原生与敏感源。
 *
 * 隐私纪律：
 *  - 感知总开关（settings.perception.sources.desktop.enabled）默认关、每 tick 热读（热生效）；
 *  - 剪贴板额外敏感：独立开关（settings.perception.clipboard.enabled），默认关；
 *  - 模型注入独立开关（settings.perception.inject.enabled），默认关——注入发生在运行时宿主插件；
 *  - 采样结果只原子写本地 <dsh-home>/weftmate-perception-main.json，绝不主动网络外发；
 *  - 窗口标题按 capture 设置截断（app_only 不采标题）；剪贴板文本截断 500 字符。
 */
import { clipboard, powerMonitor } from 'electron';
import { createLatestFileWriter } from './latest-file-writer.mjs';
import { join } from 'node:path';
import {
  getClipboardEnabled,
  getDesktopCapture,
  getInjectEnabled,
  getInjectIntervalMs,
  getMobilePerceptionEnabled,
  getPerceptionEnabled,
} from './settings.ts';

const SAMPLE_MS = 5_000;
const CLIPBOARD_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 300;

export interface PerceptionMainFile {
  schemaVersion: 1;
  updatedAt: string;
  config: {
    enabled: boolean;
    capture: 'app_title' | 'app_only';
    clipboard: boolean;
    inject: { enabled: boolean; intervalMs: number };
    mobile: boolean;
  };
  /** 总开关关时为 null（不开不采）；开时每 tick 全量覆盖。 */
  sample: {
    activeWindow: { app: string; title: string } | null;
    idleSeconds: number;
    locked: boolean;
    clipboardText: string | null;
    /** R8：手机源最近一条观察（开关关/无观察为 null）。 */
    mobile: { content: string; occurredAt: string; deviceName: string } | null;
  } | null;
}

export interface PerceptionRuntime {
  dispose(): void;
}

interface GetWindowsModule {
  activeWindow?: () => Promise<{ owner?: { name?: string }; title?: string } | null>;
}

interface DeviceObservation {
  content: string;
  occurredAt: string;
  deviceName: string;
}

export function initPerception(opts: {
  dshHome: string;
  readMobileObservations?: () => DeviceObservation[];
}): PerceptionRuntime {
  const stateFile = join(opts.dshHome, 'weftmate-perception-main.json');
  const writeSnapshot = createLatestFileWriter(stateFile);
  const readMobile = opts.readMobileObservations ?? (() => []);
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;
  let locked = false;
  let activeWindowFn: (() => Promise<{ owner?: { name?: string }; title?: string } | null>) | null = null;

  const writeNow = (payload: PerceptionMainFile): void => {
    if (disposed) return;
    void writeSnapshot(`${JSON.stringify(payload)}\n`).catch(() => {});
  };

  const loadActiveWindow = async (): Promise<GetWindowsModule['activeWindow'] | null> => {
    if (activeWindowFn === null) {
      try {
        const mod = (await import('get-windows')) as GetWindowsModule;
        activeWindowFn = typeof mod.activeWindow === 'function' ? mod.activeWindow : null;
      } catch { activeWindowFn = null; } // 原生模块不可用：不挡其余采集
    }
    return activeWindowFn;
  };

  const sample = async (): Promise<void> => {
    if (disposed) return;
    const mobileEnabled = getMobilePerceptionEnabled();
    const config = {
      enabled: getPerceptionEnabled(),
      capture: getDesktopCapture(),
      clipboard: getClipboardEnabled(),
      inject: { enabled: getInjectEnabled(), intervalMs: getInjectIntervalMs() },
      mobile: mobileEnabled,
    };
    if (!config.enabled) {
      // 开关关（或热关）：不采，sample 清空；config 仍写出供 UI 显示「未开启」与开关动作。
      writeNow({ schemaVersion: 1, updatedAt: new Date().toISOString(), config, sample: null });
      return;
    }
    let activeWindow: { app: string; title: string } | null = null;
    const fn = await loadActiveWindow();
    if (fn) {
      try {
        const w = await fn();
        if (w) {
          const app = w.owner?.name || 'unknown';
          const title = config.capture === 'app_title' && typeof w.title === 'string'
            ? w.title.slice(0, TITLE_MAX_CHARS)
            : '';
          activeWindow = { app, title };
        }
      } catch { /* 取窗失败静默：activeWindow 保持 null */ }
    }
    let clipboardText: string | null = null;
    if (config.clipboard) {
      try {
        const text = clipboard.readText();
        if (text) clipboardText = text.slice(0, CLIPBOARD_MAX_CHARS);
      } catch { /* 剪贴板不可读静默 */ }
    }
    // R8：手机源观察合并（开关开时取最近一条；只读、不进桌面采集路径）。
    let mobile: { content: string; occurredAt: string; deviceName: string } | null = null;
    if (mobileEnabled) {
      const observations = readMobile();
      const latest = observations[0];
      if (latest && typeof latest.content === 'string' && latest.content) {
        mobile = {
          content: latest.content.slice(0, 300),
          occurredAt: typeof latest.occurredAt === 'string' ? latest.occurredAt : '',
          deviceName: typeof latest.deviceName === 'string' ? latest.deviceName : '',
        };
      }
    }
    writeNow({
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      config,
      sample: {
        activeWindow,
        idleSeconds: powerMonitor.getSystemIdleTime(),
        locked,
        clipboardText,
        mobile,
      },
    });
  };

  const onLock = (): void => { locked = true; void sample(); };
  const onUnlock = (): void => { locked = false; void sample(); };
  powerMonitor.on('lock-screen', onLock);
  powerMonitor.on('unlock-screen', onUnlock);

  void sample();
  timer = setInterval(() => { void sample(); }, SAMPLE_MS);
  timer.unref?.();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
      powerMonitor.removeListener('lock-screen', onLock);
      powerMonitor.removeListener('unlock-screen', onUnlock);
    },
  };
}

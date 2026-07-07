/**
 * 感知采集器（阶段2·感知→画像）—— 采样活动窗口 + 活动节奏 → POST /api/observe。
 *
 * 定位：跑在 Electron 主进程（用 powerMonitor 判空闲、用 get-windows 取活动窗口）。采到的样本【走 loopback
 *   /api/observe】而非直连 Core——为的是过 server 的审核层（sanitizeObservation 强制剥授权位 → observed 默认
 *   不上云，隐私红线）。采集器只管"采什么、什么时候采"，落库/不上云的把关归 server。
 *
 * 隐私 & 克制：
 *   - opt-in：默认关（见 settings.ts），只有用户在设置里开了、main/server 才 startCollector。
 *   - 空闲/锁屏不采：powerMonitor 空闲超阈值（离开电脑）就跳过，不记"你不在时的窗口"，也防噪、省电。
 *   - 换窗才记：同一窗口不重复记（lastKey 去重），只在活动窗口变化时记一条"切到了 X"。
 *   - 窗口标题可能含敏感信息（文档名/网址）→ 靠 server 强制 observed 不上云 + 用户可在画像里看到并删。
 *
 * get-windows：N-API 预编译原生模块，ABI 跨 Node/Electron 稳定（已实测 Electron 直接可加载，不需 electron-rebuild）。
 */
import { powerMonitor } from 'electron';

const SAMPLE_MS = 20_000;      // 采样间隔 20s
const IDLE_THRESHOLD_S = 60;   // 空闲 60s 视为"离开"，不采

let timer: ReturnType<typeof setInterval> | null = null;
let port = 7788;
let lastKey = '';              // 上次记录的窗口键（app|title），去重用
let activeWindowFn: (() => Promise<{ title?: string; owner?: { name?: string } } | undefined>) | null = null;

/** 惰性加载 get-windows（ESM 动态 import；由 weftmate 内的模块 import，node_modules 能解析）。 */
async function loadActiveWindow(): Promise<typeof activeWindowFn> {
  if (!activeWindowFn) {
    const m = await import('get-windows');
    activeWindowFn = m.activeWindow as typeof activeWindowFn;
  }
  return activeWindowFn;
}

/** 采一次：空闲/锁屏跳过；取活动窗口；换窗才 POST（走 /api/observe 审核层）。全程静默兜错，绝不崩主进程。 */
async function sampleOnce(): Promise<void> {
  try {
    // 离开电脑（空闲超阈值 / 锁屏）不采——只记"你在用时"的活动节奏。
    if (powerMonitor.getSystemIdleState(IDLE_THRESHOLD_S) !== 'active') return;
    const fn = await loadActiveWindow();
    if (!fn) return;
    const w = await fn();
    if (!w) return;
    const app = (w.owner && w.owner.name) || 'unknown';
    const title = w.title || '';
    const key = app + '|' + title;
    if (key === lastKey) return; // 没换窗口不重复记
    lastKey = key;
    await fetch(`http://127.0.0.1:${port}/api/observe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observations: [{
          kind: 'active_window',
          content: title ? `${app} — ${title}` : app,
          occurredAt: new Date().toISOString(),
          meta: { app, title },
        }],
      }),
    }).catch(() => { /* 采集摄入失败（服务没起/被拒）不闹，等下一轮 */ });
  } catch { /* 取窗/采样出错静默，别让感知拖垮主进程 */ }
}

/** 开启采集（opt-in 时 main/server 调）。幂等：已在跑则忽略。port = loopback 端口。 */
export function startCollector(p?: number): void {
  if (p) port = p;
  if (timer) return;
  lastKey = '';
  timer = setInterval(() => { void sampleOnce(); }, SAMPLE_MS);
  void sampleOnce(); // 开启即采一次，别等 20s
}

/** 停采（关开关 / 退出时调）。 */
export function stopCollector(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

export function isCollectorRunning(): boolean {
  return !!timer;
}

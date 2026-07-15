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
import { getDesktopCapture } from './settings.ts';

const SAMPLE_MS = 20_000;      // 采样间隔 20s
const IDLE_THRESHOLD_S = 60;   // 空闲 60s 视为"离开"，不采

let timer: ReturnType<typeof setInterval> | null = null;
let port = 7788;
let loopbackToken = '';
let lastKey = '';              // 上次记录的窗口键（app|title），去重用
let activeWindowFn: (() => Promise<{ title?: string; owner?: { name?: string } } | undefined>) | null = null;

/** 惰性加载 get-windows（ESM 动态 import；由 weftmate 内的模块 import，node_modules 能解析）。 */
async function loadActiveWindow(): Promise<typeof activeWindowFn> {
  if (!activeWindowFn) {
    const m = await import('get-windows');
    // get-windows 真实签名是 (options?) => Promise<Result>；这里刻意收窄成只读 title/owner.name
    // 的最小形状（经 unknown 显式承认在窄化第三方类型），fn() 无参调用合法、options 可选。
    activeWindowFn = m.activeWindow as unknown as typeof activeWindowFn;
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
    // 采集内容设置:'app_only' 只记 App 名(更省隐私、不采窗口标题);'app_title' 记 App+标题。
    const titleOn = getDesktopCapture() !== 'app_only';
    const title = titleOn ? (w.title || '') : '';
    const key = app + '|' + title;
    if (key === lastKey) return; // 没换窗口不重复记（进程内去重）
    lastKey = key;
    // C4：给稳定 originId=窗口键+小时桶——Core 按 originId 幂等去重，同窗口跨重启同小时不重复记
    //   （lastKey 只在进程内、重启归零；隔到别的小时再回到该窗口仍算新事件）。
    const originId = `aw:${key}@${new Date().toISOString().slice(0, 13)}`;
    if (!loopbackToken) return;
    await fetch(`http://127.0.0.1:${port}/api/observe`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${loopbackToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        observations: [{
          kind: 'active_window',
          content: title ? `${app} — ${title}` : app,
          occurredAt: new Date().toISOString(),
          originId,
          meta: titleOn ? { app, title } : { app },
        }],
      }),
    }).catch(() => { /* 采集摄入失败（服务没起/被拒）不闹，等下一轮 */ });
  } catch { /* 取窗/采样出错静默，别让感知拖垮主进程 */ }
}

/** 开启采集（opt-in 时 main/server 调）。凭据只在进程内持有，不落盘。 */
export function startCollector(p: number, token: string): void {
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new RangeError(`无效 loopback 端口：${p}`);
  if (!token) throw new Error('缺少 loopback 会话凭据');
  port = p;
  loopbackToken = token;
  if (timer) return;
  lastKey = '';
  timer = setInterval(() => { void sampleOnce(); }, SAMPLE_MS);
  void sampleOnce(); // 开启即采一次，别等 20s
}

/** 停采（关开关 / 退出时调）。 */
export function stopCollector(): void {
  if (timer) { clearInterval(timer); timer = null; }
  loopbackToken = '';
}

export function isCollectorRunning(): boolean {
  return !!timer;
}

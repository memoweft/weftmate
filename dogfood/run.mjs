/**
 * WeftMate · dogfood 启动器（进仓·可复现·零密钥）
 * ────────────────────────────────────────────────────────────────────────
 * 用途：起一个**与你日常真实实例完全隔离**的 WeftMate，用来天天遛自己的产品
 *   （dogfood）。隔离靠两样：
 *     ① `--user-data-dir` 指到 dogfood/data/userdata —— Electron 的 userData 改这，
 *        main.mjs 据此把库落到 <userData>/weftmate.db、模型配置/MCP 清单也存这。
 *        → 绝不碰你真实的 userData（真机聊天记录/画像/密钥一点不动）。
 *     ② 不同的 PORT（默认 7899，正常实例是 7788）—— loopback 端口错开，
 *        dogfood 实例和正常实例可以同时开着互不撞。
 *   单实例锁按 userData 目录走，两个 userData 各自一把锁，天然不打架。
 *
 * 不含任何密钥：首次启动会进「配模型」向导，自己填 key（safeStorage 加密落 userData）。
 *   这个脚本不预置、不读取、不写入任何密钥。
 *
 * 跑：
 *     node dogfood/run.mjs              # 默认 PORT=7899
 *     PORT=7900 node dogfood/run.mjs    # 想换端口就设 env（PowerShell: $env:PORT=7900; node ...）
 *
 * 重置 dogfood（回到「刚装好、没配过」的干净态）：
 *     直接删掉整个 dogfood/data 目录即可 —— 那里面全是隔离实例的库/配置/密钥，
 *     已在 .gitignore 里忽略、绝不进仓。删完下次跑又是全新向导。
 *
 * 跨平台：electron 二进制路径用 npm 包的默认导出解析（Windows/mac/linux 通用），
 *   等价于 node_modules/.bin/electron 背后启动的同一个 exe，但绕开了 Windows 上
 *   .cmd shim / shell 引号的坑，直接 spawn 真正的可执行文件。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..'); // electron . 要在项目根跑（package.json main = src/main.mjs）
const userDataDir = join(here, 'data', 'userdata');

// 隔离 userData 目录先建好（Electron 自己也会建，但先建一份日志更清楚）。
mkdirSync(userDataDir, { recursive: true });

// 解析 electron 可执行文件的绝对路径。
//   electron npm 包的默认导出 = 二进制绝对路径（读 path.txt → dist/electron.exe|electron），
//   这是官方推荐、最稳的跨平台拿法；从本文件位置向上找 node_modules 命中项目根的 electron。
const require = createRequire(import.meta.url);
let electronBin;
try {
  electronBin = require('electron');
} catch {
  console.error('[dogfood] 找不到 electron —— 先在项目根跑 `npm install`。');
  process.exit(1);
}

// 端口：默认 7899（错开正常实例的 7788）；尊重外部 PORT env（main.mjs 也尊重 PORT）。
const PORT = process.env.PORT || '7899';

console.log('[dogfood] userData =', userDataDir, '（隔离·不碰真实 userData）');
console.log('[dogfood] PORT     =', PORT, '（正常实例默认 7788，错开避免撞）');
console.log('[dogfood] electron =', electronBin);
console.log('[dogfood] 首启走「配模型」向导（本脚本不预置任何密钥）。重置：删掉 dogfood/data 整个目录。');

const child = spawn(
  electronBin,
  ['.', `--user-data-dir=${userDataDir}`],
  {
    cwd: projectRoot,
    stdio: 'inherit', // 把 [weftmate] 日志直通到当前终端，dogfood 看得见后台在干嘛
    env: { ...process.env, PORT },
  },
);

child.on('error', (err) => {
  console.error('[dogfood] 启动 electron 失败:', err && err.message ? err.message : err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[dogfood] electron 被信号 ${signal} 结束`);
    process.exit(0);
  }
  process.exit(code ?? 0);
});

// 转发中断信号，让 electron 干净退出（走 before-quit 收尾：停采集 + scheduler.dispose + core.close）。
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

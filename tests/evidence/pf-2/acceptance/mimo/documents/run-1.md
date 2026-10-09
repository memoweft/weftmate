# Node.js 24 相比 22 值得留意的变化（简要说明）

> 面向下班后快速浏览：先看"一句话结论"，再按需看细节。所有内容依据官方资料整理。

## 一句话结论

Node.js 24 是 2025 年 5 月发布的 Current、2025-10-28 进入 Active LTS（代号 Krypton）；相比 22（Jod），主要变化是 **V8 升级到 13.6**（带来 Float16Array、显式资源管理 `using` 等语言特性）、**npm 11**、**AsyncLocalStorage 默认改用 AsyncContextFrame**、**权限模型改为 `--permission`**，以及一批弃用与移除（`url.parse()` 运行时弃用、移除 `tls.createSecurePair`、`NODE_MODULE_VERSION` 变为 137 导致原生模块需重编译等）。

## 版本周期（何时该用哪个）

| 版本 | 代号 | 初始发布 | Active LTS | 维护开始 | EOL |
|---|---|---|---|---|---|
| 22.x | Jod | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| 24.x | Krypton | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |

- 两个都是偶数版、都会走完 LTS 周期；22 目前处于维护阶段，24 是新的 LTS 主力。
- 奇数版（如 23、25）不进 LTS，只作为 Current 过渡。

## Node.js 24 的主要变化（vs 22）

### 语言与运行时（V8 13.6）

- **Float16Array**：新增 Float16 浮点数组类型。
- **显式资源管理**：`using` / `await using` 语法，配合 Symbol.dispose 自动释放资源。
- **RegExp.escape**：正则转义工具函数。
- **Memory64**：Wasm 64 位内存支持；**Error.isError** 跨 realm 错误判断。
- （对比：22 当时的 V8 12.4 带来 Wasm GC、`Array.fromAsync`、iterator helpers 等。）

### 核心 API 与默认行为

- **AsyncLocalStorage 默认实现改为 AsyncContextFrame**（更轻量的上下文传递；可用开关切回旧实现）。
- **全局新增 `URLPattern`**，可用于 URL 模式匹配。
- **权限模型（Permission Model）命令行开关改为 `--permission`**（原 `--experimental-permission`）。
- **npm 升级到 11**；**Undici 升级到 7**（fetch/HTTP 客户端）。
- **测试运行器（test runner）**：自动等待子测试完成，不再需要手动接 `t.test()` 返回的 promise。

### 弃用与移除（升级前重点看）

- **`url.parse()` 运行时弃用**——改用 WHATWG `URL`。
- **移除 `tls.createSecurePair`**。
- **`Buffer.SlowBuffer` 运行时弃用**（且已列入 EOL）。
- 不带 `new` 实例化 REPL、Zlib 类不用 `new`、向 `spawn`/`execFile` 传旧式参数——均标记弃用。
- 移除 HTTP 的 `_headers` / `_headersList`；`fs.truncate` 不再接受文件描述符。
- **corepack 将在 Node.js 25+ 中移除**（如依赖它需尽早自装）。

### 原生模块与平台（兼容性影响最大的部分）

- **`NODE_MODULE_VERSION` 137**（22 为 127 段位的对应旧值）——ABI 变化意味着 **C++ 原生插件需要按 24 重新编译**。
- **armv7 降为 experimental**；移除 ppc32/s390 32 位平台。
- Windows 构建需 ClangCL（不再支持 MSVC）；最低 macOS 13.5、Xcode 16.1。

### Node.js 22 中已有、24 继承的能力（背景）

`node --run <script>`、`require()` 加载同步 ESM 图、`node --watch` 稳定、WebSocket 客户端默认启用、`fs.glob`/`globSync`、流默认 HighWaterMark 64KiB 等在 22 已引入，24 上继续可用。

## 升级建议（TL;DR）

1. 生产环境若还在 22：可继续用到 2027-04-30，但新项目建议直接上 24 LTS。
2. 升级前必查三件事：**原生模块重编译**（ABI 137）、**`url.parse()` 等弃用 API**、**`--permission` 开关改名**。
3. npm 11 / Undici 7 的行为变化在依赖 CI 里先跑一轮回归。

## 官方来源

- Node.js 24.0.0 发布说明：https://nodejs.org/blog/release/v24.0.0
- Node.js 22 发布公告：https://nodejs.org/en/blog/announcements/v22-release-announce
- 官方发布计划（版本周期表）：https://github.com/nodejs/release

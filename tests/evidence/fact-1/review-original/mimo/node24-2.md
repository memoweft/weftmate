# Node.js 24 相比 22 值得留意的变化（简短说明）

> 对比基准：**Node.js 24.0.0（2025-05-06）与 Node.js 22.0.0（2024-04-24）两个初始大版本**的官方发布说明[1][2]。仅依据 Node.js 官方资料，面向下班后快速浏览。

## 1. 版本与生命周期

- Node.js 24.0.0 于 **2025-05-06** 发布，标注为 (Current)；发布说明预告："Node.js 24 will enter long-term support (LTS) in October"（当时为预告，24 线实际进入 LTS 的首个公告页本次未取得）[1]。
- 对照 22.0.0 于 **2024-04-24** 发布，同样是先 Current、"will enter long-term support (LTS) in October" 的节奏[2]。
- 截至捕获时（2026-10-10），官方下载页显示 v24 线当前为 **v24.21.0（LTS）**[4]；24 线的 **24.13.0（2026-01-13）** 已标注 'Krypton' (LTS)[3]。

## 2. 运行时与依赖升级（24.0.0）

- V8 升级到 **13.6**，npm 升级到 **11**（24.0.0 发布说明原文："the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"）[1]。
- 对照侧：22.0.0 的发布说明中列出 "deps: update V8 to 12.4.254.14" 这一 SEMVER-MAJOR 条目[2]（该页未给出 22 侧 npm 版本，本文不写）。
- 内置更新："Node.js 24 includes Undici 7"、"Node.js 24 comes with npm 11"[1]。

## 3. Windows 构建要求变化（重点）

- **"Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."**[1]
- 范围限定：该句只讲"compile Node.js on Windows"（编译 Node.js 本体），不等于原生 addon 不能再编译/加载；Node-API addon 是普通模块 ABI 不匹配的例外。此边界为通用常识性限定，官方此页未就 addon 另作表述。

## 4. 弃用与移除（升级前值得检查代码）

24.0.0 官方原文："Several APIs have been deprecated or removed in this release:"[1]

- `url.parse()` **运行时弃用** —— 改用 WHATWG URL API（"Runtime deprecation of url.parse() - use the WHATWG URL API instead"）。
- **移除** `tls.createSecurePair`（"Removal of deprecated tls.createSecurePair"）。
- `SlowBuffer` 运行时弃用（"Runtime deprecation of SlowBuffer"）。
- 不带 `new` 实例化 REPL 运行时弃用（"Runtime deprecation of instantiating REPL without new"）。
- 不带 `new` 使用 Zlib 类被弃用（"Deprecation of using Zlib classes without new"；此条与下条引文未写 "runtime"）。
- 向 `child_process` 的 `spawn`/`execFile` 传参方式被弃用（"Deprecation of passing args to spawn and execFile in child_process"）。

## 5. API 与 CLI 行为变化

- **AsyncContextFrame 默认启用**、**URLPattern 成为全局**："The AsyncLocalStorage API now uses AsyncContextFrame by default, and URLPattern is available globally."[1]
- 权限模型标记更名："the flag has been changed from --experimental-permission to simply --permission"[1]。
- 测试运行器子测试自动等待："The test runner module now automatically waits for subtests to finish"（主语是测试运行器模块，非全部 test API）[1]。

## 6. 22 起点已有的亮点（避免误判为 24 新增）

22.0.0 发布说明的 Highlights："require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!"[2] —— 即 **require() 加载同步 ESM 图、WebSocket 客户端默认启用**等在 22 起点即已列出，不应算作 24 的新增。此外 22.0.0 页还列出 `node --run`、`fs.glob`/`globSync`、`--watch` 转稳定等条目[2]。

## 7. 升级检查清单（面向 22 → 24）

1. 搜索代码中的 `url.parse()`、`tls.createSecurePair`、`SlowBuffer`、无 `new` 的 Zlib/REPL 用法、`spawn`/`execFile` 的旧传参方式[1]。
2. 自建 Windows 二进制的环境改用 **ClangCL**（MSVC 不再支持）[1]。
3. 脚本/文档中的 `--experimental-permission` 改为 `--permission`[1]。
4. 依赖 V8 13.6 / npm 11 / Undici 7 的兼容性做一轮回归[1]。

> 未能确认项：22.0.0 自带 npm 的具体版本号、24 线实际进入 LTS 的首个官方公告日期 —— **未在官方资料中确认**（本文未将其作为事实陈述）。

---

## 出处

[1] [Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0)，capturedAt：2026-10-10T02:59:09.316Z。关键引文："2025-05-06, Version 24.0.0 (Current)"；"the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"；"Several APIs have been deprecated or removed in this release:"；"Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."；"The AsyncLocalStorage API now uses AsyncContextFrame by default, and URLPattern is available globally."；"Node.js 24 will enter long-term support (LTS) in October, but until then, it will be the \"Current\" release for the next six months."

[2] [Node.js 22.0.0 (Current)](https://nodejs.org/en/blog/release/v22.0.0)，capturedAt：2026-10-10T03:01:06.556Z。关键引文："2024-04-24, Version 22.0.0 (Current), @RafaelGSS and @marco-ippolito"；"Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more! As a reminder, Node.js 22 will enter long-term support (LTS) in October, but until then, it will be the \"Current\" release for the next six months."；"(SEMVER-MAJOR) deps: update V8 to 12.4.254.14 (Michaël Zasso) #52465"。

[3] [Node.js 24.13.0 'Krypton' (LTS)](https://nodejs.org/en/blog/release/v24.13.0)，capturedAt：2026-10-10T02:58:32.679Z。关键引文："2026-01-13, Version 24.13.0 'Krypton' (LTS)"。

[4] [Node.js — Downloads](https://nodejs.org/en/download)，capturedAt：2026-10-10T02:58:32.723Z。关键引文："v24.21.0"；"LTS"。

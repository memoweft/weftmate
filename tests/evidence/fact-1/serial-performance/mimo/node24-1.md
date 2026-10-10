# Node.js 24 相比 Node.js 22 的变化（简短说明）

> 对比基准：两个大版本的**初始发布**（Node.js 24.0.0 vs Node.js 22.0.0）。官方没有一份“22 vs 24”逐项对比专页，以下差异依据两版官方发布说明整理。文末“出处”附原文与访问时间。

## 一、基本时间线

- **Node.js 24.0.0** 于 2025-05-06 发布，为当时的 "Current" 版本 [1]；官方表示它将在当年 10 月进入 LTS，在此之前六个月为 "Current" [1]。
- **Node.js 22.0.0** 于 2024-04-24 发布，同样是发布时的 "Current" 版本 [3]。
- 截至 2026-10-10 访问官方下载页，24 系列已显示为 LTS（v24.21.0）[2]。

## 二、运行时与工具链升级

| 项目 | Node 22 初始 | Node 24 |
|---|---|---|
| V8 引擎 | 12.4.254.14 [3] | 13.6 [1] |
| npm | 未在官方该页资料中确认具体大版本 | 11 [1] |
| 内置 HTTP 客户端 | — | Undici 7 [1] |

- V8 13.6 随之带来的新 JavaScript 特性包括：`Float16Array`、显式资源管理（Explicit resource management）、`RegExp.escape`、WebAssembly Memory64、`Error.isError` [1]。
- Windows 上**编译 Node.js 本体**的要求变化：自 Node.js 24 起移除对 MSVC 的支持，改用 ClangCL [1]（此处仅指编译 Node.js 本体，不等同于对所有原生插件的结论）。

## 三、API 与行为变化（24 的重点）

- **AsyncLocalStorage** 默认改用 `AsyncContextFrame` 实现，官方称其为更高效的异步上下文跟踪实现 [1]。
- **`URLPattern` 成为全局对象**，无需显式 import 即可使用 [1]。
- **权限模型**：实验性 Permission Model 的命令行标志由 `--experimental-permission` 改为 `--permission`，官方称这表明其稳定性提升、可被更广泛采用 [1]。
- **测试运行器**：`node:test` 现在会自动等待子测试（subtests）结束，无需手动 await 测试 promise [1]。

## 四、弃用与移除（24.0.0）

- **运行时弃用**：`url.parse()`（官方建议改用 WHATWG URL API）、`SlowBuffer`、不加 `new` 直接实例化 REPL [1]。
- **移除**：已弃用的 `tls.createSecurePair` 被移除 [1]。
- **弃用**：不加 `new` 使用 Zlib 类；向 `child_process` 的 `spawn`/`execFile` 传参的方式被弃用 [1]。

## 五、22 已有的能力（作为对比基线，不是 24 新增）

Node.js 22 的亮点包括 `require()` 加载 ESM 图、WebSocket 客户端，并默认启用 WebSocket、支持 `require()` 同步 ESM 图、`fs.glob`/`globSync`、`node --run` 等 [3]。这些是 22 就已具备的能力，24 是在此基础上的进一步演进。

## 六、升级时值得注意的点

1. Windows 环境若自行编译 Node.js 本体，需要改用 ClangCL 工具链 [1]。
2. 依赖 `url.parse()`、`SlowBuffer`、`tls.createSecurePair` 的代码需迁移或排查 [1]。
3. 使用权限模型脚本时，CLI 标志名已从 `--experimental-permission` 改为 `--permission` [1]。
4. 测试用例若依赖“手动 await 子测试”的写法，行为可能变化 [1]。

---

## 出处

[1] [Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0)（capturedAt: 2026-10-10T04:29:06.488Z；弃用与移除段 capturedAt: 2026-10-10T04:29:11.577Z）：
- "2025-05-06, Version 24.0.0 (Current), @RafaelGSS and @juanarbol"
- "the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"
- "Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."
- "The AsyncLocalStorage API now uses AsyncContextFrame by default"
- "The URLPattern API is now exposed on the global object"
- "the flag has been changed from --experimental-permission to simply --permission"
- "The test runner module now automatically waits for subtests to finish"
- "Node.js 24 includes Undici 7"
- "The V8 engine is updated to version 13.6, which includes several new JavaScript features: ... Float16Array ... Explicit resource management ... RegExp.escape ... WebAssembly Memory64 ... Error.isError"
- "Node.js 24 will enter long-term support (LTS) in October, but until then, it will be the \"Current\" release for the next six months."
- "Several APIs have been deprecated or removed in this release: Runtime deprecation of url.parse() - use the WHATWG URL API instead ... Removal of deprecated tls.createSecurePair ... Runtime deprecation of SlowBuffer ... Runtime deprecation of instantiating REPL without new ... Deprecation of using Zlib classes without new ... Deprecation of passing args to spawn and execFile in child_process"

[2] [Node.js — Downloads](https://nodejs.org/en/download)（capturedAt: 2026-10-10T04:28:50.260Z）："v24.21.0 LTS"

[3] [Node.js 22.0.0 (Current)](https://nodejs.org/en/blog/release/v22.0.0)（capturedAt: 2026-10-10T04:29:05.733Z）：
- "2024-04-24, Version 22.0.0 (Current), @RafaelGSS and @marco-ippolito"
- "Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine"
- "(SEMVER-MAJOR) deps: update V8 to 12.4.254.14"
- "lib: enable WebSocket by default" / "module: support require()ing synchronous ESM graphs" / "fs: expose glob and globSync" / "cli: implement node --run <script-in-package-json>"

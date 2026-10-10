# Node.js 24 相比 22 值得留意的变化（简短版）

> 对比基准：**Node.js 24 初版（v24.0.0，2025-05-06 发布）** 相比 **Node.js 22 初版（v22.0.0，2024-04-24 发布）**，只看官方发布说明中的主要变化，不展开后续小版本回移、支持日历与依赖明细。下班后扫一遍即可，重点看第 1、4、5 节。

## 1. 一句话总览

Node.js 24 初版的主线是：V8 升到 13.6、npm 升到 11、`AsyncLocalStorage` 默认改用 `AsyncContextFrame`、`URLPattern` 成为全局对象、权限模型标志改为 `--permission`；另外在 Windows 上**不再支持 MSVC，编译必须用 ClangCL**——这是对自建或打包场景最需要先确认的一条 [1]。

## 2. 语言与运行时能力（主要来自 V8 13.6）

24 的 V8 从 22 时代的 12.4 升至 13.6，带来这些 JavaScript 侧新特性 [1]：

- `Float16Array`
- 显式资源管理（Explicit resource management）
- `RegExp.escape`
- WebAssembly Memory64
- `Error.isError`

对日常业务代码通常是“可用即可用”，原生模块（addons）则要留意 ABI 变化：24 的 `NODE_MODULE_VERSION` 已更新为 134（SEMVER-MAJOR 提交）[1]，从 22 迁移时原生模块需要重编。

## 3. 附带的工具链升级

- **npm 11**：24 内置 npm 从 22 时代的版本升到 11，官方描述为性能、安全性与现代 JS 包兼容性的改进 [1]。
- **Undici 7**：内置 HTTP 客户端能力更新，含性能与较新 HTTP 特性支持 [1]。

## 4. 值得测试的 API 行为变化

- **`AsyncLocalStorage` 默认使用 `AsyncContextFrame`**：官方称这是更高效的异步上下文跟踪实现，性能与高级场景健壮性均有提升 [1]。依赖 `AsyncLocalStorage` 做链路追踪的服务建议跑一遍回归。
- **`URLPattern` 全局可用**：无需显式 import 即可使用，像正则匹配字符串一样做 URL 模式匹配 [1]。
- **权限模型标志更名**：`--experimental-permission` 改为 **`--permission`**，官方解释为“稳定性提升、面向更广泛采用”；如果你的启动脚本或容器参数里写的是旧标志，需要同步改 [1]。
- **测试运行器自动等待子测试**：`test()` / `t.test()` 不再需要手动 await 子测试，且 `t.test()`、`test()` 返回的 Promise 已被移除（SEMVER-MAJOR）[1]。旧测试里如果有 `await t.test(...)` 的写法，迁移时要按新模型调整。

## 5. 弃用与移除（升级前先过一遍）

24 初版明确列出的弃用/移除项 [1]：

| 变化 | 迁移动作 |
| --- | --- |
| `url.parse()` 运行时弃用 | 改用 WHATWG `URL` API |
| 移除 `tls.createSecurePair()` | 改用 `tls` 的现代 API |
| `SlowBuffer` 运行时弃用 | 用普通 `Buffer` |
| 不加 `new` 直接实例化 REPL 运行时弃用 | 补上 `new` |
| 不加 `new` 使用 Zlib 类 | 补上 `new` |
| `child_process` 的 `spawn` / `execFile` 传参数方式弃用（passing args） | 按新签名调整调用 |

此外还有一些 SEMVER-MAJOR 级别的调整，例如移除 `http` 的 `_headers` / `_headersList`、`fs` 中以 `truncate` 相关的受限调用方式等，具体以 24 的提交清单为准 [1]。

## 6. 相对 22 基线，哪些是“新话题”

22 初版的亮点是 `require()` 加载同步 ESM 图、内置 WebSocket 客户端、`node --run`、`fs.glob`/`globSync`、watch 模式转稳定，以及 V8 12.4 [2]。也就是说：**如果你还停在 22，这些在 24 里依然存在**；24 额外叠加的是上面第 2–5 节的内容。22→24 之间各小版本是否回移了某些改动，未在官方资料中确认，需要逐版本核对发行说明。

## 7. 迁移前的三个检查点

1. **Windows 构建/打包链路**：确认已改用 ClangCL，MSVC 路径不再受支持 [1]。
2. **原生模块**：按 `NODE_MODULE_VERSION = 134` 重新编译 [1]。
3. **启动参数与测试代码**：`--permission` 更名、测试运行器不再返回 `t.test()` 的 Promise、`url.parse()` 等弃用项逐条替换 [1]。

生命周期提示：24 于 2025-05-06 作为 Current 发布，并将于 2025 年 10 月进入 LTS [1]；具体支持截止时间未在本文所引资料中确认，如需排期请另行查阅官方支持计划。

---

## 出处

[1] [Node.js 24.0.0 (Current) — Node.js 官方博客](https://nodejs.org/en/blog/release/v24.0.0)，capturedAt：2026-10-10T02:48:09.138Z。原文摘录：

> "We're excited to announce the release of Node.js 24! This release brings several significant updates, including the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11. Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."

> "The V8 engine is updated to version 13.6, which includes several new JavaScript features: Float16Array / Explicit resource management / RegExp.escape / WebAssembly Memory64 / Error.isError"

> "AsyncLocalStorage now uses AsyncContextFrame by default, which provides a more efficient implementation of asynchronous context tracking."

> "The flag has been changed from --experimental-permission to simply --permission, indicating its increasing stability and readiness for broader adoption."

> "The test runner module now automatically waits for subtests to finish, eliminating the need to manually await test promises."

> "Deprecations and Removals — Runtime deprecation of url.parse() - use the WHATWG URL API instead (#55017) / Removal of deprecated tls.createSecurePair (#57361) / Runtime deprecation of SlowBuffer (#55175) ..."

> "As a reminder, Node.js 24 will enter long-term support (LTS) in October, but until then, it will be the \"Current\" release for the next six months."

> "[7917b67313] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 134 (Michaël Zasso) #55014"

> "2025-05-06, Version 24.0.0 (Current), @RafaelGSS and @juanarbol"

[2] [Node.js 22.0.0 (Current) — Node.js 官方博客](https://nodejs.org/en/blog/release/v22.0.0)，capturedAt：2026-10-10T02:48:20.510Z。原文摘录：

> "We're excited to announce the release of Node.js 22! Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!"

> "2024-04-24, Version 22.0.0 (Current), @RafaelGSS and @marco-ippolito"

> "(SEMVER-MINOR) cli: implement node --run <script-in-package-json> (Yagiz Nizipli) #52190"

> "(SEMVER-MINOR) fs: expose glob and globSync (Moshe Atlow) #51912"

> "(SEMVER-MINOR) module: support require()ing synchronous ESM graphs (Joyee Cheung) #51977"

> "(SEMVER-MAJOR) deps: update V8 to 12.4.254.14 (Michaël Zasso) #52465"

> "(SEMVER-MAJOR) lib: enable WebSocket by default (Aras Abbasi) #51594"

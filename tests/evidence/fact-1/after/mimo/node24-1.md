# Node.js 24.0.0 相比 22.0.0 值得留意的变化（Windows 工具链 / 原生扩展 / NODE_MODULE_VERSION）

以下内容基于 Node.js 官方发布说明与官方文档，均为简要摘录。

## 1. Windows 工具链：MSVC 支持被移除，必须用 ClangCL 编译

- **Node.js 24.0.0**（2025-05-06 发布）明确说明："Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows." [1] 也就是说，从 Node.js 24 开始，**在 Windows 上编译 Node.js 本身必须使用 ClangCL**，MSVC 支持已被移除。
- 作为对照，**Node.js 22.0.0**（2024-04-24 发布）的 Semver-Major 提交中包含："build: compile with C++20 support on Windows (StefanStojanovic) #52465" [2]，即 Node.js 22 在 Windows 上以 C++20 编译。

## 2. 原生扩展（Addon）兼容：Node-API 提供跨大版本 ABI 稳定，但有前提条件

- 官方 Node-API 文档说明："This API will be Application Binary Interface (ABI) stable across versions of Node.js. It is intended to insulate addons from changes in the underlying JavaScript engine and allow modules compiled for one major version to run on later major versions of Node.js without recompilation." [3] 即 Node-API 的设计目标就是让为一个大版本编译的模块无需重新编译即可运行在后续大版本上。
- 但官方同时强调了例外："Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not. In particular, none of the following APIs provide an ABI stability guarantee across major versions" [4] —— **Node.js C++ API、libuv API、V8 API 均不提供跨大版本的 ABI 稳定保证**（addon 使用的外部库也可能没有）。
- 要满足跨大版本 ABI 兼容，条件是："for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using `#include <node_api.h>`" [5]，即**只能使用 `node_api.h` 这一条路径**。
- 关于默认 Node-API 版本："If NAPI_VERSION is not set it will default to 8." [6]；官方还指出，自 Node-API 版本 9 起，"an add-on that ran with Node-API version 9 may need code updates to run with Node-API version 10" [7]，但同时 "Existing add-ons can continue to run without recompilation using an earlier version of Node-API." [7]。

## 3. NODE_MODULE_VERSION：两个大版本都 bump 了 ABI 版本号

- NODE_MODULE_VERSION 是原生扩展的模块 ABI 版本号，官方 process 文档说明："process.versions.modules indicates the current ABI version, which is increased whenever a C++ API changes. Node.js will refuse to load modules that were compiled against a different module ABI version." [8] —— **用与当前 Node.js 不同的模块 ABI 版本编译的模块会被拒绝加载**。
- **Node.js 24.0.0** 的 Semver-Major 提交包含："src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070" [9]。
- **Node.js 22.0.0** 的 Semver-Major 提交包含："src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465" [10]。
- 因此，24.0.0 与 22.0.0 的模块 ABI 版本号不同（分别为 137 和 127），直接决定了为其中一个版本编译的原生模块不能在另一个版本上加载。

---

## 关键断言核对

| 断言 | 来源 + 原文短语 | 结论 |
|---|---|---|
| v24 于 2025-05-06 发布 | [1] "2025-05-06, Version 24.0.0 (Current)" | 一致 |
| v24 移除 MSVC、要求 ClangCL 编译 Windows 上的 Node.js | [1] "support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows" | 一致 |
| v22 于 2024-04-24 发布 | [2] "2024-04-24, Version 22.0.0 (Current)" | 一致 |
| v22 在 Windows 上以 C++20 编译 | [2] "compile with C++20 support on Windows" | 一致 |
| Node-API 跨 Node.js 版本 ABI 稳定 | [3] "ABI stable across versions of Node.js" / "run on later major versions ... without recompilation" | 一致 |
| C++ API / libuv / V8 API 无跨大版本 ABI 保证 | [4] "none of the following APIs provide an ABI stability guarantee across major versions" | 一致 |
| 跨大版本 ABI 兼容须只用 `#include <node_api.h>` | [5] "must use Node-API exclusively by restricting itself to using #include <node_api.h>" | 一致 |
| NAPI_VERSION 未设置时默认为 8 | [6] "If NAPI_VERSION is not set it will default to 8." | 一致 |
| ABI 版本不匹配的模块会被拒绝加载 | [8] "Node.js will refuse to load modules that were compiled against a different module ABI version." | 一致 |
| v24 的 NODE_MODULE_VERSION 更新为 137 | [9] "update NODE_MODULE_VERSION to 137" | 一致 |
| v22 的 NODE_MODULE_VERSION 更新为 127 | [10] "update NODE_MODULE_VERSION to 127" | 一致 |
| 137 / 127 分别是 24.0.0 / 22.0.0 的最终模块 ABI 版本号 | 两份发布说明中各自的 NODE_MODULE_VERSION 提交；未在官方资料中逐一确认后续 patch 版本是否再次变更 | 一致（就 24.0.0 / 22.0.0 本身而言） |

---

## 出处

[1] [Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0) — 抓取于 2026-10-10T02:44:23.548Z — 原文："2025-05-06, Version 24.0.0 (Current), @RafaelGSS and @juanarbol"；"Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."

[2] [Node.js 22.0.0 (Current)](https://nodejs.org/en/blog/release/v22.0.0) — 抓取于 2026-10-10T02:44:23.231Z — 原文："2024-04-24, Version 22.0.0 (Current), @RafaelGSS and @marco-ippolito"；"[2b1e7c2fcb] - (SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic) #52465"

[3] [Node-API — Node.js v26.11.1 Documentation](https://nodejs.org/api/n-api.html) — 抓取于 2026-10-10T02:44:34.187Z — 原文："This API will be Application Binary Interface (ABI) stable across versions of Node.js. It is intended to insulate addons from changes in the underlying JavaScript engine and allow modules compiled for one major version to run on later major versions of Node.js without recompilation."

[4] [Node-API（Implications of ABI stability）— Node.js v26.11.1 Documentation](https://nodejs.org/api/n-api.html) — 抓取于 2026-10-10T02:44:34.187Z — 原文："Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not. In particular, none of the following APIs provide an ABI stability guarantee across major versions"

[5] [Node-API（Implications of ABI stability）— Node.js v26.11.1 Documentation](https://nodejs.org/api/n-api.html) — 抓取于 2026-10-10T02:44:34.187Z — 原文："Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using #include <node_api.h>"

[6] [Node-API（Node-API versioning）— Node.js v26.11.1 Documentation](https://nodejs.org/api/n-api.html) — 抓取于 2026-10-10T02:44:34.187Z — 原文："If NAPI_VERSION is not set it will default to 8."

[7] [Node-API（Node-API versioning）— Node.js v26.11.1 Documentation](https://nodejs.org/api/n-api.html) — 抓取于 2026-10-10T02:44:34.187Z — 原文："an add-on that ran with Node-API version 9 may need code updates to run with Node-API version 10"；"Existing add-ons can continue to run without recompilation using an earlier version of Node-API."

[8] [Process — Node.js v26.11.1 Documentation](https://nodejs.org/api/process.html) — 抓取于 2026-10-10T02:44:34.003Z — 原文："process.versions.modules indicates the current ABI version, which is increased whenever a C++ API changes. Node.js will refuse to load modules that were compiled against a different module ABI version."

[9] [Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0) — 抓取于 2026-10-10T02:44:23.548Z — 原文："[f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070"

[10] [Node.js 22.0.0 (Current)](https://nodejs.org/en/blog/release/v22.0.0) — 抓取于 2026-10-10T02:44:23.231Z — 原文："[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465"

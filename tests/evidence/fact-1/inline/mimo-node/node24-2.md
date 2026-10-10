# Node.js 24.0.0 相比 22.0.0 值得留意的变化

Node.js 24.0.0 于 2025-05-06 发布（Current），22.0.0 于 2024-04-24 发布（Current）。[1][3]

## Windows 工具链

- **编译 Node.js 本身的工具链发生切换**：24 起 Windows 上不再支持 MSVC，改用 ClangCL——官方原文为 "Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."。该结论的主体是"在 Windows 上编译 Node.js"本身，不自动扩大到"用什么工具链编译原生扩展"（后者未在官方资料中确认）。[1]
- 22.0.0 版本页的 changelog 中列出了在 Windows 上以 C++20 编译（"build: compile with C++20 support on Windows"）以及为 MSVC 打 V8 补丁（"deps: patch V8 to support compilation with MSVC"）的 SEMVER-MAJOR 提交标题。这些是版本页提交记录的证据，不用于推导 24 的工具链结论。[3]

## 原生扩展兼容（Node-API / ABI）

- 官方 Node-API 文档说明，Node-API 是跨 Node.js 版本 ABI 稳定的，可"allow modules compiled for one major version to run on later major versions of Node.js without recompilation"。[2]
- 但这一保证有明确边界：同一节也指出 "none of the following APIs provide an ABI stability guarantee across major versions"，清单包括 `node.h` 等 Node.js C++ API、`uv.h`（libuv）、`v8.h`（V8）等；因此扩展**必须** "use Node-API exclusively by restricting itself to using #include <node_api.h>" 才能获得跨主版本 ABI 兼容。[2]
- 若扩展还依赖外部库，官方要求该外部库自身有类似的 ABI 稳定保证（"similar guarantees"），否则不随之获得兼容性。[2]

## NODE_MODULE_VERSION

- 本次查阅的官方版本页中，**未在官方资料中确认** 24.0.0 与 22.0.0 最终发布的 NODE_MODULE_VERSION 数值。
- 版本页 changelog 里可见的是提交标题：24.0.0 页列出 "src: update NODE_MODULE_VERSION to 137"，同页还列出 "to 134"；22.0.0 页列出 "to 127"，同页还有 "to 126"、"to 124"、"to 122"。提交标题不等于该版本的最终发布值，且同一页可包含多个不同数值，故本文不据此断言最终数值。[1][3]

## 其他 24 值得留意的变化

- V8 升级到 13.6，npm 升级到 11（"the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"）。[1]
- `AsyncLocalStorage` 默认改用 `AsyncContextFrame`（"AsyncLocalStorage now uses AsyncContextFrame by default"）。[1]
- `URLPattern` 成为全局对象（"URLPattern is available globally"）。[1]
- 权限模型标记改名：`--experimental-permission` 改为 `--permission`（"the flag has been changed from --experimental-permission to simply --permission"）。[1]
- 内置 Undici 7（"Node.js 24 includes Undici 7"）。[1]
- 作为对比，22.0.0 的亮点包括 `require()` 加载 ESM、WebSocket 客户端等（"Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!"），并实现了 `node --run`。[3]

---

## 出处

[1] [Node.js 24.0.0 Release](https://nodejs.org/en/blog/release/v24.0.0)，最终 URL：https://nodejs.org/en/blog/release/v24.0.0，capturedAt：2026-10-10T03:43:05.246Z。
支持引文："2025-05-06, Version 24.0.0 (Current)"；"the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"；"Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."；"AsyncLocalStorage now uses AsyncContextFrame by default"；"URLPattern is available globally"；"the flag has been changed from --experimental-permission to simply --permission"；"Node.js 24 includes Undici 7"；提交标题 "[f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070"、"[7917b67313] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 134 (Michaël Zasso) #55014"。

[2] [Node.js API 文档 — Implications of ABI stability](https://nodejs.org/api/n-api.html#implications-of-abi-stability)，最终 URL：https://nodejs.org/api/n-api.html#implications-of-abi-stability，capturedAt：2026-10-10T03:43:08.408Z。
支持引文："This API will be Application Binary Interface (ABI) stable across versions of Node.js … allow modules compiled for one major version to run on later major versions of Node.js without recompilation."；"none of the following APIs provide an ABI stability guarantee across major versions"（清单含 `node.h` 等 Node.js C++ API、`uv.h`、`v8.h`）；"it must use Node-API exclusively by restricting itself to using #include <node_api.h>"；外部库需有类似保证。

[3] [Node.js 22.0.0 Release](https://nodejs.org/en/blog/release/v22.0.0)，最终 URL：https://nodejs.org/en/blog/release/v22.0.0，capturedAt：2026-10-10T03:42:53.641Z。
支持引文："2024-04-24, Version 22.0.0 (Current)"；"Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!"；"[2b1e7c2fcb] - (SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic)"；"[d0361f0bba] - (SEMVER-MAJOR) deps: patch V8 to support compilation with MSVC (StefanStojanovic)"；"cli: implement node --run"；提交标题 "[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465"（同页另有 to 126、to 124、to 122 提交）。

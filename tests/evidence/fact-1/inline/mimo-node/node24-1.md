# Node.js 24.0.0 相比 22.0.0 值得留意的变化

> 对比基准：两个版本各自的初始 official release blog（24.0.0 发布于 2025-05-06，22.0.0 发布于 2024-04-24 [1][2]），不涉及后续 backport。

## 一、Windows 工具链（最需要留意）

- **Node.js 24 在 Windows 上已彻底放弃 MSVC**：官方发布公告写明 "Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows." [1]。即在 Windows 上**编译 Node.js 本体**需要 ClangCL 工具链。
- 回看 22.0.0：其发布说明中列有 "(SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic) #52465" [2]，说明 22 这一代还在以 MSVC 路线打 C++20 补丁，到 24 这一代才转向 ClangCL。

> 注意：此要求针对"compile Node.js on Windows"（编译 Node.js 本身）。**原生扩展**是否也必须换工具链，上述两页未作出此断言，未在官方资料中确认。

## 二、原生扩展兼容性

- **Node-API 是唯一的跨大版本 ABI 稳定通道**。官方文档："This API will be Application Binary Interface (ABI) stable across versions of Node.js. It is intended to insulate addons from changes in the underlying JavaScript engine and allow modules compiled for one major version to run on later major versions of Node.js without recompilation." [3]
- **例外必须留意**："Although Node-API provides an ABI stability guarantee, other parts of Node.js do not"——`node.h`、`uv.h`、`v8.h` 等 API "none ... provide an ABI stability guarantee across major versions"；因此 "for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using `#include <node_api.h>`" [3]。
- 也就是说：只用 V8/libuv/Node C++ 接口写的老式扩展，从 22 升到 24 大概率要重编译；只用 Node-API 的扩展可"跨大版本不重编译"。

## 三、NODE_MODULE_VERSION

- 22.0.0 的发布说明列出 "(SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465" [2]；24.0.0 的发布说明列出 "(SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070" [1]。
- 该值即 `process.versions.modules`："process.versions.modules indicates the current ABI version, which is increased whenever a C++ API changes. Node.js will refuse to load modules that were compiled against a different module ABI version." [4]
- 实践含义：**为 22 编译的非 Node-API 原生模块在 24 下会因 ABI 版本不匹配被拒绝加载**；只有 Node-API 模块可豁免重编译 [3]。

## 四、其他亮点（24 vs 22）

- **V8 引擎**：24 为 "The V8 engine is updated to version 13.6" [1]；22 为 "(SEMVER-MAJOR) deps: update V8 to 12.4.254.14" [2]。
- **npm**："Node.js 24 comes with npm 11" [1]（22.0.0 未在起始页列明 npm 大版本）。
- **AsyncLocalStorage**："AsyncLocalStorage now uses AsyncContextFrame by default" [1]。
- **其他全局/CLI**：24 起 "URLPattern is available globally" [1]；22 起默认启用 WebSocket（"lib: enable WebSocket by default"）、新增 `node --run` 与 `fs.glob`/`globSync`（"cli: implement node --run <script-in-package-json>"、"fs: expose glob and globSync"）[2]。
- **支持状态**：两版发布时均为 Current，22 与 24 都在发布后当年 10 月进入 LTS（"Node.js 22 will enter long-term support (LTS) in October" [2]；"Node.js 24 will enter long-term support (LTS) in October" [1]）。

---

## 出处

1. [Node.js 24.0.0 Release | Node.js](https://nodejs.org/en/blog/release/v24.0.0) — URL: https://nodejs.org/en/blog/release/v24.0.0 — capturedAt: 2026-10-10T03:37:49.007Z — 支撑原文："Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."；"The V8 engine is updated to version 13.6"；"Node.js 24 comes with npm 11"；"AsyncLocalStorage now uses AsyncContextFrame by default"；"[f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070"；"Node.js 24 will enter long-term support (LTS) in October"
2. [Node.js 22.0.0 Release | Node.js](https://nodejs.org/en/blog/release/v22.0.0) — URL: https://nodejs.org/en/blog/release/v22.0.0 — capturedAt: 2026-10-10T03:37:48.619Z — 支撑原文："2024-04-24, Version 22.0.0 (Current)"；"(SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic) #52465"；"(SEMVER-MAJOR) deps: update V8 to 12.4.254.14"；"[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465"；"lib: enable WebSocket by default"；"cli: implement node --run <script-in-package-json>"；"fs: expose glob and globSync"；"Node.js 22 will enter long-term support (LTS) in October"
3. [Node-API — Implications of ABI stability | Node.js API](https://nodejs.org/api/n-api.html) — URL: https://nodejs.org/api/n-api.html#implications-of-abi-stability — capturedAt: 2026-10-10T03:37:58.851Z — 支撑原文："This API will be Application Binary Interface (ABI) stable across versions of Node.js. ... allow modules compiled for one major version to run on later major versions of Node.js without recompilation."；"Although Node-API provides an ABI stability guarantee, other parts of Node.js do not ... none of the following APIs provide an ABI stability guarantee across major versions"；"for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using #include <node_api.h>"
4. [Process | Node.js API](https://nodejs.org/api/process.html) — URL: https://nodejs.org/api/process.html — capturedAt: 2026-10-10T03:37:59.805Z — 支撑原文："process.versions.modules indicates the current ABI version, which is increased whenever a C++ API changes. Node.js will refuse to load modules that were compiled against a different module ABI version."

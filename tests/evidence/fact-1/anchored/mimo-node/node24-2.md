# Node.js 24.0.0 相比 22.0.0 值得留意的变化

本文对比 Node.js 24.0.0（2025-05-06 发布）与 22.0.0（2024-04-24 发布）的官方发布说明，聚焦 Windows 工具链、原生扩展兼容与 `NODE_MODULE_VERSION` 三个方面。

## 1. Windows 工具链：MSVC 被移除，ClangCL 成为必需

- **24.0.0**：官方发布说明明确写道，"Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows." [1] 也就是说，从 Node.js 24 起，**编译 Node.js 本身**不再支持 MSVC，Windows 上必须使用 ClangCL 工具链。
- **22.0.0**：该版本有一条构建相关的 SEMVER-MAJOR 变更——"[2b1e7c2fcb] - (SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic) #52465" [2]，即 Windows 上改用支持 C++20 的方式编译。

需要注意的是，上述 MSVC→ClangCL 的要求针对的是**构建 Node.js 核心本体**；它并不意味着"不能编写基于 V8/Node.js 头文件的原生扩展"这类结论——官方资料中未在该条目下对扩展构建工具作此延伸表述。

## 2. 原生扩展兼容：Node-API 才是跨大版本 ABI 兼容的前提

Node-API 的官方文档说明了兼容边界：

- Node-API "is intended to insulate addons from changes in the underlying JavaScript engine and allow modules compiled for one major version to run on later major versions of Node.js without recompilation." [3]（让为一个大版本编译的模块可以在之后的大版本上不重新编译而运行。）
- 但"Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not." [3] 文档明确列出 `node.h`、`uv.h`、`v8.h` 相关 API 均不提供跨大版本 ABI 稳定保证。
- 因此"for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using `#include <node_api.h>` … and by checking, for all external libraries that it uses, that the external library makes ABI stability guarantees similar to Node-API." [3]

结论：从 22 升级到 24 时，**只使用 Node-API 的原生扩展**有跨大版本 ABI 兼容的基础；直接使用 V8/`node.h`/`uv.h` API 的扩展则需按新版本重新编译，并需自行确认外部依赖库的 ABI 保证。

## 3. NODE_MODULE_VERSION

两个大版本都对 `NODE_MODULE_VERSION` 做了 SEMVER-MAJOR 更新：

- **Node.js 24.0.0**："[f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070" [1] —— 即 **137**。
- **Node.js 22.0.0**："[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465" [2] —— 即 **127**。

`NODE_MODULE_VERSION` 是原生模块 ABI 的版本号：该值在 22 与 24 之间发生变化，意味着**面向某一版本编译、且未使用 Node-API 的传统原生模块，不能直接在另一版本加载**，需要按目标版本重新编译；而按上一节所述仅使用 Node-API 的模块不受此重编译要求约束（前提是其依赖的外部库也有类似保证）。

## 4. 其他相关变化（补充）

- Node.js 24 升级了 V8 引擎至 13.6、npm 至 11："the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11" [1]。V8 大版本升级同样是原生扩展需要重新评估兼容性的常见触发点。
- Node.js 22.0.0 同期还有 V8 升级等其他 SEMVER-MAJOR 变更（如 "[02b0bc01fe] - (SEMVER-MAJOR) deps: update V8 to 12.4.254.14" [2]）。

---

## 出处

1. [Node.js 24.0.0 Release (nodejs.org)](https://nodejs.org/en/blog/release/v24.0.0) — 访问时间：2026-10-10T04:15:47.625Z
   > "Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows." / "the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11" / "[f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070"
2. [Node.js 22.0.0 Release (nodejs.org)](https://nodejs.org/en/blog/release/v22.0.0) — 访问时间：2026-10-10T04:15:47.543Z
   > "[2b1e7c2fcb] - (SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic) #52465" / "[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465" / "[02b0bc01fe] - (SEMVER-MAJOR) deps: update V8 to 12.4.254.14"
3. [Node-API | Node.js Documentation (nodejs.org)](https://nodejs.org/api/n-api.html) — 访问时间：2026-10-10T04:15:57.228Z
   > "allow modules compiled for one major version to run on later major versions of Node.js without recompilation" / "Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not." / "for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively"

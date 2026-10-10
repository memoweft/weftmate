# Node.js 24.0.0 相比 22.0.0 值得留意的变化

Node.js 24.0.0 于 2025-05-06 发布（发布时为 Current）[1]；Node.js 22.0.0 于 2024-04-24 发布，随后于 2024-10-22 进入 LTS [2]。两者是不同的大版本，以下三点最值得关注。

## 1. Windows 工具链

- Node.js 22 在 Windows 上引入了 C++20 构建支持（"build: compile with C++20 support on Windows"）[2]。
- 从 Node.js 24 起，Windows 上编译 Node.js 本身不再支持 MSVC，ClangCL 成为必需："Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows." [1]。注意该要求针对的是**编译 Node.js 本身**，官方 n-api 文档并未给出"原生扩展必须用 ClangCL"的要求。

## 2. 原生扩展（addon）兼容性

Node-API 提供跨大版本的 ABI 稳定性保证，但 Node.js 的其他部分并不提供："Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not." 具体来说，`#include <node.h>`、`node_buffer.h`、`node_version.h>`、`node_object_wrap.h` 等 API "none of the following APIs provide an ABI stability guarantee across major versions"；扩展所用的外部库也可能没有保证 [3]。

因此规则与例外必须一起看：**普通（非 Node-API）原生模块的 ABI 不跨大版本**，从 22 升到 24 属于跨大版本，这类模块需要按目标版本重新编译；**例外是**，若一个扩展只使用 Node-API（"it must use Node-API exclusively by restricting itself to using" `#include <node_api.h>`），并确认所用外部库提供与 Node-API 类似的 ABI 稳定保证（"the external library makes ABI stability guarantees similar to Node-API"），它就能跨 Node.js 大版本保持 ABI 兼容、无需重编译 [3]。

此外，Windows 上编译 Node.js 24 本身要求 ClangCL（见第 1 节），但这是 Node.js 自身的构建要求，不应扩大理解为对原生扩展工具链的同等要求。

## 3. NODE_MODULE_VERSION

`NODE_MODULE_VERSION` 是原生模块 ABI 的版本号，每个 Node.js 大版本递增：

- Node.js 22.0.0：**127** —— "[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127"（发布页所列最终 update 条目）[2]。
- Node.js 24.0.0：**137** —— "[f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137"（发布页所列最终 update 条目）[1]。

127 与 137 不同，意味着面向 22 编译的普通原生模块不能直接在 24 上加载（反之亦然），需重新编译；仅使用 stable Node-API 的扩展不受此限制（见第 2 节）。

## 其他值得留意的变化

- 24.0.0 升级 V8 至 13.6、npm 至 11 [1]；22.0.0 的 V8 为 12.4.254.14 [2]。
- 24.0.0 中 AsyncLocalStorage 默认改用 AsyncContextFrame，URLPattern 全局可用 [1]。
- 22.0.0 默认启用 WebSocket，并支持 require() 加载 ESM 图 [2]。

---

## 出处

[1] [Node.js — Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0)，capturedAt: 2026-10-10T04:02:16.523Z，逐字引文："Date: 2025-05-06"；"Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."；"the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"；"The AsyncLocalStorage API now uses AsyncContextFrame by default, and URLPattern is available globally."；"[f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070"

[2] [Node.js 22.0.0](https://nodejs.org/en/blog/release/v22.0.0)，capturedAt: 2026-10-10T04:02:16.718Z，逐字引文："Date: 2024-04-24"；"2024-10-22, Node.js 22 (Jod) entered LTS"；"build: compile with C++20 support on Windows (StefanStojanovic)"；"V8 12.4.254.14"；"lib: enable WebSocket by default (Aras Abbasi) #51594"；"[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465"

[3] [Node-API | Node.js Documentation（Implications of ABI stability）](https://nodejs.org/api/n-api.html)，capturedAt: 2026-10-10T04:02:28.343Z，逐字引文："Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not. In particular, none of the following APIs provide an ABI stability guarantee across major versions:"（其后列出 `#include <node.h>` 等）；"Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using" `#include <node_api.h>` "and by checking, for all external libraries that it uses, that the external library makes ABI stability guarantees similar to Node-API."

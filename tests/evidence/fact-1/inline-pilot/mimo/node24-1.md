# Node.js 24.0.0 相比 22.0.0 值得留意的变化（Windows 工具链 / 原生扩展兼容 / NODE_MODULE_VERSION）

> 比较基准：两个大版本的初始正式发布版，即 24.0.0（2025-05-06）与 22.0.0（2024-04-24）[1][2]。

## 1. Windows 工具链：MSVC 被移除，改用 ClangCL

Node.js 24 是最需要留意工具链的一版：官方发布公告明确写道，从 Node.js 24 开始移除对 MSVC 的支持，在 Windows 上编译 Node.js 现在需要 ClangCL [1]。也就是说，如果你此前在 Windows 上用 Visual Studio 的 MSVC 从源码编译 Node.js 本体，升级到 24 需要改用 ClangCL 工具链。

作为对比，Node.js 22.0.0 的变更日志中有「(SEMVER-MAJOR) build: compile with C++20 support on Windows」，即 22 在 Windows 上以 C++20 支持编译 [2]。

注意：以上是编译 Node.js 运行时本体的工具链要求；原生扩展的编译器要求与之相关但不完全等同，见下一节。

## 2. 原生扩展兼容：Node-API 是跨大版本兼容的关键

Node-API（N-API）的设计目标就是二进制接口（ABI）稳定：官方文档称它将「Application Binary Interface (ABI) stable across versions of Node.js」，使「modules compiled for one major version to run on later major versions of Node.js without recompilation」——即为一个大版本编译的模块可以在之后的大版本 Node.js 上无需重新编译即可运行 [3]。

但前提是扩展**只**使用 Node-API。文档同时指出，除 Node-API 外，Node.js 的其他部分不提供跨大版本 ABI 稳定保证，明确列出的包括通过 `#include <node.h>` 使用的 Node.js C++ API 以及随 Node.js 一同提供的 libuv API 等 [3]；要让扩展跨大版本保持 ABI 兼容，"it must use Node-API exclusively" [3]。

原生扩展本身是动态链接的共享对象，可像普通 Node.js 模块一样用 `require()` 加载 [4]；构建工具 node-gyp 随 npm 一起随 Node.js 分发捆绑 [4]。

## 3. NODE_MODULE_VERSION：22.0.0 为 127，24.0.0 为 137

`NODE_MODULE_VERSION` 是 Node.js 的模块 ABI 编号，通过 `process.versions.modules` 暴露。两个版本的 `src/node_version.h` 源码中定义分别是：

| 版本 | NODE_MODULE_VERSION |
| --- | --- |
| 22.0.0 | 127 |
| 24.0.0 | 137 |

- 24.0.0（v24.0.0 tag 的 `src/node_version.h`）：`#define NODE_MODULE_VERSION 137` [6]
- 22.0.0（v22.0.0 tag 的 `src/node_version.h`）：`#define NODE_MODULE_VERSION 127` [7]

行为上，头文件注释写明：「Node.js will refuse to load modules that weren't compiled against its own module ABI number, exposed as the process.versions.modules property.」——Node.js 会拒绝加载不是针对其自身模块 ABI 编号编译的模块 [6]（两个版本的注释一致 [6][7]）。该编号在 C++ 侧发生 ABI 不兼容变更时更新，且「Node.js will not change the module version during a Major release line」——主版本发布线内不会改变 [6][7]。嵌入方也可以通过 `NODE_EMBEDDER_MODULE_VERSION` 覆盖默认值 [6][7]。

含义：22 与 24 的 NODE_MODULE_VERSION 不同（127 → 137），因此**依赖非 Node-API 的原生扩展（直接使用 node.h C++ API、libuv、V8 等）需要为 Node 24 重新编译**；而**只使用 Node-API 的扩展不受此限制**，可跨大版本加载 [3][6][7]。这一点也反映在各自 release 页的变更日志中，两个版本都以 SEMVER-MAJOR 提交更新了该编号（22 系列到 127，24 系列到 137）[1][2]。

## 4. 其他简要变化

- Node.js 24：V8 升级到 13.6、npm 升级到 11；AsyncLocalStorage 默认使用 AsyncContextFrame，URLPattern 全局可用；24 在 2025 年 10 月进入 LTS，此前为 Current [1]。
- Node.js 22.0.0：V8 升级到 12.4.254.14；WebSocket 默认启用；支持 `require()` 同步 ESM 图 [2]。

## 出处

1. [Node.js 24.0.0 (Current) — Node.js](https://nodejs.org/en/blog/release/v24.0.0)（抓取时间：2026-10-10T03:32:15.020Z）——"2025-05-06, Version 24.0.0 (Current)"；"Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."；"the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"；"The AsyncLocalStorage API now uses AsyncContextFrame by default, and URLPattern is available globally."；"Node.js 24 will enter long-term support (LTS) in October"；"(SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070"
2. [Node.js 22.0.0 (Current) — Node.js](https://nodejs.org/en/blog/release/v22.0.0)（抓取时间：2026-10-10T03:32:15.118Z）——"2024-04-24, Version 22.0.0 (Current)"；"(SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic) #52465"；"(SEMVER-MAJOR) deps: update V8 to 12.4.254.14"；"(SEMVER-MAJOR) lib: enable WebSocket by default"；"(SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465"
3. [Node-API | Node.js Documentation](https://nodejs.org/api/n-api.html)（抓取时间：2026-10-10T03:33:01.454Z）——"This API will be Application Binary Interface (ABI) stable across versions of Node.js."；"allow modules compiled for one major version to run on later major versions of Node.js without recompilation"；"none of the following APIs provide an ABI stability guarantee across major versions: the Node.js C++ APIs available via any of #include <node.h> ... the libuv APIs"；"Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively"
4. [C++ addons | Node.js Documentation](https://nodejs.org/api/addons.html)（抓取时间：2026-10-10T03:34:05.817Z；node-gyp 捆绑句另见同页 2026-10-10T03:33:09.214Z 抓取）——"Addons are dynamically-linked shared objects that can be loaded via the require() function as ordinary Node.js modules."；"A version of the node-gyp utility is bundled and distributed with Node.js as part of npm."
5. [Process | Node.js Documentation](https://nodejs.org/api/process.html)（抓取时间：2026-10-10T03:34:13.914Z）——"headersUrl ... can be used for compiling Node.js native add-ons"；"libUrl ... node.lib file ... used for compiling Node.js native add-ons. This property is only present on Windows"（该页未记载 NODE_MODULE_VERSION 数值）
6. [node_version.h at tag v24.0.0 — nodejs/node](https://raw.githubusercontent.com/nodejs/node/v24.0.0/src/node_version.h)（抓取时间：2026-10-10T03:36:08.354Z）——"#define NODE_MODULE_VERSION 137"；"Node.js will refuse to load modules that weren't compiled against its own module ABI number, exposed as the process.versions.modules property."；"Node.js will not change the module version during a Major release line"
7. [node_version.h at tag v22.0.0 — nodejs/node](https://raw.githubusercontent.com/nodejs/node/v22.0.0/src/node_version.h)（抓取时间：2026-10-10T03:36:08.541Z）——"#define NODE_MODULE_VERSION 127"；"Node.js will refuse to load modules that weren't compiled against its own module ABI number, exposed as the process.versions.modules property."；"Node.js will not change the module version during a Major release line"

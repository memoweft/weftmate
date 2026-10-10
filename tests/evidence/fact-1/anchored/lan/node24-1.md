# Node.js 24.0.0 相比 22.0.0 值得留意的变化

## 版本与核心组件

* Node.js 24.0.0 Current 发布于 2025-05-06，Node.js 22.0.0 Current 发布于 2024-04-24。
* Node.js 24.0.0 捆绑 V8 13.6.233.8、npm 11.3.0，`modules` 为 137。
* Node.js 22.0.0 捆绑 V8 12.4.254.14、npm 10.5.1，`modules` 为 127。

> V8 版本更新在 22.0.0 发布说明中明确：
> `(SEMVER-MAJOR) deps: update V8 to 12.4.254.14`[1]
> 24.0.0 发布说明指出：
> `This release brings several significant updates, including the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11.`[2]

## Windows 工具链变化

从 Node.js 24 开始，Windows 编译工具链发生重大变更：

`Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows.`[2]

这意味着在 Windows 上自行编译 Node.js 或相关原生构建时，必须使用 ClangCL，MSVC 已不再受支持。Node.js 22 时期仍基于 MSVC 支持进行 V8 的 MSVC 补丁，如 `deps: patch V8 to support compilation with MSVC`[1]，而 24 已明确移除该支持。

## 原生扩展兼容与 NODE_MODULE_VERSION

`NODE_MODULE_VERSION` / `process.versions.modules` 在两个大版本间不兼容：

* 24.0.0：`modules":"137"`[3]
* 22.0.0：`modules":"127"`[3]

Node-API 提供 ABI 稳定性保证，但 Node.js 其余部分不保证：

`Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not.`[4]

`In particular, none of the following APIs provide an ABI stability guarantee across major versions:`[4]

* `the Node.js C++ APIs available via any of #include <node.h> ...`[4]
* `the libuv APIs which are also included with Node.js and available via #include <uv.h>`[4]
* `the V8 API available via #include <v8.h>`[4]

因此要实现跨大版本的 ABI 兼容，原生扩展必须**仅使用 Node-API**：

`Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using #include <node_api.h>`[4]

使用 Node-API 的模块可通过 `node_api.h` 在 22 → 24 之间保持 ABI 稳定；若依赖 Node.js C++ API、libuv 或 V8 头文件，则必须重新编译，且 `NODE_MODULE_VERSION` 变化会导致旧编译的 `.node` 文件无法加载。

## 实践建议

* 若使用原生扩展，优先采用 Node-API 编写；否则需为 Node 22 和 Node 24 分别编译并发布对应 `modules` 版本的二进制。
* 在 Windows 上构建 Node.js 或相关依赖时，升级到 ClangCL 工具链，停止使用 MSVC。
* 升级运行时前，确认 V8 新特性与废弃 API 的影响，24 版本包含 V8 13.6 及 npm 11 的变更。

## 出处

1. [Node.js — Node.js 22.0.0 (Current)](https://nodejs.org/en/blog/release/v22.0.0) ，捕获于 2026-10-10T04:02:42.473Z，`Node.js 22.0.0 (Current)`、`2024-04-24, Version 22.0.0 (Current)`、`[02b0bc01fe] - (SEMVER-MAJOR) deps: update V8 to 12.4.254.14 (Michaël Zasso) #52465`。

2. [Node.js — Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0) ，捕获于 2026-10-10T04:02:25.060Z，`We’re excited to announce the release of Node.js 24! This release brings several significant updates, including the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11. Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows.`、`V8 13.6`。

3. [Source](https://nodejs.org/dist/index.json) ，捕获于 2026-10-10T04:03:36.416Z，`{"version":"v24.0.0","date":"2025-05-06",...,"npm":"11.3.0","v8":"13.6.233.8","modules":"137",...}`、`{"version":"v22.0.0","date":"2024-04-24",...,"npm":"10.5.1","v8":"12.4.254.14","modules":"127",...}`。

4. [Node-API | Node.js v26.11.1 Documentation](https://nodejs.org/api/n-api.html) ，捕获于 2026-10-10T04:02:28.849Z，`Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not.`、`In particular, none of the following APIs provide an ABI stability guarantee across major versions:`、`Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using #include <node_api.h>`。

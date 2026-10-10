# Node.js 24.0.0 相比 22.0.0 值得留意的变化（Windows 工具链、原生扩展兼容与 NODE_MODULE_VERSION）

> 对比基准：两个版本的初始 major 发布说明（v24.0.0，2025-05-06 发布 [1]；v22.0.0，2024-04-24 发布 [2]），不涉及后续 minor/回移。以下每条关键断言后标 [1][2][3]，文末附出处与逐字引文。

## 1. Windows 工具链：自 24 起移除 MSVC，改为要求 ClangCL

v24.0.0 发布说明开篇明确："Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows." [1] 也就是说，**在 Windows 上编译 Node.js 本体**的工具链要求发生了变化：从 24 起不再支持 MSVC，必须使用 ClangCL。

需要注意两处边界：

- 该限定语是 "to compile Node.js on Windows"（编译 Node.js 本体），发布说明并未把这条要求表述为原生扩展（addon）的编译规则；addon 侧的构建要求应另见 Node-API 文档的工具链章节 [3]。
- 作为背景，v22.0.0 的提交记录中含 "(SEMVER-MAJOR) build: compile with C++20 support on Windows" [2]，说明 22 系列在 Windows 构建上已引入 C++20 相关的 major 变更；但这与 24 的 MSVC→ClangCL 是两次不同的变更。

## 2. 原生扩展兼容：NODE_MODULE_VERSION 与 Node-API 的分工

**NODE_MODULE_VERSION**：v24.0.0 发布说明的 SEMVER-MAJOR 提交列表中列有 `src: update NODE_MODULE_VERSION to 137` [1]；v22.0.0 的对应列表中列有 `src: update NODE_MODULE_VERSION to 127` [2]。这两个数字出现在发布说明的提交列表条目中（提交标题可能经历中间态或回退，若要引用最终生效的常量值，请以对应版本标签下的源码为准）。

对原生扩展的含义：

- **普通模块 ABI**：非 Node-API 的原生扩展与 Node.js 运行时的 ABI 绑定，按 NODE_MODULE_VERSION 匹配；跨大版本时，此类模块通常需针对目标大版本重新编译，否则不匹配。
- **Node-API（`node_api.h`）是普通模块 ABI 不匹配的例外**：Node-API 文档说明，其设计意图是 "allow modules compiled for one major version to run on later major versions of Node.js without recompilation" [3]，即用 Node-API 编写的 addon 可跨大版本运行而无需重编译。
- **稳定范围的边界**：Node-API 的 ABI 稳定保证**不覆盖** addon 使用的外部依赖与其他 Node.js 接口。原文："Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not." [3] 文档进一步列出不提供跨大版本 ABI 稳定保证的接口（`node.h`、`node_buffer.h`、`node_version.h`、`node_object_wrap.h`、`uv.h`、`v8.h`），并要求 addon "must use Node-API exclusively" 才能在大版本间保持 ABI 兼容，且需自行检查外部库是否提供类似的稳定性保证 [3]。其中 `uv.h`（libuv）处还有专门提醒："While libuv only guarantees ABI stability in a major version, its use may result in an addon that does not work across Node.js major versions." [3]

因此，从 22 升级到 24 时：依赖 Node-API 且不直接使用上述不稳定接口/外部库的 addon，可指望跨大版本兼容；其余 addon 以及依赖外部 C/C++ 库的部分，则**可能**需要重编译（"may not" 保证），137 这一数值主要约束的是按 NODE_MODULE_VERSION 匹配的非 Node-API 模块。

## 3. 其他值得留意的变化（24 相对 22 的差异）

- **V8 与 npm**：v24 升级到 "the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11" [1]（V8 13.6 带来 Float16Array、显式资源管理、RegExp.escape 等；npm 11 为随附包管理器升级）。
- **AsyncLocalStorage 默认实现**：v24 起 "The AsyncLocalStorage API now uses AsyncContextFrame by default, and URLPattern is available globally." [1] 即 AsyncLocalStorage 默认改用 AsyncContextFrame，URLPattern 成为全局对象。
- **版本定位**：v22.0.0 的发布说明将其亮点概括为 "Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!" [2]；而 24 是在其基础上的下一轮 Current 发布（22 已进入/进入 LTS 轨道）。
- **权限模型**：24 的发布说明提到实验性 Permission Model 的 flag 由 `--experimental-permission` 改为 `--permission` [1]。

## 4. 迁移检查清单（从 22 到 24）

1. Windows 上若需**从源码编译 Node.js**：准备 ClangCL 工具链（MSVC 不再被支持）[1]。
2. 盘点原生扩展：优先确认是否基于 Node-API（`#include <node_api.h>`）[3]；是则通常可跨大版本免重编译 [3]。
3. 对非 Node-API 模块：按 NODE_MODULE_VERSION（22 为 127、24 为 137，见发布说明提交列表 [1][2]）确认匹配，必要时针对 24 重编译。
4. 检查 addon 直接使用的 `v8.h`/`uv.h`/`node.h` 等接口与外部库：这些不在 ABI 稳定保证内 [3]，跨大版本需自行验证或重编译。
5. 关注运行时行为变化：AsyncContextFrame 默认启用、URLPattern 全局化、权限 flag 改名 [1]。

---

## 出处

[1] [Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0) — 标题：`Node.js — Node.js 24.0.0 (Current)`；capturedAt：`2026-10-10T03:20:12.828Z`（发布日期句另见同页 `2026-10-10T03:22:39.679Z` 抓取）。逐字引文：
- "2025-05-06, Version 24.0.0 (Current), @RafaelGSS and @juanarbol"
- "Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."
- "including the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"
- "The AsyncLocalStorage API now uses AsyncContextFrame by default, and URLPattern is available globally."
- "f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137 (Michaël Zasso) #58070"

[2] [Node.js 22.0.0 (Current)](https://nodejs.org/en/blog/release/v22.0.0) — 标题：`Node.js — Node.js 22.0.0 (Current)`；capturedAt：`2026-10-10T03:20:13.718Z`（发布日期句另见同页 `2026-10-10T03:22:39.901Z` 抓取）。逐字引文：
- "2024-04-24, Version 22.0.0 (Current), @RafaelGSS and @marco-ippolito"
- "Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!"
- "[2b1e7c2fcb] - (SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic) #52465"
- "[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127 (Michaël Zasso) #52465"

[3] [Node-API | Node.js v26.11.1 Documentation](https://nodejs.org/api/n-api.html) — capturedAt：`2026-10-10T03:20:26.140Z`。逐字引文：
- "It is intended to insulate addons from changes in the underlying JavaScript engine and allow modules compiled for one major version to run on later major versions of Node.js without recompilation."
- "Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not. In particular, none of the following APIs provide an ABI stability guarantee across major versions:"
- "Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using"
- "and by checking, for all external libraries that it uses, that the external library makes ABI stability guarantees similar to Node-API."
- "While libuv only guarantees ABI stability in a major version, its use may result in an addon that does not work across Node.js major versions."

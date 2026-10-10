# Node.js 24.0.0 相比 22.0.0 值得留意的变化

本文聚焦三个方面：Windows 工具链、原生扩展兼容、NODE_MODULE_VERSION。基于 Node.js 官方发布说明与官方文档。

## 1. Windows 工具链：MSVC 被移除，必须使用 ClangCL

这是对 Windows 上需要**编译 Node.js 本身或依赖其构建环境**的开发者影响最直接的变化。

- **Node.js 24.0.0**（2025-05-06 发布）官方公告明确写道：

  > "Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."

  即：从 Node.js 24 起**不再支持 MSVC**，在 Windows 上编译 Node.js 现在**要求 ClangCL**。
  来源：[Node.js 24.0.0 发布公告](https://nodejs.org/en/blog/release/v24.0.0)

- 作为对比，**Node.js 22.0.0**（2024-04-24 发布）时期的方向恰恰相反——其 Semver-Major 提交中包含与 MSVC 相关的工作（例如 "deps: patch V8 to support compilation with MSVC"、"build: compile with C++20 support on Windows"），即当时仍在维护/完善 MSVC 编译路径。
  来源：[Node.js 22.0.0 发布公告](https://nodejs.org/en/blog/release/v22.0.0)

**影响**：如果你维护自定义的 Node.js 构建脚本、CI 流水线或依赖 MSVC 构建工具链的项目，升级到 24.x 需要切换到 ClangCL 工具链；构建 22.x 时使用 MSVC 的方式在 24.x 上不再适用。

## 2. 原生扩展（Addons）兼容性：关键看是否只用 Node-API

官方 Node-API 文档对 ABI 稳定性有明确说明：

- Node-API (N-API) 的设计目标是 ABI 稳定，官方原文：

  > "It is intended to insulate addons from changes in the underlying JavaScript engine and **allow modules compiled for one major version to run on later major versions of Node.js without recompilation**."

  即：**只使用 Node-API 的原生扩展，为一个大版本编译后，可以在后续大版本 Node.js 上运行而无需重新编译**。
  来源：[Node-API 文档](https://nodejs.org/api/n-api.html)

- 但这一保证**有明确边界**。官方 "Implications of ABI stability" 一节指出，以下 API **不提供**跨大版本的 ABI 稳定性保证：
  - Node.js C++ API：`#include <node.h>`、`<node_buffer.h>`、`<node_version.h>`、`<node_object_wrap.h>`
  - libuv API：`#include <uv.h>`
  - V8 API：`#include <v8.h>`

  官方结论原文：

  > "Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using `#include <node_api.h>`"
  来源：[Node-API — Implications of ABI stability](https://nodejs.org/api/n-api.html#implications-of-abi-stability)

- **node-addon-api**（官方 C++ 包装层）不受影响：文档说明它是 header-only 的 C++ 包装，编译出的二进制只依赖 Node.js 导出的 Node-API C 符号，因此"still gets the benefits of the ABI stability"。

**影响**：从 22 升级到 24 时，
- 仅用 `node_api.h`（或 node-addon-api）的原生扩展 → 可望无需重编直接运行；
- 用了 `v8.h`、`node.h`、`uv.h` 等的原生扩展 → **不保证**跨大版本兼容，需要针对新大版本重新编译（且因上述工具链变化，Windows 上还要用 ClangCL 重新构建）。

## 3. NODE_MODULE_VERSION

`NODE_MODULE_VERSION` 是原生扩展的 ABI 版本号，用于标识模块所针对的 Node.js 大版本 ABI。Node.js 每进入一个新的大版本（major），该版本号会改变，与之对应的原生二进制扩展不再保证互相兼容——这正是上面第 2 节中"是否需要重新编译"问题的机制所在：

- 使用旧的内部 API（V8 / node.h / libuv）编写的二进制扩展与具体 `NODE_MODULE_VERSION` 绑定，跨大版本（如 22 → 24）加载时需要按新的 ABI 重新编译；
- 而声明并遵守 Node-API 稳定 ABI 的扩展可以跨越这个版本号继续运行。

⚠️ 关于 22.0.0 与 24.0.0 各自**具体的 `NODE_MODULE_VERSION` 数值**，本次核对的官方发布说明和上述文档页面中没有直接列出；该数值以 Node.js 源码 `src/node_version.h` 中的定义为准，建议在引用具体数字前查证该文件。

## 其他与本主题相关的 24.0.0 亮点（简要）

- V8 升级到 13.6，npm 升级到 11；
- `AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现；`URLPattern` 成为全局对象；
- Permission Model 标志由 `--experimental-permission` 改为 `--permission`；
- 测试运行器（test runner）现在会自动等待子测试（subtests）结束；
- 包含 Undici 7。

（22.0.0 的对应亮点如需了解，可参见其发布说明。）

## 说明与限定

- Node.js 24.0.0 于 2025-05-06 发布时为 **Current** 状态；发布公告说明其计划于 2025 年 10 月进入 LTS。本说明中的状态描述以发布时间点为准。
- 关于 `NODE_MODULE_VERSION` 的具体数值：本次核对的页面未直接给出，故未标注数字，以免出错。

## 来源链接

1. [Node.js 24.0.0 官方发布公告](https://nodejs.org/en/blog/release/v24.0.0)
2. [Node.js 22.0.0 官方发布公告](https://nodejs.org/en/blog/release/v22.0.0)
3. [Node-API 文档：Implications of ABI stability](https://nodejs.org/api/n-api.html#implications-of-abi-stability)
4. [Node-API 文档（概览，含 ABI 稳定性说明）](https://nodejs.org/api/n-api.html)

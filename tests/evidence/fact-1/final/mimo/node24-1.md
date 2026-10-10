# Node.js 24.0.0 相比 22.0.0：值得留意的变化

从 Windows 工具链、原生扩展兼容和 `NODE_MODULE_VERSION` 三个角度看，Node.js 24.0.0 相比 22.0.0 最需要留意的是：Windows 构建工具链从 MSVC 转向 ClangCL；原生扩展的二进制兼容要求发生变化；`NODE_MODULE_VERSION` 从 22.0.0 的 127 升至 24.0.0 的 137。[1] [2]

## Windows 工具链

Node.js 24.0.0 发布公告明确写道：“Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows.”[1] 因此，在 Windows 上自行编译 Node.js 或部分本地模块时，应按 24 的要求准备 ClangCL 工具链，而不能再沿用 22 时代对 MSVC 的依赖。22.0.0 的公告则仍列出 Windows 上的 MSVC 相关编译修补记录，并包含“build: compile with C++20 support on Windows”的变更。[2]

这首先影响需要在 Windows 上从源码构建 Node.js 或触发本地编译的场景；使用官方预编译安装包、且依赖不自行编译的普通应用，不必因为这一条就改变安装方式。

## 原生扩展兼容

Node-API 的设计目标是让原生扩展跨 Node.js 主版本保持兼容。官方文档说明，它“is independent from the underlying JavaScript runtime (for example, V8)”并“This API will be Application Binary Interface (ABI) stable across versions of Node.js”；其预期效果是“allow modules compiled for one major version to run on later major versions of Node.js without recompilation”。[3]

但这项保证只适用于 Node-API 本身，不能理解为所有本地二进制组件都能跨主版本通用。官方对 ABI 稳定性的说明指出：“Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not.”其中明确列出，`node.h` 等头文件提供的 Node.js C++ API 不提供跨主版本 ABI 稳定保证，libuv API 也不提供。[3] 因此：

- 只通过 Node-API 或 `node-addon-api` 使用导出 C API 的扩展，原则上仍可利用这项跨主版本 ABI 稳定性；
- 直接使用 Node.js C++ API、libuv 或其他外部库的扩展，不能据此认为可以从 22 直接迁移到 24；
- 即使是 Node-API 扩展，Windows 上的工具链变化和不同编译器层级仍可能影响其构建方式。Node-API 文档将 Node-API 描述为“a C API that ensures ABI stability across Node.js versions and different compiler levels”。[3]

## NODE_MODULE_VERSION

`NODE_MODULE_VERSION` 用于标识原生模块 ABI 版本。Node.js 24.0.0 发布记录中有“(SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137”；Node.js 22.0.0 发布记录中有“(SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127”。[1] [2]

因此，直接依赖内部 Node.js C++ ABI 的原生模块，不能假设 22.0.0 下编译的二进制可直接用于 24.0.0，通常需要针对目标主版本重新编译。依赖 Node-API 的扩展是否需要重编译，要按其实际使用的接口判断，不能只凭 `NODE_MODULE_VERSION` 变化得出必须重编译的结论。[1] [3]

## 迁移时的检查顺序

1. 检查 Windows 构建是否仍以 MSVC 为前提；若是，按 Node.js 24 的要求评估切换到 ClangCL。
2. 区分原生扩展使用的是 Node-API、Node.js C++ API、libuv，还是其他外部库。
3. 对非 Node-API 或含外部二进制依赖的扩展，按 Node.js 主版本重新构建并测试。
4. 保留 `NODE_MODULE_VERSION` 变化检查：24.0.0 为 137，22.0.0 为 127。

除上述兼容问题外，24.0.0 还包含 V8 13.6、npm 11、`AsyncLocalStorage` 默认改用 `AsyncContextFrame`、全局 `URLPattern` 等变化；这些属于功能或运行时行为变化，不等同于原生扩展 ABI 变化。[1]

出处

[1] [Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0)，访问时间：2026-10-10T02:50:58.374Z。“Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows.”；“[f26cab1b85] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 137”。
[2] [Node.js 22.0.0 (Current)](https://nodejs.org/en/blog/release/v22.0.0)，访问时间：2026-10-10T02:50:58.436Z。“[2b1e7c2fcb] - (SEMVER-MAJOR) build: compile with C++20 support on Windows”；“[582ff5037c] - (SEMVER-MAJOR) src: update NODE_MODULE_VERSION to 127”。
[3] [Node-API — Implications of ABI stability](https://nodejs.org/api/n-api.html#implications-of-abi-stability)，访问时间：2026-10-10T02:51:12.765Z。“allow modules compiled for one major version to run on later major versions of Node.js without recompilation”；“Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not.”。

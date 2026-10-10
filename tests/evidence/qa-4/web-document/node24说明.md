# Node.js 24 相比 22 值得留意的变化

> 比较基准：以两个大版本的**初始版本公告**为主（Node.js 22.0.0 与 24.0.0），不展开后续小版本回移。内容整理自 Node.js 官方发布页。

## 1. 运行时与工具链

- **V8 升级**：24 升到 **V8 13.6**，语言层面新增 `Float16Array`、显式资源管理（`using` / `await using`）、`RegExp.escape`、WebAssembly Memory64、`Error.isError` 等。
- **npm 升到 11**：24 随附 npm 11（22 初版随附的 npm 版本不同），涉及性能、安全与现代包兼容性。
- **Windows 构建要求变化**：24 起**移除 MSVC 支持，Windows 编译 Node.js 必须使用 ClangCL**。若你只下载官方预编译包，通常不受影响；若自行编译原生模块/Node 本体，则需要留意工具链。

## 2. 异步上下文与 Web 标准 API

- **`AsyncLocalStorage` 默认改用 `AsyncContextFrame`**：官方称实现更高效、对高级场景更稳健；这是 24 中行为/实现上的重点变化。
- **`URLPattern` 成为全局对象**：无需显式 import，可直接用于 URL 模式匹配（类似字符串上的正则）。

## 3. 安全与测试

- **权限模型参数简化**：实验性的 Permission Model 从 `--experimental-permission` 改为更简洁的 `--permission`，官方表述为稳定性提升、便于更广泛采用。
- **Test Runner 改进**：测试运行器会**自动等待子测试完成**，减少手动 `await` 和未处理 Promise 的常见错误。
- **Undici 7**：内置 HTTP 客户端栈升级，性能与较新 HTTP 能力支持更好。

## 4. 对比 22 时容易混在一起的背景

Node.js 22 初版的重点包括：`require()` 同步加载 ESM 图（当时需 `--experimental-require-module`）、内置 WebSocket 客户端默认启用、`node --watch` 稳定、`node --run` 执行 package.json 脚本实验特性、流默认 HighWaterMark 从 16KiB 提到 64KiB、`node:fs` 新增 `glob`/`globSync`。这些属于 22 的起点特性；24 的增量重点则更偏向 V8 语言能力、AsyncContextFrame、权限模型与工具链变化。

## 5. 升级前建议快速核对

1. 是否依赖 Windows 上的 MSVC 原生编译流程（24 需改用 ClangCL）。
2. 是否依赖 `AsyncLocalStorage` 的深层实现细节或性能假设（24 默认实现已变）。
3. 是否使用 `--experimental-permission`（24 中改为 `--permission`）。
4. 生态依赖是否兼容 npm 11 与 Undici 7。

## 来源

- [Node.js 22 发布公告（v22 release announce）](https://nodejs.org/en/blog/announcements/v22-release-announce)
- [Node.js 24.0.0 官方发布说明](https://nodejs.org/blog/release/v24.0.0)

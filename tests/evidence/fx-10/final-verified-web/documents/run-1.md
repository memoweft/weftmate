# Node.js 24 相比 22 值得留意的变化（简要说明）

整理时间：2026-10-09。基于 Node.js 官方发布博客与官方发布计划。

## 一、先看支持状态

| 版本线 | 代号 | 状态 | 关键日期 |
|---|---|---|---|
| 22.x | Jod | 维护期 LTS | 2024-04 发布，2024-10 进入 LTS，2025-10 起维护期，**2027-04-30 EOL** |
| 24.x | Krypton | 活跃 LTS | 2025-05 发布，2025-10-28 进入活跃 LTS，2026-10-20 起维护期，**2028-04-30 EOL** |

结论：新项目直接上 24；22 仍在维护期（只收关键修复和安全更新），但已落后一代，值得规划迁移。

## 二、24 的主要变化（对比 22）

### 1. 运行时与引擎
- **V8 从 12.4 升到 13.6**，带来一批新的 JS 语言特性：
  - `Float16Array`
  - **显式资源管理**（`using` / `await using`，自动释放资源）
  - `RegExp.escape()`
  - `Error.isError()`
  - WebAssembly Memory64（支持 >4GB 内存）
- **npm 从 10 升到 11**（性能、安全与兼容性改进）。
- **原生模块 ABI 变了**（NODE_MODULE_VERSION 127 → 137）：非 N-API 的 C++ 扩展需要针对 24 重新编译。
- Undici 升到 7，`fetch` 相关的 HTTP 客户端能力和性能更好。

### 2. API 与语言特性
- **`AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现**：异步上下文跟踪更快、更稳健。一般不用改代码，但如果依赖了它的内部实现细节需要回归测试。
- **`URLPattern` 成为全局对象**，不用再 import。
- **权限模型更稳定**：`--experimental-permission` 改名为 `--permission`。
- **测试运行器**：子测试会自动等待完成，不用再手动 `await`。

### 3. 弃用与移除（升级时最容易踩的坑）
- `url.parse()` **运行时弃用** —— 改用 WHATWG `new URL()`。
- `tls.createSecurePair()` 已**移除**。
- `SlowBuffer` 运行时弃用（进入 EOL）。
- `child_process.spawn/execFile` 在 `shell: true` 时**传参数组被弃用**（字符串拼接有注入风险，见 [nodejs/node#57199](https://github.com/nodejs/node/pull/57199)）。
- 不带 `new` 调用 REPL、`Zlib` 类被弃用。

### 4. 构建与平台
- **Windows 上编译 Node 不再支持 MSVC，必须用 ClangCL**（只影响自己编译 Node，不影响使用官方安装包）。
- armv7 支持降级为实验性。

### 5. 22 已有、24 继承的能力（供对照）
22 引入的 `require()` 同步 ESM 图、全局 WebSocket 客户端、`node --run`、`fs.glob/globSync`、`--watch` 稳定化等在 24 中继续可用；24 另外移除了 import assertions（`assert` 语法，用 `with` 替代）。

## 三、升级建议（一句话版）
测试充分后从 22 → 24：重点回归 `url.parse()`、`SlowBuffer`、`shell: true` 的 spawn/execFile、原生扩展重编译；升级后可开始用 `using`、`URLPattern`、`--permission` 和 npm 11。

## 来源
- [Node.js 24.0.0 发布说明（官方博客）](https://nodejs.org/en/blog/release/v24.0.0)
- [Node.js 22.0.0 发布说明（官方博客）](https://nodejs.org/en/blog/release/v22.0.0)
- [Node.js 官方发布计划（Release Schedule）](https://github.com/nodejs/release)
- [child_process 弃用详情：nodejs/node#57199](https://github.com/nodejs/node/pull/57199)

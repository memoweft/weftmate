# Node.js 24 相比 22 值得留意的变化（简要）

> 整理日期：2026-10-09。依据 Node.js 官方发布说明与官方发布计划。

## 1. 版本现状（先看这个）

| 版本线 | 状态 | 代号 | 首发 | Active LTS | 进入维护 | 停止支持 |
|---|---|---|---|---|---|---|
| 22.x | 维护期 LTS | Jod | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| 24.x | **Active LTS** | Krypton | 2025-05-06 | 2025-10-28 | **2026-10-20** | 2028-04-30 |
| 26.x | Current（奇数号不进 LTS） | — | 2026-05-05 | 2026-10-28 | 2027-10-20 | 2029-04-30 |

要点：**24 是当前的主力 LTS，22 已进入维护期（只剩关键修复和安全更新）**；24 约在 2026-10-20 转入维护期，22 的支持到 2027-04-30 结束。新项目建议直接 24，老项目可以在 22 停止支持前完成迁移。

## 2. 运行时与语言层面（最值得关注）

- **V8 升级到 13.6**（22 是 V8 12.4），带来新的 JS 能力：
  - `Float16Array`
  - **显式资源管理（explicit resource management，`using` / `await using`）**——资源自动释放的新标准语法
  - `RegExp.escape()`
  - WebAssembly Memory64
  - `Error.isError()`
- **`AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现**：异步上下文追踪性能更好、在复杂场景下更稳健（行为上仍是同一个 API）。
- **`URLPattern` 成为全局对象**，无需 import 即可用于 URL 模式匹配。
- **权限模型更稳**：实验开关从 `--experimental-permission` 改名为 **`--permission`**，意味着更接近可用于生产。
- **npm 升到 11**（22 自带 npm 10），**Undici 升到 7**（HTTP 客户端性能与新 HTTP 特性支持更好）。
- **测试运行器**：`node:test` 现在会自动等待子测试结束，不必手动 `await`，减少未处理 Promise 的坑。

## 3. 弃用与移除（升级时最容易踩的坑）

Node 24 中：

- **`url.parse()` 运行时弃用**（会打印弃用警告）→ 改用 WHATWG `URL` API。
- **移除 `tls.createSecurePair()`**（已删除，非仅警告）。
- **`Buffer` 的 `SlowBuffer` 进入 EOL** 并运行时弃用。
- **不带 `new` 直接调用 REPL 构造**运行时弃用；**不带 `new` 使用 Zlib 类**弃用。
- **`child_process` 的 `spawn` / `execFile` 以参数数组形式传 args** 的写法弃用。
- **Windows 下不再支持用 MSVC 编译 Node.js，必须用 ClangCL**（自建原生模块/自行编译时要留意）。
- **原生模块 ABI 变化**：`NODE_MODULE_VERSION` 从 22 线的 127 升到 **137**，native addon 需要用新版 Node 重新编译。
- **armv7 支持降级为实验性**，并移除了 s390 32 位构建支持。

对照：Node 22 自身的破坏性变化（`createCipher`/`createDecipher` 已 EOL、`import assertions` 语法被移除、默认 `highWaterMark` 变化等）在 24 中依然生效。

## 4. 22 已有、24 继承的能力（不用重复迁移）

22 引入且在 24 中保留的特性：`require()` 加载同步 ESM 图、原生 **WebSocket 客户端**、**`node --run <script>`**、`fs.glob()` / `fs.globSync()`、`--watch` 稳定化。这些不需要在 24 上重新适配。

## 5. 升级检查清单（22 → 24）

1. 先把 22 线升到最新补丁（如 22.23.x），再切 24。
2. 搜索代码中 `url.parse(`、`tls.createSecurePair`、`SlowBuffer`、直接调用 `zlib`/REPL 构造的写法。
3. 重新编译所有 native addon（ABI 137），确认依赖是否支持 Node 24。
4. 自建二进制的 Windows 环境改用 ClangCL 工具链。
5. 跑一遍 `node --test`，注意子测试自动等待带来的用例行为差异。
6. 关注 `AsyncContextFrame` 默认实现带来的性能/行为差异（一般无感，但极端场景建议回归测试）。

## 来源

- [Node.js 24.0.0 发布说明（官方博客）](https://nodejs.org/en/blog/release/v24.0.0)
- [Node.js 22.0.0 发布说明（官方博客）](https://nodejs.org/en/blog/release/v22.0.0)
- [Node.js 官方发布计划与状态（nodejs/release）](https://github.com/nodejs/release#release-schedule)
- [Node.js 官方博客（最新版本列表）](https://nodejs.org/en/blog)

# Node.js 24 相比 22 值得留意的变化（简要说明）

> 整理时间：2026-10-09。依据 Node.js 官方发布说明与更新日志，摘取对日常开发影响较大的部分。

## 一、版本与支持周期

- Node.js 24 于 2025-05-06 发布（v24.0.0），先作为 Current 运行约半年，2025 年 10 月进入 LTS。
- Node.js 22 于 2024-04-24 发布，2024 年 10 月进入 LTS。
- 结论：现在 22 和 24 都在 LTS 窗口内，24 是较新的 LTS，22 属于上一代 LTS，可按依赖兼容性选择。

## 二、Node 24 的主要变化（官方 Notable Changes）

1. **V8 升级到 13.6**（22 为 V8 12.4），带来一批新的 JS 语言特性：
   - `Float16Array`
   - 显式资源管理（Explicit resource management，`using`/`await using`）
   - `RegExp.escape`
   - WebAssembly Memory64
   - `Error.isError`
2. **npm 升级到 11**（Node 24 自带），性能、安全性与现代包兼容性改进。
3. **AsyncLocalStorage 默认改用 AsyncContextFrame**：异步上下文跟踪实现更高效、更健壮，通常无需改代码，但对性能敏感的中间件/链路追踪可关注。
4. **`URLPattern` 成为全局对象**：URL 模式匹配不再需要显式 import，用法类似对字符串用正则。
5. **权限模型更稳定**：实验性 Permission Model 的开关从 `--experimental-permission` 改名为 `--permission`。
6. **测试运行器增强**：`node:test` 会自动等待子测试结束，不再需要手动 `await` 子测试 Promise。
7. **内置 Undici 7**：HTTP 客户端（fetch 底层）性能与新 HTTP 特性支持更好。
8. **构建链变化（重点）**：Node 24 起在 Windows 上**移除 MSVC 支持，必须用 ClangCL 编译**；如需自行构建原生模块/Node 本体，环境要求变了。
9. **ABI 变化**：NODE_MODULE_VERSION 升到 137，原生（C++）addon 需要针对新版本重新编译，不能直接复用 22 的 `.node` 文件。

## 三、Node 24 的弃用与移除（升级时最容易踩坑）

- `url.parse()` 运行时弃用 → 改用 WHATWG `URL` API。
- 移除已弃用的 `tls.createSecurePair()`。
- `Buffer` 的 `SlowBuffer` 运行时弃用（推向 EOL）。
- 不用 `new` 直接调用 REPL 构造运行时弃用。
- 不用 `new` 直接使用 Zlib 类运行时弃用。
- 向 `child_process` 的 `spawn` / `execFile` 传参方式的旧写法被弃用。
- 其它 semver-major：readline 关闭后调用更严格校验、http2 会话跟踪与优雅关闭、http 移除 `_headers` 等私有字段、`fs.truncate` 相关限制等。

## 四、对照：Node 22 当时的主要亮点（方便对比）

- 支持 `require()` 加载同步 ESM 图（24 延续并更完善）。
- 默认启用 WebSocket 客户端（全局 `WebSocket`）。
- V8 升到 12.4，并在支持的架构上启用 Maglev 优化。
- 新增 `node --run <script>` 运行 package.json 中的脚本。
- `fs.glob()` / `fs.globSync()` 可用。
- `--watch` 模式转为稳定。
- 移除 import assertions（改用 import attributes `with`）。
- 流默认 `highWaterMark` 提高。

> 对升级者的实际含义：22 → 24 属于大版本跳跃，主要风险不在 JS 语法，而在 **原生 addon 需重编译（ABI 137）**、**弃用 API（`url.parse` 等）开始告警**，以及 **Windows 自建环境改用 ClangCL**。

## 五、升级建议（简短）

1. 先在 CI 中用 24 跑测试套件，重点看 `url.parse`、Zlib、`child_process` 相关告警。
2. 检查依赖的原生模块（node-gyp / prebuild）是否有 24 对应版本。
3. 依赖 npm 11：确认 lockfile 与私有源兼容。
4. Windows 上自建或编译原生模块的环境需换成 ClangCL 工具链。
5. 关注 `AsyncContextFrame` 默认开启后，异步上下文相关中间件的性能表现。

## 来源链接

- Node.js 24.0.0 发布说明（Notable Changes、弃用与移除）：https://nodejs.org/en/blog/release/v24.0.0
- Node.js 22.0.0 发布说明（对照用）：https://nodejs.org/en/blog/release/v22.0.0
- Node.js 24 官方更新日志（各小版本明细）：https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md
- Node.js 发布周期/LTS 计划：https://github.com/nodejs/release/blob/main/RELEASES.md

# Node.js 24 相比 22 值得留意的变化（简短说明）

整理日期：2026-10-09。对比基准：**Node.js 24.0.0 与 22.0.0 的官方发布公告**，另以官方发布周期表和 TypeScript 文档补充。
注意：部分特性后来回移到了 22.x 较新的小版本，并非 24 独有，文中已单独标注。

## 1. 版本状态（截至 2026-10-09）

| 版本 | 状态 | 代号 | 首发 | Active LTS | 维护期 | EOL |
|---|---|---|---|---|---|---|
| 24.x | Active LTS（10-20 起转维护） | Krypton | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| 22.x | Maintenance LTS | Jod | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 |

结论：22 还在维护期（只有关键修复和安全更新），新项目建议直接上 24；24 的活跃支持期即将转入维护阶段。

## 2. 运行时与工具链

- **V8 升级 12.4 → 13.6**，新语言特性：`Float16Array`、显式资源管理（`using` / DisposableStack）、`RegExp.escape`、WebAssembly Memory64、`Error.isError`。
- **npm 10 → 11**；内置 HTTP 客户端 **Undici 6 → 7**。
- **ABI 变化**：NODE_MODULE_VERSION 127 → 137，原生扩展（node-gyp 编出的 `.node`）升级后必须重新编译。
- **Windows 构建 Node 本体不再支持 MSVC，必须用 ClangCL**（只影响编译 Node 本身，不自动改变第三方原生扩展的构建要求）。
- 平台调整：armv7 支持降级为实验性；移除 s390 32 位构建。

## 3. API 与行为变化（升级时最该留意）

- `AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现，异步上下文跟踪更快更稳。
- `URLPattern` 成为全局对象，无需 import。
- 权限模型实验开关 `--experimental-permission` 更名为 `--permission`。
- 测试运行器会自动等待子测试结束，不必再手动 `await`。
- **弃用与移除（24 起）**：
  - `url.parse()` 运行时弃用 → 改用 WHATWG `URL`；
  - `tls.createSecurePair` 已移除；
  - `SlowBuffer` 运行时弃用（EOL）；
  - 不带 `new` 调用 REPL 构造函数、不带 `new` 使用 Zlib 类被弃用；
  - `child_process` 的 `spawn`/`execFile` 部分旧传参用法被弃用。
- 其他 semver-major：HTTP/HTTP2 私有字段与会话跟踪、优雅关闭行为调整，readline 关闭后的调用校验更严格——依赖内部私有字段的代码可能失效。

## 4. TypeScript 支持（含 22 的回移情况）

- v22.6.0 引入类型剥离（当时需实验开关）；**v23.6.0 与 v22.18.0 起默认启用**；v24.3.0 起不再输出实验警告；**v24.12.0 起转为稳定**。
- 即：最新 24 和较新的 22.x 都能直接运行只含“可擦除语法”的 `.ts`（不做类型检查，可用 `--no-strip-types` 关闭）。
- 限制：不支持 enum、带运行时代码的 namespace、参数属性、装饰器；不读取 `tsconfig.json`；`node_modules` 内的 `.ts` 不处理。完整支持仍需 tsx 等第三方工具。

## 5. 22 已有的能力（不要误当成 24 新特性）

`require()` 同步 ESM 图、全局 `WebSocket`、`node --run`、`fs.glob/globSync`、`--watch` 模式稳定、Maglev 优化——这些在 22.0.0 就已落地，升到 24 只是继续可用。

## 6. 升级检查清单

1. 原生模块按 ABI 137 重新编译并做冒烟测试。
2. 全局搜索 `url.parse`、`SlowBuffer`、`tls.createSecurePair`、旧式 `spawn/execFile` 用法并替换。
3. Windows 上如需自行编译 Node，准备 ClangCL 工具链。
4. 升级内置 npm 11 后复查 lockfile 与 peerDependencies 解析结果。
5. 先在 22 最新小版本验证——部分 24 特性已回移，回归风险可能比预期小。

## 来源

- [Node.js 24.0.0 发布说明（官方博客）](https://nodejs.org/en/blog/release/v24.0.0)
- [Node.js 22.0.0 发布说明（官方博客）](https://nodejs.org/en/blog/release/v22.0.0)
- [Node.js 官方发布周期表（nodejs/release）](https://github.com/nodejs/release#release-schedule)
- [TypeScript 支持文档及特性时间线（官方文档）](https://nodejs.org/docs/latest/api/typescript.html)

# Node.js 24 相比 22 值得留意的变化（简短版）

整理日期：2026-10-09 ｜ 依据：Node.js 官方发布说明与官方文档

---

## 1. 先看支持周期（决定要不要升）

| 版本 | 代号 | 发布 | 进入 LTS | 进入维护期 | 结束支持 |
|---|---|---|---|---|---|
| v22 | Jod | 2024-04-24 | 2024-10-29 | 2025-10-21（已进入） | 2027-04-30 |
| v24 | Krypton | 2025-05-06 | 2025-10-28 | **2026-10-20（约 11 天后）** | **2028-04-30** |

- 目前的 Current 是 v26；生产环境用 LTS 即可。
- 结论：24 的支持窗口比 22 多整整一年，新项目直接上 24；22 目前仍在维护期，但只剩约半年时间，适合按节奏迁移而不是长期停留。

## 2. 语言与运行时：V8 13.6（22 为 12.4）

24 升级 V8 后新增的 JS 特性：

- `Float16Array`
- **显式资源管理** `using` / `await using`（Explicit resource management）
- `RegExp.escape()`
- WebAssembly Memory64
- `Error.isError()`

22 当时带来的能力（24 中继续保留）：全局 `WebSocket` 客户端、`node --run <script>`、`fs.glob()/globSync()`、`require()` 加载同步 ESM、V8 Maglev JIT。

## 3. API 与运行时行为变化（升级回归测试重点）

- **AsyncLocalStorage 默认改用 AsyncContextFrame 实现** —— 性能更好、语义更稳，但如果依赖了内部实现细节需要验证。
- **`URLPattern` 成为全局对象**，不用再 import。
- **权限模型**：`--experimental-permission` 更名为 `--permission`，稳定性提升。
- **测试运行器**：会自动等待子测试结束，不必手动 `await` 子测试。
- **fetch 底层 Undici 升到 7**（HTTP 客户端行为/性能更新）。
- `.env` 文件支持（`--env-file`）在 24.10 中标记为稳定（Stable）。

## 4. 工具链与生态

- **自带 npm 11**（22 自带 npm 10），跨大版本升级。
- **TypeScript 默认可用**：类型剥离（type stripping）在 24 中**默认开启且标记为 Stable**，`node foo.ts` 直接跑。限制要记牢：
  - 只做类型擦除、不做类型检查，不读 `tsconfig.json`（paths 等不生效）；
  - `enum`、带运行时代码的 `namespace`、参数属性会报错，需加 `--experimental-transform-types`；
  - `node_modules` 下的 `.ts` 不处理（避免发布 TS 源码）；类型导入要写 `import type`。
- **Windows 自编译不再支持 MSVC，必须用 ClangCL**（只影响自己编译 Node，官方安装包不受影响）。
- **原生扩展 ABI：NODE_MODULE_VERSION 127 → 137**，C++ addon 需按新版本重新编译。

## 5. 废弃与移除（最容易踩的坑）

24 中：

- `url.parse()` **运行时废弃** → 改用 WHATWG `URL`；
- `tls.createSecurePair()` **已移除**；
- `SlowBuffer` 进入 EOL；
- 不加 `new` 直接调 REPL 工厂函数、不加 `new` 使用 Zlib 类 → 废弃；
- `child_process` 的 `spawn`/`execFile` 旧式传参方式 → 废弃。

22 时代已生效、升级到 24 后依然要处理的：`createCipher`/`createDecipher` 已 EOL，`Hash`/`hmac` 构造器、`fs.Stats` 构造器运行时废弃。

## 6. 30 秒升级建议

1. 新项目：直接 Node 24 LTS。
2. 从 22 升 24，按顺序检查：`url.parse` 用法 → 原生 addon 重编译 → AsyncLocalStorage 回归 → 自编译环境换 ClangCL → npm 10→11 的脚本兼容。
3. 22 已有的 `node --run`、`fs.glob`、全局 WebSocket、`require(esm)` 在 24 中都还在，不需要回退写法。

---

## 来源链接

- Node.js 24.0.0 发布说明（V8 13.6、npm 11、AsyncContextFrame、URLPattern、--permission、测试运行器、Undici 7、废弃清单）：https://nodejs.org/en/blog/release/v24.0.0
- Node.js 22.0.0 发布说明（V8 12.4、全局 WebSocket、node --run、fs.glob、require(esm)）：https://nodejs.org/en/blog/release/v22.0.0
- Node.js 24.10.0 发布说明（`.env` 支持标记为稳定等）：https://nodejs.org/en/blog/release/v24.10.0
- 官方发布计划 schedule.json（LTS/维护期/结束支持日期）：https://github.com/nodejs/release/blob/main/schedule.json
- 官方版本状态总览：https://nodejs.org/en/about/previous-releases
- TypeScript 模块文档（v24，类型剥离默认开启、Stability 2、限制说明）：https://nodejs.org/docs/latest-v24.x/api/typescript.html

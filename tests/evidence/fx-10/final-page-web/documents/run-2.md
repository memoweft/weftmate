# Node.js 24 相对 22 的变化简要说明

整理时间：2026-10-09。内容摘自 Node.js 官方发布公告与 API 文档，面向“从 22 升级到 24”的评估场景。

## 一、版本与支持状态（截至 2026-10-09）

| 版本 | 发布 | 进入 LTS | 维护期起 | EOL |
|---|---|---|---|---|
| 24（代号 Krypton） | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| 22（代号 Jod） | 2024-04-24 | 2024-10-29 | 2025-10-21（当前所处阶段） | 2027-04-30 |

- 现在 24 是活跃 LTS；22 已进入维护期（只修复 bug 与安全问题）。
- 24 将在 2026-10-20 进入维护期，之后同样只做维护性更新。
- 来源：[nodejs/release 官方发布计划 schedule.json](https://raw.githubusercontent.com/nodejs/release/main/schedule.json)

## 二、语言与运行时（V8）

- **24 使用 V8 13.6**，新增可用特性：`Float16Array`、显式资源管理（`using` / `await using`）、`RegExp.escape`、`WebAssembly Memory64`、`Error.isError`。
- 22 使用 V8 12.4（带来 WebAssembly GC、`Array.fromAsync`、Set 新方法、迭代器辅助函数，并默认启用 Maglev 编译器），这些在 24 中自然延续。
- **原生模块 ABI 变化**：24 的 `NODE_MODULE_VERSION` 为 137，C++ 原生扩展必须按 24 重新编译。
- 来源：[Node.js 24.0.0 发布公告](https://nodejs.org/en/blog/release/v24.0.0)、[Node.js 22 发布公告](https://nodejs.org/en/blog/announcements/v22-release-announce)

## 三、自带依赖升级

- **npm 11**（24 自带）。
- **Undici 7**：fetch / HTTP 客户端大版本升级，性能与新 HTTP 特性支持更好。
- 来源：[Node.js 24.0.0 发布公告](https://nodejs.org/en/blog/release/v24.0.0)

## 四、重点 API 与行为变化

1. **AsyncLocalStorage 默认使用 AsyncContextFrame**：异步上下文跟踪实现更换，官方称性能更好、对高级场景更健壮；`AsyncResource` 也接入了 async context frame。
2. **`URLPattern` 成为全局对象**，无需 import 即可用于 URL 模式匹配。
3. **权限模型**：`--experimental-permission` 改名为 `--permission`，稳定度提高。
4. **测试运行器（semver-major，最容易踩坑）**：
   - 自动等待子测试完成，不必手动 await；
   - `test()` / `t.test()` **不再返回 promise**（老测试代码可能要改）；
   - 新增全局 setup / teardown。
5. **TypeScript 支持**：24 文档标注 **Stability 2 - Stable**，默认执行仅含可擦除类型语法的 `.ts` 文件，关闭开关是 `--no-strip-types`；22 侧同一特性文档仍是 Stability 1.2 Release Candidate，关闭开关为 `--no-experimental-strip-types`（`--experimental-transform-types` 处理 enum 等需生成代码的语法两者都有）。
6. **fetch 支持环境变量 HTTP 代理**：设置 `NODE_USE_ENV_PROXY` 后 fetch 走系统代理。
7. 其他新增：`assert.partialDeepStrictEqual()` 标记为稳定、`import.meta` 属性转正、`worker.getHeapStatistics()`、`util.types.isFloat16Array()`、REPL 多行历史、测试运行器全局 setup/teardown。
- 来源：[Node.js 24.0.0 发布公告](https://nodejs.org/en/blog/release/v24.0.0)、[24 版 Modules: TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html)、[22 版 Modules: TypeScript](https://nodejs.org/docs/latest-v22.x/api/typescript.html)

## 五、`require()` 加载 ESM（不是 24 的新增，但要注意 22 的小版本）

- 22.0.0 时需要 `--experimental-require-module`；**22.12.0（2024-12-03）起默认启用**；23.x 起默认启用，24 延续。
- 行为：不再抛 `ERR_REQUIRE_ESM`；若模块或其依赖含顶层 await 则抛 `ERR_REQUIRE_ASYNC_MODULE`；可用 `process.features.require_module` 探测，`--no-experimental-require-module` 可关闭。
- 结论：若当前 22 停在 22.12 之前的线上版本，升级 24 会改变 `require()` 的行为，需要回归测试。
- 来源：[Node.js 22.12.0 发布公告](https://nodejs.org/en/blog/release/v22.12.0)

## 六、弃用与移除（升级前要排查的清单）

- `url.parse()` **运行时弃用** → 改用 WHATWG `URL`。
- 移除 `tls.createSecurePair`；`tls` 服务器 `setOptions` 进入 EOL 弃用。
- `SlowBuffer` 运行时弃用（buffer 侧进入 EOL）。
- REPL 不用 `new` 实例化 → 运行时弃用。
- zlib 类不带 `new` 使用 → 弃用。
- `child_process`：“deprecate passing args to spawn and execFile”（#57199）。
- `fs`：`fs.existsSync` 传非法类型弃用；`fs.F_OK` 等常量运行时弃用；移除 `Dirent.path`。
- 其他 semver-major：`http` 移除内部 `_headers`/`_headersList`、移除过时 Cipher 导出、不再暴露 6 个 `process` bindings、`http2` 会话跟踪与优雅关闭服务端、`timers`/`readline` 若干方法收紧或 EOL。
- 来源：[Node.js 24.0.0 发布公告（Deprecations and Removals / Semver-Major Commits）](https://nodejs.org/en/blog/release/v24.0.0)

## 七、构建与平台（Windows 桌面开发尤其相关）

- **Windows 不再支持 MSVC，编译 Node 及原生模块必须使用 ClangCL**。
- 最低 macOS 13.5、最低 Xcode 16.1；不再支持 Python 3.8。
- 移除 ppc 32 位、s390 32 位支持；armv7 支持降级为实验性。
- 来源：[Node.js 24.0.0 发布公告](https://nodejs.org/en/blog/release/v24.0.0)

## 八、升级检查清单

1. 所有 C++ 原生扩展按 NODE_MODULE_VERSION 137 重新编译。
2. Windows 构建链切到 ClangCL。
3. 测试代码适配测试运行器“不返回 promise、自动等待子测试”的新语义。
4. 全局搜一遍 `url.parse`、`SlowBuffer`、`createSecurePair`、zlib/REPL 旧用法。
5. 确认 22 至少在 22.12 以上再对比行为差异（`require(esm)`、type stripping 默认开启）。

## 来源汇总

- Node.js 24.0.0 官方发布公告：https://nodejs.org/en/blog/release/v24.0.0
- Node.js 22 官方发布公告：https://nodejs.org/en/blog/announcements/v22-release-announce
- Node.js 22.12.0 发布公告（require(esm) 默认启用）：https://nodejs.org/en/blog/release/v22.12.0
- Node.js 24 API 文档 — Modules: TypeScript：https://nodejs.org/docs/latest-v24.x/api/typescript.html
- Node.js 22 API 文档 — Modules: TypeScript：https://nodejs.org/docs/latest-v22.x/api/typescript.html
- 官方发布计划（版本状态、EOL 日期）：https://github.com/nodejs/release

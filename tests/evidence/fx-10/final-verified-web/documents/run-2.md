# Node.js 24 相比 22 值得留意的变化（官方资料整理）

整理时间：2026-10-09。本文只依据 nodejs.org 官方发布说明、官方文档和官方发布计划。

## 一、版本定位与支持周期

| 版本 | 代号 | 当前状态 | 首发 | 进入 Active LTS | 进入维护期 | 停止支持 (EOL) |
|---|---|---|---|---|---|---|
| 22.x | Jod | 维护期 LTS | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| 24.x | Krypton | Active LTS | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |

- 24 是当前的 Active LTS，22 已进入维护期（只出关键修复和安全更新）。
- 24 将于 **2026-10-20** 转入维护期（大约两周后），之后维护到 2028-04-30。
- 偶数版本才会进 LTS；现在的 Current 是 26.x（2026-05-05 发布）。
- 来源：<https://github.com/nodejs/release#release-schedule>

## 二、24 新增/升级的能力（22 没有，或状态不同）

1. **V8 13.6**（22 是 V8 12.4），带来更多新语法与内建 API：
   - `Float16Array`
   - 显式资源管理（Explicit Resource Management，`using` / `await using`）
   - `RegExp.escape()`
   - WebAssembly Memory64
   - `Error.isError()`
2. **AsyncLocalStorage 默认改用 AsyncContextFrame** 实现，异步上下文跟踪更高效、更健壮；`AsyncResource` 也接入了该机制。
3. **`URLPattern` 成为全局对象**，无需 import 即可用于 URL 模式匹配。
4. **TypeScript 运行时支持转正**：类型剥离（type stripping）在 24 文档中标为 **Stable (2)**，在 22 文档中仍是 **Release candidate (1.2)**。
   - 两个版本现在都能直接跑只含"可擦除语法"的 `.ts` 文件（不做类型检查、不读 tsconfig.json）；
   - 关闭开关不同：22 用 `--no-experimental-strip-types`，24 用 `--no-strip-types`；
   - enum、namespace、参数属性等仍需 `--experimental-transform-types`。
5. **npm 升到 11**（22.0.0 自带 npm 10.5.1）。
6. **Undici 7**：`fetch` 底层 HTTP 客户端大版本升级；24.x 后续还支持用 `NODE_USE_ENV_PROXY` 给 fetch 配 HTTP 代理。
7. **权限模型更稳**：`--experimental-permission` 更名为 `--permission`。
8. **测试运行器（node:test）增强**：自动等待子测试结束；`test()` / `t.test()` 不再返回 Promise（用返回值判断子测试成败的写法要改）；24.x 另加了全局 setup/teardown。
9. **24.x 期间陆续转正的新 API**：`assert.partialDeepStrictEqual()` 标为 stable、`import.meta` 属性毕业、`worker.getHeapStatistics()`、REPL 多行历史、`util.types.isFloat16Array()` 等。

> 说明：`require(esm)` 默认开启是 **22.12.0** 就有的变化，24 同样支持。如果你们的 22 已经升到较新的小版本，这块不算 24 的差异。

## 三、破坏性变更：升级前要检查的点

**运行时废弃（会告警，未来版本会移除）**
- `url.parse()` → 改用 WHATWG `URL` API
- `SlowBuffer`、不带 `new` 调 REPL、不带 `new` 使用 zlib 类
- `child_process` 的 `spawn` / `execFile` 传非数组参数（args 要用数组形式）
- `fs.existsSync()` 传非法类型；`fs.F_OK / R_OK / W_OK / X_OK` 常量运行时废弃

**直接移除 / 行为变更**
- 移除 `tls.createSecurePair()`（改用 `tls.connect` 等）
- 移除 `Dirent.path`（用 `parentPath`）
- `fs` 的 `truncate` 不再接受文件描述符（fd）
- 移除若干过时的 Cipher 导出、6 个暴露的 `process` bindings
- `test()` / `t.test()` 不返回 Promise，测试写法需相应调整

**原生扩展（Node-API / node-gyp 模块）**
- ABI 版本 `NODE_MODULE_VERSION`：22 是 **127**，24 是 **137**。
- 所有 `.node` 原生模块必须针对 24 重新编译（或改用提供 Node 24 预编译产物的版本）。

**构建与平台（只影响自己编译 Node 或原生模块的场景）**
- Windows：**不再支持 MSVC，必须用 ClangCL** 编译
- macOS 最低版本提升到 13.5，Xcode ≥ 16.1；不再支持 Python 3.8
- 移除 s390 32 位、ppc32 位支持；armv7 降级为 experimental

## 四、建议的升级检查清单

1. 升到 24 后先用 `node --pending-deprecation` 跑一遍测试/脚本，收集 DEP0xxx 警告。
2. 全局搜索：`url.parse`、`SlowBuffer`、`createSecurePair`、`dirent.path`、`fs.F_OK`、`spawn/execFile` 参数写法。
3. 重新构建全部原生依赖（`npm rebuild` / 重装带预编译包的依赖），确认覆盖 ABI 137。
4. 若在 Windows 上自编译 Node 或原生模块，确认工具链已切换到 ClangCL。
5. 本地与 CI 的 npm 版本对齐（24 自带 npm 11），留意 lockfile / engines 字段差异。

## 来源

- Node.js 24.0.0 发布说明（Notable Changes / 弃用与移除）：<https://nodejs.org/en/blog/release/v24.0.0>
- Node.js 22.0.0 发布说明：<https://nodejs.org/en/blog/release/v22.0.0>
- Node.js 22.12.0 发布说明（require(esm) 默认开启）：<https://nodejs.org/en/blog/release/v22.12.0>
- 官方发布计划（状态与 EOL 表）：<https://github.com/nodejs/release#release-schedule>
- Node 24 官方文档 · TypeScript 模块（Stable）：<https://nodejs.org/docs/latest-v24.x/api/typescript.html>
- Node 22 官方文档 · TypeScript 模块（Release candidate）：<https://nodejs.org/docs/latest-v22.x/api/typescript.html>
- Node 24 全部版本变更日志：<https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md>
- 官方博客（各版本发布公告）：<https://nodejs.org/en/blog>

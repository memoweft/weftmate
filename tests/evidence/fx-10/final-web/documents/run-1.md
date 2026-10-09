# Node.js 24 相比 22 值得留意的变化（简要）

> 整理时间：2026-10-09。信息来自 Node.js 官方发布说明、官方文档与发布周期表，链接见文末。

## 0. 版本与支持周期（先看这个）

| 版本线 | 代号 | 发布 | 当前状态 | 维护结束（EOL） |
|---|---|---|---|---|
| 22.x | Jod | 2024-04-24 | Maintenance LTS（2025-10-21 起） | 2027-04-30 |
| 24.x | Krypton | 2025-05-06 | Active LTS（2025-10-28 起，2026-10-20 转维护期） | 2028-04-30 |

要点：24 已是 Active LTS，新项目建议直接上 24；22 只剩关键 bug 与安全修复，还能用到 2027 年 4 月，但新特性不会再进。

## 1. JavaScript 引擎与语言特性（V8 13.6 vs 12.4）

Node 24 升级到 **V8 13.6**（22 是 V8 12.4），随之可用的新语言能力：

- **Float16Array**：半精度浮点 TypedArray（数据/ML 场景省内存）。
- **显式资源管理（Explicit Resource Management）**：`using` / `await using`，自动释放资源，适合连接、文件句柄等。
- **`RegExp.escape()`**：安全转义字符串用于正则。
- **`Error.isError()`**：跨 realm 可靠判断 Error。
- **WebAssembly Memory64**：WASM 可用 64 位内存。

## 2. 运行时与 API 变化

- **`AsyncLocalStorage` 默认改用 `AsyncContextFrame`**：异步上下文追踪的实现更高效、更稳健；一般无需改代码，但如果依赖了内部实现细节需注意。
- **`URLPattern` 成为全局对象**：不用再 import，可直接做 URL 模式匹配。
- **权限模型更进一步**：实验性的 `--experimental-permission` 改名为 **`--permission`**，稳定性提升，适合做最小权限运行。
- **内置 npm 从 10 升到 11**：性能、安全性与新包兼容性更好。
- **测试运行器**：`node:test` 会**自动等待子测试完成**，不必再手动 `await` 子测试 promise，减少"未处理 promise"类错误。
- **Undici 7**（内置 fetch 底层 HTTP 客户端）：性能更好、支持更新的 HTTP 特性。
- **TypeScript 类型剥离默认开启且已稳定**：直接 `node xxx.ts` 可运行仅含"可擦除类型语法"的 TS（22.6 才以实验特性引入）。不支持 enum/namespace 运行时（需 `--experimental-transform-types`），也不读 tsconfig.json；可用 `--no-strip-types` 关闭。

## 3. 弃用与移除（升级最容易踩的坑）

- **`url.parse()` 运行时弃用**：改用 WHATWG `URL` / `URLSearchParams`。
- **移除 `tls.createSecurePair()`**：直接删了，用 `tls.connect` / `TLSSocket`。
- **`SlowBuffer` 进入 EOL**：用普通 `Buffer`。
- **REPL 不带 `new` 实例化、Zlib 类不带 `new` 使用**：均已弃用，记得加 `new`。
- **`child_process` 的 `spawn` / `execFile` 直接传参数组的旧写法弃用**：改用 options 对象里的 `args`。
- 另外 `fs` 的 `truncate` 相关旧能力、`http` 内部 `_headers` 属性等也有 semver-major 调整，升级前建议跑一遍测试。

## 4. 构建与原生模块（C++ addon 用户必看）

- **ABI 变更**：`NODE_MODULE_VERSION` 24 为 **137**，22 为 **127** —— `.node` 原生模块不通用，升级 Node 后必须重新编译（node-gyp / prebuild 重新出包）。
- **Windows 不再支持 MSVC 编译**，Node 24 起必须用 **ClangCL**（自编译 Node 或某些 addon 场景要注意）。
- armv7 支持降级为实验级；移除 s390 32 位构建支持（冷门平台）。

## 5. 基线提醒：这些 22 就有了（不是 24 的新东西）

避免误记：`require()` 加载 ESM 图、全局 WebSocket 客户端、`node --run`、`fs.glob/globSync`、`--watch` 稳定、流默认 `highWaterMark` 提升、Maglev JIT，都是 **Node 22 引入的**，你从 22 升到 24 不会"新获得"这些。

## 6. 升级建议（22 → 24 检查清单）

1. 全局搜索 `url.parse(`、`createSecurePair`、`SlowBuffer`、不带 `new` 的 `new Zlib`/REPL 用法，替换。
2. 所有原生依赖（bcrypt、sharp、sqlite 等）重新安装/重编译，确认有 137 ABI 的预编译包。
3. 依赖 `AsyncLocalStorage` 深层行为或私有 API 的代码跑回归测试。
4. 有 `--experimental-permission` 脚本的改成 `--permission`。
5. 确认 CI/镜像里的编译工具链：Windows 用 ClangCL；锁 `engines` 字段与 `.nvmrc` 到 24。
6. 顺便看一眼 npm 11 的 breaking changes（若有 lockfile/生命周期脚本依赖）。

## 来源（官方）

- Node.js 24.0.0 发布说明：<https://nodejs.org/en/blog/release/v24.0.0>
- Node.js 22.0.0 发布说明：<https://nodejs.org/en/blog/release/v22.0.0>
- Node.js 官方发布周期表（LTS/维护/EOL 日期）：<https://github.com/nodejs/release#release-schedule>
- Node.js 24 变更日志（全量）：<https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md>
- Node.js 24 内置文档 · TypeScript 类型剥离：<https://nodejs.org/docs/latest-v24.x/api/typescript.html>
- Node.js 下载与版本状态：<https://nodejs.org/en/download>

# Node.js 24 相比 22 值得留意的变化（简要说明）

> 整理时间：2026-10-09；依据 Node.js 官方发布说明与官方文档。

## 1. 版本状态与支持周期（先看这个）

| 版本 | 代号 | 状态 | 关键日期 |
|---|---|---|---|
| 22.x | Jod | **维护期 LTS**（只修关键 bug 和安全问题） | 发布 2024-04-24，进维护 2025-10-21，**EOL 2027-04-30** |
| 24.x | Krypton | **活跃 LTS** | 发布 2025-05-06，进 LTS 2025-10-28，2026-10-20 起转维护，**EOL 2028-04-30** |

结论：24 是当前主推的生产版本，支持期比 22 多一年；22 还能用但已不再收新特性。

## 2. 语言与运行时（V8 13.6，22 是 12.4）

- **Float16Array**：新增 16 位浮点类型。
- **显式资源管理（Explicit Resource Management）**：`using` / `await using` 语法正式可用，适合自动释放连接、文件句柄等资源。
- **`RegExp.escape()`**：对字符串做正则转义。
- **WebAssembly Memory64**、**`Error.isError()`** 也随 V8 13.6 到来。

## 3. TypeScript 支持变成"默认能跑"

- 24 里**默认开启类型剥离（type stripping）且已标为 Stable**：直接 `node xxx.ts` 即可运行只含"可擦除语法"的 TS，不做类型检查。
- 可用 `--no-strip-types` 关闭；enum、参数属性等需要代码生成的语法要加 `--experimental-transform-types`。
- 注意：**不读 tsconfig.json**（paths、降级编译等不支持），不处理 `node_modules` 里的 TS 文件，`.tsx` 不支持；需要完整 TS 能力仍建议用 `tsx` 等第三方工具。
- 22 里这还是实验性、需加 `--experimental-strip-types` 才生效的功能。

## 4. 核心 API 与行为变化

- **`AsyncLocalStorage` 默认改用 AsyncContextFrame 实现**：性能更好、更稳健；一般无感，但若依赖其内部实现细节或做基准测试需要留意。
- **`URLPattern` 成为全局对象**：无需 import 直接可用（类正则的 URL 匹配）。
- **权限模型更进一步**：`--experimental-permission` 改名为 **`--permission`**，更稳定、更接近可用状态。
- **测试运行器**：子测试会自动等待完成，不必再手动 `await` 每个子测试。
- **`node:sqlite` 从"活跃开发"升到"发布候选"**（v22 文档 Stability 1.1 → v24 文档 Stability 1.2），API 也更丰富（`aggregate`、`setAuthorizer`、session/backup 等）。
- 内置 **Undici 7**（HTTP 客户端栈更新）、**npm 11**（22 自带 npm 10）。

## 5. 弃用与移除（升级前要排查的点）

- **`url.parse()` 运行时弃用**——改用 WHATWG URL API（`new URL(...)`）。
- **`tls.createSecurePair` 已移除**；**`SlowBuffer` 进入 EOL**。
- **`spawn`/`execFile` 在 `shell: true` 时传 `args` 被弃用**（DEP0190）：参数只是拼接而非转义，容易引发安全问题，会收到 DeprecationWarning。
- 其他弃用：不带 `new` 直接调用 REPL、不带 `new` 使用 Zlib 类。
- **Windows 构建移除 MSVC 支持，必须用 ClangCL** 编译 Node 本体（对普通使用者无影响，影响自行编译/嵌入 Node 的场景）。
- **原生模块 ABI 变了**（NODE_MODULE_VERSION 137，22 是 127）：N-API/Node-API 模块不受影响，老式 V8 ABI 原生扩展需重新编译。
- ARMv7 支持降级为实验性。

## 6. 升级建议（简）

1. 新项目直接上 24；存量 22 项目可在 2027-04-30（22 EOL）前迁到 24。
2. 升级前重点回归：`url.parse()`、`SlowBuffer`、`shell: true` + `args`、原生扩展重编译。
3. 生产环境以 24 的 LTS 版本为准；奇数版本（Current 线）不上生产。

## 来源链接

- [Node.js 24.0.0 发布说明（Notable Changes / 弃用清单）](https://nodejs.org/en/blog/release/v24.0.0)
- [Node.js 22.0.0 发布说明（对照基线）](https://nodejs.org/en/blog/release/v22.0.0)
- [官方发布周期与 LTS 状态表（nodejs/release）](https://github.com/nodejs/release#release-schedule)
- [v24 文档：Modules: TypeScript（Stability 2 - Stable）](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
- [v24 文档：node:sqlite（Stability 1.2）](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [v22 文档：node:sqlite（Stability 1.1，对照）](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)
- [PR #57199：shell:true 时传 args 弃用（DEP0190）](https://github.com/nodejs/node/pull/57199)

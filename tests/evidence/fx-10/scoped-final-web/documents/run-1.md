# Node.js 24 相比 22 值得留意的变化

整理日期：2026-10-09，依据 Node.js 官方发布说明、官方文档与官方发布时间表。

## 1. 先看支持状态（决定要不要升）

| 版本 | 状态 | 代号 | 关键日期 |
|---|---|---|---|
| 22.x | 维护期 LTS | Jod | 2024-04-24 发布，2025-10-21 起维护期，2027-04-30 EOL |
| 24.x | 活跃 LTS | Krypton | 2025-05-06 发布，2025-10-28 起活跃 LTS，2026-10-20 起转入维护期，2028-04-30 EOL |
| 26.x | Current | — | 2026-05-05 发布 |

- 22 现在只收关键 bug 修复和安全更新；24 还在活跃 LTS，约两周后（2026-10-20）转入维护期。
- 新项目建议直接上 24 LTS；22 仍会获得安全支持到 2027-04-30，不急着升也没风险。

## 2. 语言与运行时：V8 12.4 → 13.6

24 新增（22 没有）：

- `Float16Array`
- 显式资源管理（`using` / `await using`）
- `RegExp.escape`
- `Error.isError`
- WebAssembly Memory64

22 已经具备、无需升级也有：`Array.fromAsync`、Set 新方法、iterator helpers、WebAssembly GC，以及 V8 Maglev 编译器默认开启。

## 3. 依赖与工具链（影响构建/发布）

- npm 10 → **npm 11**。
- fetch 后端 Undici → **Undici 7**。
- **Windows 上编译 Node.js 核心不再支持 MSVC，改用 ClangCL**（只影响自己编译 Node/嵌入式场景，普通用安装包的开发者无感）。
- 原生模块 ABI 变化：24 为 `NODE_MODULE_VERSION 137`，**原生 addon 需要重新编译**（N-API 编写的除外）。
- 24 把 armv7 支持降级为实验性。

## 4. 运行时 API 与行为变化

- `AsyncLocalStorage` 默认改用 **AsyncContextFrame**，异步上下文跟踪更快更稳。
- **`URLPattern` 成为全局对象**，无需 import。
- 权限模型旗标从 `--experimental-permission` 改为 **`--permission`**（稳定性提升的信号）。
- 测试运行器（`node --test`）会**自动等待子测试**结束，不必手动 await。
- 弃用与移除（升级时最容易踩的坑）：
  - `url.parse()` **运行时弃用**，请改用 WHATWG `URL`；
  - `tls.createSecurePair()` **已移除**；
  - `SlowBuffer` 进入 EOL/运行时弃用；
  - 不带 `new` 直接调用 REPL、Zlib 类被弃用；
  - `child_process` 中 `spawn`/`execFile` 的某种传参写法被标记弃用（#57199）。

## 5. TypeScript 与模块系统（两边差异其实不大）

- **直接跑 `.ts` 文件**：22.6 就引入了 type stripping，当前 22.x 文档标注为 `Stability: 1.2 - Release candidate`；24 的文档已标注为 **`Stability: 2 - Stable`**。功能一致：默认只做类型擦除（不做类型检查、不读 tsconfig），`enum`、参数属性等需加 `--experimental-transform-types`，`--no-strip-types` 可关闭。
- **`require()` 加载 ESM**：22.0 发布时需要 `--experimental-require-module` 旗标，**22.12+ 与 24 都已默认开启**，只支持不含顶层 `await` 的同步 ESM。
- **注意：不少新特性已回移到 22**，例如 `import.meta.main` 在 24.2 加入，也已回移到 22.18。所以"24 有"不等于"22 拿不到"，判断时以 22.x 最新文档为准。
- 22 已有、24 继承的能力：`require(esm)`（22.12+）、WebSocket 客户端默认启用、`node --run`、`node --watch` 稳定版、`node:fs` 的 `glob/globSync`、流默认 HighWaterMark 16KiB→64KiB。

## 6. 升级清单（22 → 24）

1. 全局搜一遍 `url.parse`、`SlowBuffer`、`tls.createSecurePair`、不带 `new` 的 Zlib/REPL 用法。
2. 原生 addon 用对应 Node 版本重新编译（非 N-API 的必须重编）。
3. 需要自己编译 Node 的 Windows 环境换成 ClangCL 工具链。
4. npm 升到 11 后检查老脚本/老依赖兼容性。
5. 升级后跑一遍 `node --test`，测试运行器自动等待子测试的行为可能暴露原先被掩盖的未处理 promise。

## 来源

- Node.js 24.0.0 发布说明（V8 13.6、npm 11、AsyncContextFrame、URLPattern、弃用/移除清单等）：https://nodejs.org/en/blog/release/v24.0.0
- Node.js 22 发布公告（V8 12.4、require(esm)、WebSocket、`node --run`、watch mode 等）：https://nodejs.org/en/blog/announcements/v22-release-announce
- Node.js 22.12.0 发布说明（require(esm) 在 22 上默认开启）：https://nodejs.org/en/blog/release/v22.12.0
- 官方发布计划与 LTS 时间表（22/24/26 状态、代号、EOL）：https://github.com/nodejs/release
- Node 24 官方文档：Modules: TypeScript（Stability 2 - Stable）：https://nodejs.org/docs/latest-v24.x/api/typescript.html
- Node 22 官方文档：Modules: TypeScript（Stability 1.2 - RC，v22.6.0 起）：https://nodejs.org/docs/latest-v22.x/api/typescript.html
- Node 24 官方文档：Modules: ECMAScript modules（require() 只支持同步 ESM；`import.meta.main` v24.2.0）：https://nodejs.org/docs/latest-v24.x/api/esm.html
- Node 22 官方文档：Modules: ECMAScript modules（`import.meta.main` v22.18.0 回移）：https://nodejs.org/docs/latest-v22.x/api/esm.html

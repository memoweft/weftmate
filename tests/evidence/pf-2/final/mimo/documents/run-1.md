# Node.js 24 相比 22 值得留意的变化（简要说明）

> 对比基准：两个大版本的**初始发布**（Node.js 22.0.0，2024-04-24；Node.js 24.0.0，2025-05-06）的官方发布公告，不逐一罗列后续小版本回移。
> 版本状态（截至 2026-10）：v22 代号 Jod、v24 代号 Krypton，两者目前都处于 LTS 状态。

## 一、语言与运行时

- **V8 引擎 12.4 → 13.6**，随之带来一批新的 JavaScript 能力：
  - `Float16Array`
  - **显式资源管理**（`using` / `await using`）
  - `RegExp.escape`
  - `Error.isError`
  - WebAssembly Memory64
- **TypeScript 直接执行（type stripping）默认开启**：Node 24 无需任何 flag 即可运行只含"可擦除语法"的 `.ts` 文件（仅删除类型标注、不做类型检查），可用 `--no-strip-types` 关闭。注意两点例外：
  - `enum`、带运行时代码的 `namespace`、参数属性等需要代码生成的语法会报错，除非加 `--experimental-transform-types`；
  - 忽略 `tsconfig.json`，不支持路径别名、语法降级等依赖配置的功能；完整支持仍需 tsx 等第三方方案。
  - （对照：Node 22.0.0 尚无此能力，22.6.0 才以实验 flag 引入。）
- **`AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现**，异步上下文跟踪更高效、更稳健。

## 二、平台与内置 API

- **`URLPattern` 成为全局对象**，无需 import 即可用（类似字符串之于正则的 URL 模式匹配）。
- **npm 内置升级到 11**（性能、安全性与新包生态兼容性改进）。
- **Undici 升级到 7**，内置 fetch/HTTP 客户端能力增强。
- **实验性权限模型（Permission Model）的 flag 由 `--experimental-permission` 改为 `--permission`**，稳定性提高，更接近可用状态。
- **测试运行器增强**：子测试会自动等待完成，不必再手动 await，减少未处理 Promise 的常见错误。

## 三、构建与工具链（升级时需注意）

- **Windows 上移除 MSVC 支持，编译 Node.js 现在要求 ClangCL**。只用官方二进制包的使用者不受影响，自行编译或维护原生 addon 构建链的需要留意。
- 22 引入的 `node --run`、`fs.glob/globSync`、`--watch`、WebSocket 客户端、`require()` 同步 ESM 图等能力在 24 中延续；这些特性当时的实验/稳定状态及后续小版本变化，以对应版本的官方文档为准。

## 四、升级建议（一句话版）

日常使用者：24 的重点是 **TS 直跑、V8 新语法、npm 11、AsyncLocalStorage 换实现**，值得升级但要回归测试依赖 async 上下文与自定义 TS 构建的代码；自行编译或写原生 addon 的，先确认 **ClangCL 工具链**。

## 来源

- [Node.js 24.0.0 发布公告](https://nodejs.org/en/blog/release/v24.0.0)
- [Node.js 22.0.0 发布公告](https://nodejs.org/en/blog/release/v22.0.0)
- [Node.js 24 官方文档 · Modules: TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
- [Node.js 版本发布状态页](https://nodejs.org/en/about/previous-releases)

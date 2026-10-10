# Node.js 24 相比 22 值得留意的变化（简短版）

> 面向下班后快速浏览。以下内容全部来自 Node.js 官方发布说明与官方版本状态页，关键结论旁标有来源编号，文末附逐字引语出处。

## 一、版本与状态

- Node.js 24.0.0 于 **2025-05-06** 发布，发布时状态为 "Current" [1]；官方在该说明中写道，24 将于当年 10 月进入长期支持（LTS），在那之前是为期六个月的 "Current" 版本 [1]。
- 对比基准 Node.js 22.0.0 于 **2024-04-24** 发布，同样经历了六个月 "Current" 阶段后转 LTS [3]。
- 按官方版本状态页（抓取时点 2026-10-10），v24（代号 Krypton）与 v22（代号 Jod）目前都处于 LTS 状态 [4]。也就是说：**22 和 24 都还能在生产里用，24 是更新的 LTS 分支**。

## 二、24 的核心变化（相对 22 时代最值得留意的几点）

1. **V8 引擎升级到 13.6** [1]（22.0.0 当时的 V8 是 12.4.254.14 [3]）。随 V8 更新，官方摘要提到的新 JavaScript 能力包括 Float16Array、显式资源管理（explicit resource management）、`RegExp.escape`、WebAssembly Memory64、`Error.isError` [1]。
2. **自带 npm 11** [1]（升级 npm 大版本，脚本与 CI 里注意兼容）。
3. **Windows 编译工具链变化**：从 Node.js 24 开始**移除 MSVC 支持，在 Windows 上编译 Node.js 本身需要 ClangCL** [1]。注意这说的是编译 Node.js 这个运行时本身，不等于对原生扩展（addon）编译工具链的同一条要求。
4. **AsyncLocalStorage 默认改用 AsyncContextFrame** 实现 [1]，官方称性能更好、对高级场景更稳健。
5. **`URLPattern` 成为全局对象**，无需显式 import 即可使用 [1]。
6. **权限模型 flag 更名**：`--experimental-permission` 改为 `--permission` [1]（官方表述是这"表明其稳定性提升、为更广泛采用做好准备"，并非宣告完全稳定）。
7. **test runner 自动等待子测试结束**，不必再手动 await 子测试的 Promise [1]。
8. **内置 Undici 7**（HTTP 客户端能力更新）[1]。
9. **弃用与移除**（举例，非穷举）：`url.parse()` 运行时弃用（建议改用 WHATWG URL API）、移除已弃用的 `tls.createSecurePair`、`SlowBuffer` 运行时弃用等 [1]。

## 三、22 侧对应的亮点（供对照）

Node 22.0.0 的官方摘要亮点是：支持 `require()` 加载 ESM 图、WebSocket 客户端、V8 更新等 [3]；其中 WebSocket 默认启用、`require()` 同步 ESM 图支持均列在该版本的变更中 [3]。换到 24 后，这些在 22 已有的能力仍然在，主要增量是上面第二节的内容。

## 四、从 22 升到 24 的实用检查清单

- **Windows 自建 Node 的团队**：改用 ClangCL 工具链（MSVC 已不支持编译 Node.js 本体）[1]。
- **CI/脚本**：检查 npm 11 带来的 npm 行为差异 [1]。
- **用权限模型的**：把 `--experimental-permission` 换成 `--permission` [1]。
- **用 `url.parse()` 的**：按官方提示迁移到 WHATWG URL API [1]。
- **写测试的**：可去掉手动 await 子测试的样板代码，注意测试结束时机语义变化 [1]。
- **需要具体 JS 新特性（如 Float16Array 等）**：来自 V8 13.6 升级 [1]，可直接体验。
- 22→24 之间的完整变更（含 23 的偶数/奇数版本周期内容）未在本文逐一审计，超出上述官方 24.0.0 说明与 22.0.0 说明的部分**未在官方资料中确认**。

## 出处

1. [Node.js 24.0.0 (Current) — Node.js 官方发布说明](https://nodejs.org/en/blog/release/v24.0.0)，capturedAt: 2026-10-10T04:33:37.857Z —
   - "2025-05-06, Version 24.0.0 (Current), @RafaelGSS and @juanarbol"
   - "Node.js 24 will enter long-term support (LTS) in October, but until then, it will be the \"Current\" release for the next six months."
   - "The V8 engine is updated to version 13.6"
   - "Node.js 24 comes with npm 11"
   - "Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."
   - "AsyncLocalStorage now uses AsyncContextFrame by default"
   - "The URLPattern API is now exposed on the global object"
   - "the flag has been changed from --experimental-permission to simply --permission"
   - "The test runner module now automatically waits for subtests to finish"
   - "Node.js 24 includes Undici 7"
   - "Runtime deprecation of url.parse() - use the WHATWG URL API instead (#55017)"
   - "Removal of deprecated tls.createSecurePair (#57361)"
2. [Node.js CHANGELOG_V24.md 官方变更日志页](https://github.com/nodejs/blob/main/CHANGELOG_V24.md)，capturedAt: 2026-10-10T04:33:32.380Z — 仅用于确认 24 分支变更日志存在，未据其断言任何具体数值（中间版本号不作为已发布值引用）。
3. [Node.js 22.0.0 (Current) — Node.js 官方发布说明](https://nodejs.org/en/blog/release/v22.0.0)，capturedAt: 2026-10-10T04:34:03.295Z —
   - "2024-04-24, Version 22.0.0 (Current), @RafaelGSS and @marco-ippolito"
   - "Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!"
   - "(SEMVER-MAJOR) deps: update V8 to 12.4.254.14 (Michaël Zasso) #52465"
   - "(SEMVER-MAJOR) lib: enable WebSocket by default (Aras Abbasi) #51594"
   - "(SEMVER-MINOR) module: support require()ing synchronous ESM graphs (Joyee Cheung) #51977"
4. [Node.js Releases — 官方版本状态表](https://nodejs.org/en/about/previous-releases)，capturedAt: 2026-10-10T04:34:04.140Z —
   - "v24 Krypton May 06, 2025 Sep 07, 2026 LTS"
   - "v22 Jod Apr 24, 2024 Sep 23, 2026 LTS"

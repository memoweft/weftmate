# Node.js 24 相比 22 值得留意的变化（简要说明）

> 整理日期：2026-10-09，内容基于 Node.js 官方发布说明、Changelog 与官方文档。

## 0. 一句话结论

Node.js 24 是当前的 Active LTS（代号 Krypton），比 22 更新了 V8 引擎（13.6 vs 12.4）、npm（11 vs 10）、Undici（7），并带来一批语言层新特性与 API 变化；同时**原生模块 ABI 变了（NODE_MODULE_VERSION 127 → 137），C++ 扩展必须重新编译**，且有一批 API 进入运行时弃用，`url.parse()`、`shell: true` + `args` 等旧写法需要排查。22 已进入维护期（2025-10-21 起），只收安全与关键修复。

## 1. 版本状态与支持周期

| 版本 | 状态 | 代号 | 首发 | 进入 Active LTS | 进入维护期 | 停止支持 |
|---|---|---|---|---|---|---|
| 22.x | Maintenance LTS | Jod | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| 24.x | Active LTS | Krypton | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| 26.x | Current | — | 2026-05-05 | 2026-10-28 | 2027-10-20 | 2029-04-30 |

- 今天（2026-10-09）24 仍是 Active LTS，**2026-10-20 起转入维护期**；偶数大版本维护到 EOL 前都还会有安全更新。
- 26 已经是 Current（2026-05-05 发布），所以"24 不是最新的大版本"，但 24/26 都受支持。
- 来源：[Node.js Release Working Group – Release schedule](https://github.com/nodejs/release#release-schedule)

## 2. 运行时与内置依赖升级

| 项目 | Node 22 | Node 24 | 说明 |
|---|---|---|---|
| V8 引擎 | 12.4（22.0.0） | **13.6** | 直接决定可用的 JS 语法与性能特性 |
| npm | 10.x（22.x 分支内置 10.9.9） | **11.x（内置 11.19.0）** | 升级后注意 lockfile/CI 里的 npm 版本 |
| Undici（fetch/HTTP 客户端栈） | — | **Undici 7** | `fetch`、`headers` 等行为随之更新 |
| 原生扩展 ABI | NODE_MODULE_VERSION **127** | NODE_MODULE_VERSION **137** | C++/N-API 之外的老式原生模块**必须重新编译**；N-API 模块通常无需改动 |

来源：[Node.js 24.0.0 发布说明](https://nodejs.org/en/blog/release/v24.0.0)、[Node.js 22.0.0 发布说明](https://nodejs.org/en/blog/release/v22.0.0)、[v24.x 分支 npm 版本](https://github.com/nodejs/node/blob/v24.x/deps/npm/package.json)

## 3. 语言层新特性（来自 V8 13.6）

- `Float16Array`：半精度浮点 TypedArray。
- **显式资源管理**（explicit resource management）：`using` / `await using` 与 `Symbol.dispose`，适合文件、连接这类自动释放场景。
- `RegExp.escape()`：安全转义正则元字符。
- `Error.isError()`：跨 realm 可靠判断 Error。
- WebAssembly Memory64：WASM 可用超过 4GB 内存。

来源：[Node.js 24.0.0 发布说明](https://nodejs.org/en/blog/release/v24.0.0)

## 4. Node.js API / 行为变化

- **AsyncLocalStorage 默认改用 AsyncContextFrame 实现**：性能更好、追踪更稳，官方认为更健壮；如你依赖旧实现细节需要回归测试。
- **`URLPattern` 成为全局对象**：不必再引入，可直接做 URL 模式匹配。
- **权限模型**：`--experimental-permission` 改名为 `--permission`，稳定性提升（注：22 的较新维护版本也已同步该 flag，见 [22.x 权限文档](https://nodejs.org/docs/latest-v22.x/api/permissions.html)）。
- **`node:test` 测试运行器**：会自动等待子测试结束，不必再手动 `await` 测试 promise。
- **TypeScript 支持转为稳定**：24 官方文档标注 *Stability 2 – Stable*，默认对可擦除语法做类型剥离；22 文档标注 *1.2 – Release candidate*。注意关闭开关在文档中的写法不同（24 为 `--no-strip-types`，22 为 `--no-experimental-strip-types`），enum 等需转换的语法仍要 `--experimental-transform-types`。
- **http2**：新增会话跟踪与优雅关闭（semver-major 行为变化）。
- **readline**：对已关闭后调用的函数做更严格校验。

来源：[Node.js 24.0.0 发布说明](https://nodejs.org/en/blog/release/v24.0.0)、[Node 24 TypeScript 文档](https://nodejs.org/docs/latest-v24.x/api/typescript.html)、[Node 22 TypeScript 文档](https://nodejs.org/docs/latest-v22.x/api/typescript.html)

## 5. 弃用与移除（升级前建议全局搜一遍）

| 变化 | 影响 |
|---|---|
| `url.parse()` **运行时弃用** | 仍可用但会告警 → 改用 WHATWG `new URL()` |
| `tls.createSecurePair()` **已移除** | 直接报错 → 用 `tls.connect()` / `TLSSocket` |
| `Buffer.SlowBuffer` 运行时弃用并走向 EOL | 用 `Buffer.allocUnsafe` 等替代 |
| `child_process`：`shell: true` 时给 `spawn`/`execFile` 传 `args` 被弃用（DEP0190） | 这类写法本就易引发注入/转义问题，需改为拼接命令或 `shell: false` + 参数数组 |
| 不带 `new` 调 REPL、不带 `new` 用 Zlib 类 | 告警 → 补 `new` |
| readline / http2 / `fs` 等若干 semver-major 行为调整 | 详见完整 Changelog |

来源：[Node.js 24.0.0 发布说明（Deprecations and Removals）](https://nodejs.org/en/blog/release/v24.0.0)、[PR #57199 – spawn/execFile + shell:true 的 args 弃用](https://github.com/nodejs/node/pull/57199)、[Node 24 弃用清单](https://nodejs.org/docs/latest-v24.x/api/deprecations.html)

## 6. 构建与平台（Windows 用户注意）

- **Windows 上移除 MSVC 支持，编译 Node 必须使用 ClangCL**：只影响自编译 Node 或做嵌入式构建的场景；安装官方预编译安装包不受影响。
- armv7（32 位 ARM）降级为实验性支持；移除 s390 32 位构建。

来源：[Node.js 24.0.0 发布说明](https://nodejs.org/en/blog/release/v24.0.0)

## 7. 升级检查清单（22 → 24）

1. 重编译原生模块（ABI 127 → 137），CI 里换 `node@24` 镜像与对应 node-gyp。
2. 全局搜索 `url.parse`、`createSecurePair`、`SlowBuffer`、`shell: true` + `args` 等弃用写法。
3. 升级 npm 11：检查 lockfile 版本、脚本里的 npm 命令行为差异。
4. 跑一遍依赖 `AsyncLocalStorage`、http2、readline 的代码的回归测试。
5. 想用新语法（`using`、`Float16Array`、`RegExp.escape`）时确认 V8 13.6 已到位。
6. 顺带留意：22 已是维护期版本，只出安全修复；新特性只进 24 及以上。

## 8. 这些不是 24 的新东西（22 就有）

避免误判：`require()` 加载 ESM、内置 WebSocket 客户端、`node --run`、`fs.glob/globSync`、`node --watch` 转稳定、类型剥离（22.6.0 起）都是 **22** 就提供的。

来源：[Node.js 22.0.0 发布说明](https://nodejs.org/en/blog/release/v22.0.0)

## 9. 主要来源链接

- Node.js 24.0.0 发布说明：https://nodejs.org/en/blog/release/v24.0.0
- Node.js 22.0.0 发布说明：https://nodejs.org/en/blog/release/v22.0.0
- Node.js 24 完整 Changelog：https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md
- Node.js 22 完整 Changelog：https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V22.md
- 发布计划与 LTS 状态：https://github.com/nodejs/release#release-schedule
- 官方文档（v24）：https://nodejs.org/docs/latest-v24.x/api/
- 官方文档（v22）：https://nodejs.org/docs/latest-v22.x/api/
- 弃用清单（DEP 编号）：https://nodejs.org/docs/latest-v24.x/api/deprecations.html
- 历次版本公告：https://nodejs.org/en/blog/release/

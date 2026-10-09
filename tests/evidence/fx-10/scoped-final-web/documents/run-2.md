# Node.js 24 相比 22 值得留意的变化（简要）

整理时间：2026-10-09。以下内容均来自 Node.js 官方发布说明与官方发布周期表。

## 一、版本状态（先看这个）

| 版本 | 状态 | 代号 | 首发 | 进入维护 | 停止支持 |
|---|---|---|---|---|---|
| 22.x | 维护期 LTS（Maintenance LTS） | Jod | 2024-04-24 | 2025-10-21 | 2027-04-30 |
| 24.x | 活跃 LTS（Active LTS） | Krypton | 2025-05-06 | 2026-10-20 | 2028-04-30 |
| 26.x | Current | — | 2026-05-05 | 2027-10-20 | 2029-04-30 |

- 24 已于 2025-10-28 进入 Active LTS，是当前适合生产升级的主力版本；22 只接收关键修复和安全更新，将于 2027-04-30 EOL。
- 24.x 将在 2026-10-20 进入维护期（即本文件整理后约一周），此后以关键修复和安全更新为主。
- 双数版本才会进入 LTS；奇数版本（如 25）不进 LTS、很快 EOL。

## 二、24 的主要新变化（对比 22 时代）

### 运行时与语言
- **V8 升级到 13.6**（22.0.0 时为 12.4），随之可用的新语言特性：`Float16Array`、**显式资源管理（`using` / `await using`）**、`RegExp.escape`、WebAssembly Memory64、`Error.isError`。
- **`AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现**：异步上下文跟踪性能更好、更健壮。行为上仍是同一 API，但对性能敏感的链路值得实测。
- **`URLPattern` 成为全局对象**，无需 import 即可使用（类似 URL 版的正则匹配）。
- **`require(esm)` 默认开启**：需注意——这一项在 22.12.0（2024-12-03）就已经默认开启，并非 24 独有；仍在旧 22 小版本上的话升级到 22 最新即可获得。含顶层 `await` 的 ESM 仍不能被 require（会抛 `ERR_REQUIRE_ASYNC_MODULE`）。可用 `process.features.require_module` 检测。

### 工具链与依赖
- **自带 npm 11**。
- **Windows 源码编译不再支持 MSVC，必须用 ClangCL**。只用官方预编译安装包（installer / 二进制）的人不受影响；自行从源码构建或依赖老构建脚本的项目需要改工具链。
- **Undici 升级到 7**，fetch / 内置 HTTP 客户端性能与协议支持更好。

### 权限与安全
- 实验性权限模型的启动参数由 `--experimental-permission` 改为 **`--permission`**，意味着它更稳定、可考虑用于收紧运行环境权限（文件、子进程、worker 等）。

### 测试
- 内置测试运行器会**自动等待子测试完成**，不必再手动 `await` 每个 test promise，常见"未处理 Promise"问题减少。

### 弃用与移除（升级时最需要排查的部分）
- **`url.parse()` 运行时弃用**：会直接打出 DeprecationWarning，官方建议改用 WHATWG `URL` API。这是升级后最常撞到的一条。
- **移除 `tls.createSecurePair()`**：用到的代码会直接报错。
- **`Buffer` 的 `SlowBuffer` 进入 EOL**（运行时弃用）。
- **`shell: true` 时向 `spawn` / `execFile` 传 `args` 被弃用**（DEP0190）：因为这种写法只是拼接字符串、并无真正转义，容易引发注入问题；写法本身将不再受支持（见 PR 链接）。
- 其他弃用：不带 `new` 直接调用 REPL、不带 `new` 使用 Zlib 类。
- 内部 **ABI 版本号 `NODE_MODULE_VERSION` 升到 137**：原生 C++ 扩展（native addon）必须针对 24 重新编译。
- HTTP/2 服务端优雅关闭与会话跟踪属 semver-major 改动；`readline` 关闭后的调用校验更严格。

## 三、升级建议（一句话版）

1. 先在 22 最新小版本（22.12+）上把 `url.parse()`、`SlowBuffer`、`shell:true` + `args` 这几类弃用警告清零。
2. 升到 24 后重点回归：原生扩展重编译（ABI 137）、Windows 源码构建改 ClangCL、`AsyncLocalStorage` 性能表现、`npm 11` 兼容性。
3. 24 仍是 Active LTS（维护期起点 2026-10-20，EOL 2028-04-30），比 22（2027-04-30 EOL）有更长支持窗口，新项目建议直接 24。

## 来源

- Node.js 24.0.0 发布说明：https://nodejs.org/en/blog/release/v24.0.0
- Node.js 22 发布公告：https://nodejs.org/en/blog/announcements/v22-release-announce
- Node.js 22.12.0 发布说明（require(esm) 默认开启）：https://nodejs.org/en/blog/release/v22.12.0
- 官方发布周期表（nodejs/release）：https://github.com/nodejs/release#release-schedule
- spawn/execFile 传参弃用（DEP0190，nodejs/node PR #57199）：https://github.com/nodejs/node/pull/57199

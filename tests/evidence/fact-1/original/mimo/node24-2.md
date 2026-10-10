# Node.js 24 相比 22 值得留意的变化（简短版）

> 依据 Node.js 官方发布说明与官方发布页面整理，访问时间：2026-10-10（北京时间）。
> 结论先行：**24 是从 22 升级时值得认真评估的一代**——V8 大版本升级带来新语法，AsyncLocalStorage 底层实现变化、若干 API 运行时弃用、Windows 下用 MSVC 自编译不再支持，这几项与日常开发/运维关系最大。

## 1. 版本与生命周期

- Node.js 24.0.0 于 2025-05-06 发布，发布时为 "Current"，官方说明它将在 2025 年 10 月进入 LTS [1]。
- 官方发布页当前显示：v24 代号 Krypton，首版 2025-05-06，最近更新 2026-09-07，状态为 **LTS**；v22（代号 Jod）同为 LTS [2]。
- 两者都是偶数大版本、都处于 LTS，因此从"能否上生产"的角度看差别不大；真正的差别在下面的技术变化。

## 2. 语言与运行时（V8 升级）

24 将 V8 升级到 13.6，带来这些新特性 [1]：

- **Float16Array**（半精度浮点 TypedArray）
- **显式资源管理**（`using` / `await using`）
- **`RegExp.escape`**
- **WebAssembly Memory64**
- **`Error.isError`**

如果你的代码要兼容 Node 22，注意这些语法/接口在 22 上不可用，需要构建期转译或降级。

## 3. 与日常开发最相关的几项

- **AsyncLocalStorage 默认改用 AsyncContextFrame**：官方称这是"更高效的异步上下文跟踪实现"，可提升性能并让高级场景更健壮 [1]。对使用 ALS 的框架/中间件（链路追踪、请求上下文）属于行为与性能敏感的底层变化，升级后建议跑一遍相关测试。
- **`URLPattern` 成为全局对象**：无需显式 import 即可使用 [1]。
- **npm 11** 随 Node 24 发布 [1]。
- **测试运行器**：`t.test()` / `test()` 不再返回需要手动 await 的 promise，改为自动等待子测试完成 [1]。
- **权限模型**：实验性开关从 `--experimental-permission` 改名为 `--permission` [1]。依赖旧写法的脚本/CI 参数需要同步修改。

## 4. 需要警惕的弃用与移除（升级会直接遇到）

官方 24.0.0 说明列出的相关条目 [1]：

- **`url.parse()` 运行时弃用**——请改用 WHATWG URL API。
- **移除已弃用的 `tls.createSecurePair`**。
- **`SlowBuffer` 运行时弃用**（后续提交中并入 EOL 流程）。
- **REPL 不加 `new` 直接实例化**运行时弃用。
- **Zlib 类不加 `new` 使用**被弃用。
- **`child_process` 的 `spawn` / `execFile` 传参方式**被弃用（官方发布说明的弃用清单中明确列出该项）。
- 此外，`fs.existsSync` 传入无效类型、`fs.F_OK`/`fs.R_OK`/`fs.W_OK`/`fs.X_OK`、`zlib` 类不用 `new` 等也出现在 24 的 semver-major 提交列表中 [1]。

对存量代码建议：先全局搜 `url.parse(`、`createSecurePair`、`SlowBuffer`、`spawn`/`execFile` 的传参写法，升级前完成替换。

## 5. 构建与平台（影响自编译和原生模块）

- **Windows 上移除 MSVC 支持，自编译 Node 24 必须使用 ClangCL** [1]。使用官方预编译安装包的用户不受影响；自己编译 Node 或维护原生模块构建链的团队需要更新工具链。
- `NODE_MODULE_VERSION`（原生模块 ABI 版本号）在 24 中更新为 **137**，22 为 **134**（取自两版发布说明中的 semver-major 提交记录）[1]。意味着 **22 编译的原生扩展不能直接在 24 上加载，需要为 24 重新编译**（用 prebuild/`node-gyp` 等按目标版本重建）。

## 6. 其他值得注意的运行时变化

- **HTTP 客户端升级到 Undici 7**，性能与新 HTTP 特性支持更好 [1]。
- `assert.partialDeepStrictEqual()` 标记为稳定；`fetch` 可在 `NODE_USE_ENV_PROXY` 下走 HTTP 代理（均见 24 的 semver-minor 列表）[1]。

## 7. 迁移建议（简版）

1. 先跑依赖兼容性检查：重点是**原生模块**（需按新 ABI 137 重建）和**直接用 V8 新特性的代码**（不能在 22 上跑）。
2. 全局替换 24 中运行时弃用/移除的 API（`url.parse`、`tls.createSecurePair`、`SlowBuffer` 等）。
3. 检查 CI/启动脚本里的权限开关参数（`--experimental-permission` → `--permission`）。
4. 若在 Windows 自编译，切换到 ClangCL 工具链。
5. 对使用 `AsyncLocalStorage`、测试运行器、`child_process` 传参的代码做针对性回归测试。

---

## 出处

1. [Node.js 24.0.0 (Current) 官方发布说明](https://nodejs.org/en/blog/release/v24.0.0)，抓取于 2026-10-10T02:49:25.571Z。原文："This release brings several significant updates, including the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11. Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."；关于 V8 新特性："The V8 engine is updated to version 13.6, which includes several new JavaScript features: Float16Array / Explicit resource management / RegExp.escape / WebAssembly Memory64 / Error.isError"；关于 ALS："AsyncLocalStorage now uses AsyncContextFrame by default, which provides a more efficient implementation of asynchronous context tracking."；关于权限模型："the flag has been changed from --experimental-permission to simply --permission"；关于测试运行器："The test runner module now automatically waits for subtests to finish, eliminating the need to manually await test promises."；关于弃用："Runtime deprecation of url.parse() - use the WHATWG URL API instead"、"Removal of deprecated tls.createSecurePair"、"Deprecation of passing args to spawn and execFile in child_process"。
2. [Node.js Releases（官方版本状态页）](https://nodejs.org/en/about/releases/)，抓取于 2026-10-10T02:49:41.141Z。原文（表格行）："v24 | Krypton | May 06, 2025 | Sep 07, 2026 | LTS"、"v22 | Jod | Apr 24, 2024 | Sep 23, 2026 | LTS"。
3. ABI 版本号（134/137）取自出处 1 中 24.0.0 发布说明的 semver-major 提交记录 "src: update NODE_MODULE_VERSION to 137"；22 的 134 未在本次抓取的片段中单独引用，如需精确引用请以 Node 22 对应发布说明为准。

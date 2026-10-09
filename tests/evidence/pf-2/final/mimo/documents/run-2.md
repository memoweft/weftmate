# Node.js 24 相比 22 值得留意的变化（简要说明）

> 对比基准：两条线的**初始大版本**——v24.0.0（2025-05-06）与 v22.0.0（2024-04-24），依据官方发布公告；个别"默认开启"类说明补充了官方后续公告。版本敏感的表述均已限定版本号。

## 1. 版本与支持状态、系统要求

- **v24（代号 Krypton）**：2025-05-06 发布 → 2025-10-28 进入 LTS → 2026-10-20 起进入维护期 → 2028-04-30 结束支持。
- **v22（代号 Jod）**：2024-04-24 发布 → 2024-10-29 进入 LTS → 2025-10-21 起已处于维护期 → 2027-04-30 结束支持。
- 也就是说：**两条线目前都还受支持**，但 22 已在维护期（只接收关键修复/安全更新），24 很快（2026-10-20）也进入维护期。新项目优先 24。
- 24 的最低系统要求提高（相对 22）：
  - macOS 最低 **13.5**，并要求较新的 Xcode（官方提交记录标注 16.1 起）；
  - 移除 32 位 PowerPC（ppc32）构建支持；
  - 构建 Node 本身不再支持 Python 3.8；
  - **Windows 上编译 Node/原生模块必须使用 ClangCL**，MSVC 支持已移除。

来源：[v24.0.0 发布公告](https://nodejs.org/en/blog/release/v24.0.0)、[v22.0.0 发布公告](https://nodejs.org/en/blog/release/v22.0.0)、[官方 release schedule](https://github.com/nodejs/release?tab=readme-ov-file#release-schedule)

## 2. 运行时与语言特性

- **V8 引擎**：22 基线为 V8 12.4，24 升到 **V8 13.6**，随之带来一批新的 JavaScript 能力：
  - **显式资源管理**（`using` / `await using`，自动释放资源）；
  - `Float16Array`、`RegExp.escape()`、`Error.isError()`；
  - WebAssembly **Memory64** 支持。
- **权限模型更名**：`--experimental-permission` 改为 **`--permission`**，实验标志减少一层，说明它在向默认可用靠拢。
- **AsyncLocalStorage 默认改用 AsyncContextFrame 实现**（官方主打的异步上下文性能改进，API 不变）。
- **`URLPattern` 成为全局对象**，无需引入。
- **`require(ESM)`**：在 22.0 中还需 `--experimental-require-module` 标志，到 22.12（2024-12）才默认开启；24 作为后续主线版本默认可用（官方仍标注为实验特性，可用 `--no-experimental-require-module` 关闭）。`require()` 遇到含顶层 `await` 的 ESM 仍会报 `ERR_REQUIRE_ASYNC_MODULE`。
- 22 引入、24 继续保留的基线特性（22 上未启用过的代码可一并享受）：`node --run`、WebSocket 客户端默认启用、`node --watch` 监听模式稳定、`fs.glob()/globSync()`、`require()` 加载同步 ESM 图。

来源：[v24.0.0 公告](https://nodejs.org/en/blog/release/v24.0.0)、[v22.0.0 公告](https://nodejs.org/en/blog/release/v22.0.0)、[v22.12.0 公告（require(esm) 默认开启）](https://nodejs.org/en/blog/release/v22.12.0)

## 3. 标准库与工具链

- **npm 升到 11**（随 Node 24 分发）；HTTP 客户端 **Undici 升到 7**（影响内置 `fetch` 的实现细节）。
- 内置 `fetch` 支持通过 `NODE_USE_ENV_PROXY` 等环境变量启用 HTTP 代理。
- **测试运行器行为变化（semver-major）**：`test()` / `t.test()` 不再返回 promise，会**自动等待子测试**结束——异步断言不再需要手动 `await` 子测试，旧写法需要调整。
- **原生模块 ABI 更新**：`NODE_MODULE_VERSION` 在 24 中为 **134**，与 22 不同，C++ 原生扩展需按新 ABI 重新编译（直接拷贝旧 `.node` 文件会加载失败）。

来源：[v24.0.0 公告](https://nodejs.org/en/blog/release/v24.0.0)

## 4. 迁移注意点（从 22 升到 24）

1. **原生模块重编译**：ABI 版本变化（24 为 134）+ Windows 编译必须 ClangCL，CI/构建脚本要同步更新。
2. **已被移除的 API**：
   - `tls.createSecurePair()`（旧的 TLS 建立方式，早已弃用）；
   - `dirent.path` 属性。
3. **运行时弃用（升级后会打印 DeprecationWarning，建议尽早改写）**：
   - `url.parse()` —— 官方建议改用 WHATWG `URL`；
   - `fs.F_OK / R_OK / W_OK / X_OK` 常量 —— 改用 `fs.constants`；
   - `new SlowBuffer()` —— 改用 `Buffer`；
   - `fs.existsSync()` 传入非法类型参数；
   - zlib 类不带 `new` 直接调用；
   - `child_process.spawn/execFile` **在 `shell: true` 时传入 `args` 数组**会被弃用（因为 args 只是拼接并非转义，易引入注入问题）——注意这**只针对 `shell: true` 场景**，普通的 `spawn(cmd, args)` 参数数组用法不受影响。
4. **测试代码**：适配 test runner 自动等待子测试的新行为（见第 3 节）。
5. **22 上已经淘汰、24 上更要注意的**：`crypto.createCipher()/createDecipher()` 已在 22 移除（EOL，改用 `createCipheriv()`）；ES import assertions 的 `assert` 语法已移除（改用 `with`）。

来源：[v24.0.0 公告](https://nodejs.org/en/blog/release/v24.0.0)、[v22.0.0 公告](https://nodejs.org/en/blog/release/v22.0.0)、[child_process 弃用 PR #57199](https://github.com/nodejs/node/pull/57199)

## 来源汇总

- Node.js v24.0.0 发布公告：https://nodejs.org/en/blog/release/v24.0.0
- Node.js v22.0.0 发布公告：https://nodejs.org/en/blog/release/v22.0.0
- Node.js v22.12.0 发布公告（require(esm) 默认开启）：https://nodejs.org/en/blog/release/v22.12.0
- Node.js 官方发布计划（schedule.json）：https://raw.githubusercontent.com/nodejs/release/main/schedule.json
- 官方发布计划说明：https://github.com/nodejs/release#release-schedule

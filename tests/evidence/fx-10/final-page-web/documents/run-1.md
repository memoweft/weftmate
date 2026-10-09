# Node.js 24 相比 22 值得留意的变化（简要说明）

> 整理时间：2026-10-09。依据均为官方资料：Node.js 官方博客发布说明、官方 API 文档、官方发布计划仓库（nodejs/release）。文末附来源链接。

---

## 一、先看支持周期（选版本时最重要的事实）

| 版本 | 状态（代号） | 首发 | 进入 LTS | 进入维护期 | EOL |
|---|---|---|---|---|---|
| 24.x | **Active LTS**（Krypton） | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| 22.x | Maintenance LTS（Jod） | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 |

- **24 是当前的主力 LTS**；按官方计划 **2026-10-20 起 24 进入维护期**（只剩关键修复和安全更新），日期官方注明"可能调整"。
- 22 已在维护期，只出安全/关键修复，**2027-04-30 EOL**。
- 另外：26.x 才是现在的 Current 版，奇数版 25 已 EOL——按 Node.js 规则只有偶数版本才有 LTS。新项目建议直接 24，22 上的项目可按节奏迁移到 24。

## 二、24.0.0 带来的新变化（对比 22.0.0 基线）

1. **V8 引擎 12.4 → 13.6**，随之可用的新语言特性：`Float16Array`、显式资源管理（`using` / explicit resource management）、`RegExp.escape`、WebAssembly Memory64、`Error.isError`。
2. **npm 10 → npm 11**（22 自带 npm 10）。
3. **AsyncLocalStorage 默认改用 AsyncContextFrame** 实现（性能更好、更健壮；AsyncResource 也同步接入）。依赖 async_hooks 的东西（APM / OpenTelemetry / 各类链路追踪、消息队列封装）升级后值得回归测试。
4. **`URLPattern` 成为全局对象**，无需 import。
5. **权限模型**：实验开关 `--experimental-permission` 更名为 `--permission`，稳定性提高；子进程可继承相关标志。
6. **测试运行器 `node:test`**：
   - 自动等待子测试结束，不再需要手动 await；
   - `test()` / `t.test()` **不再返回 Promise**（semver-major，旧测试里 `await t.test(...)` 的写法要改）；
   - 新增全局 setup / teardown。
7. **Undici 7**：`fetch` 底层 HTTP 客户端大版本升级（22 为 Undici 6），性能与新 HTTP 特性支持更好。
8. **其他值得知道的 24 新增**：
   - `fetch` 可通过 `NODE_USE_ENV_PROXY` 环境变量走 HTTP 代理；
   - `worker.getHeapStatistics()`、AsyncLocalStorage 新增 `defaultValue` / `name` 选项；
   - `assert.partialDeepStrictEqual()` 转为稳定；
   - WebAssembly source phase imports、顶层 Wasm 导入；`import.meta` 相关属性毕业（转正）；
   - http2 增加会话跟踪与优雅关闭语义（semver-major，行为有变）。

## 三、升级时要检查的弃用 / 移除项

- **`url.parse()` 运行时弃用** → 改用 WHATWG `new URL()`（这是最容易命中的一条）。
- 移除 `tls.createSecurePair`；`setOptions` 等旧 tls 接口结束生命周期。
- `SlowBuffer` 运行时弃用（EOL）→ 用 `Buffer.alloc` / `Buffer.allocUnsafe` 等。
- 不带 `new` 调用 REPL、zlib 类 → 弃用。
- `child_process.spawn/execFile` 的某些旧式传参方式被弃用（PR #57199）。
- `fs`：移除 `Dirent#path`；`fs.existsSync` 传非法类型、`fs.F_OK` 等常量运行时弃用。
- 移除 32 位 ppc、s390（32 位）支持；armv7 降为实验性。

## 四、构建与原生模块（最容易踩坑的部分）

- **ABI 变了**：`NODE_MODULE_VERSION` 22 = 127 → **24 = 137**。原生 C++ 插件必须针对 24 重新编译；**N-API（node-api）模块 ABI 稳定，不受影响**。
- **Windows 编译 Node 本体不再支持 MSVC，要求 ClangCL**；macOS 最低版本提高到 13.5、Xcode ≥ 16.1；构建不再支持 Python 3.8。只影响自行编译 Node 或相关工具链的场景，日常用官方安装包不受影响。

## 五、容易误会的点：这些 22 的新线其实也有了（不算 24 独占）

- **`require(esm)` 默认开启**：22.0 还要 `--experimental-require-module`，**22.12 起默认开启**（24 同样默认）。
- **TypeScript 类型剥离默认执行 `.ts`**：22.6 实验引入，**22.18 起在 22 线默认开启**；24 也默认开启（`--no-strip-types` 关闭，`--experimental-transform-types` 支持 enum 等需代码生成的语法）。注意：不做类型检查、不读 tsconfig.json、`node_modules` 下的 `.ts` 不处理。
- `import.meta.main`：22.18 起可用。
- WebSocket 全局对象、`node --run`、`fs.glob/globSync`、`--watch` 稳定：22.0 就有。
- 升级 24 前如果还在 22 早期小版本，建议先升到 22 最新小版本，这些能力两边对齐后再迁，diff 会小很多。

## 来源链接（官方）

1. [Node.js 24.0.0 发布说明（官方博客）](https://nodejs.org/en/blog/release/v24.0.0)
2. [Node.js 22.0.0 发布说明（官方博客）](https://nodejs.org/en/blog/release/v22.0.0)
3. [官方发布计划与各版本状态/EOL（nodejs/release）](https://github.com/nodejs/release)
4. [Node.js 24 官方文档 · TypeScript 模块](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
5. [v22.18.0 发布说明（类型剥离默认开启）](https://nodejs.org/en/blog/release/v22.18.0)
6. [v22.12.0 发布说明（require(esm) 默认开启）](https://nodejs.org/en/blog/release/v22.12.0)
7. [Node.js 官方博客（含迁移指南）](https://nodejs.org/en/blog)

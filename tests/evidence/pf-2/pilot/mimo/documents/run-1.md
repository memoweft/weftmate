# Node.js 24 相比 22 值得留意的变化（简要说明）

> 依据官方发布说明整理，2026-10-09 查阅。两个版本都已过当前（Current）阶段：24 与 22 均已进入 LTS 支持期。

## 一、支持周期先看清（决定要不要升）

| 版本 | 状态（2026-10） | 代号 | 首发 | Active LTS | 进入维护 | EOL |
|---|---|---|---|---|---|---|
| 22.x | Maintenance LTS | Jod | 2024-04-24 | 2024-10-29 | 2025-10-21 | **2027-04-30** |
| 24.x | Active LTS | Krypton | 2025-05-06 | 2025-10-28 | **2026-10-20** | **2028-04-30** |

- 22 已进入维护期（只修关键 bug 和安全问题），24 是当前的 Active LTS，新功能只进 LTS 分支里的合适改动。
- 新项目建议直接 24；存量项目在 22 的 EOL（2027-04-30）前完成迁移即可，不必急。

## 二、Node 24 的主要新变化

1. **V8 升级到 13.6**，带来一批新的 JavaScript 语言特性：
   - `Float16Array`
   - **显式资源管理**（`using` / `await using`，即 Explicit resource management）
   - `RegExp.escape()`
   - `Error.isError()`
   - WebAssembly Memory64
2. **npm 升级到 11**（自带，性能与安全改进，对现代包兼容性更好）。
3. **`AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现**：异步上下文追踪更高效、更健壮；属于底层实现切换，普通用法无感，但依赖旧行为的极端场景值得回归测试。
4. **`URLPattern` 成为全局对象**，无需 `import` 即可直接使用（类似对 URL 做正则匹配）。
5. **权限模型改进**：实验性标志从 `--experimental-permission` 改名为 **`--permission`**，稳定性提升；已在用旧标志的启动脚本需改。
6. **测试运行器增强**：会自动等待子测试结束，`test()` / `t.test()` 不再返回需要手动 `await` 的 Promise（semver-major 行为变化，老测试代码可能要调整）。
7. **Undici 升级到 7**：内置 HTTP 客户端性能更好、支持更新的 HTTP 特性。

## 三、弃用与移除（升级前要排查的破坏性项）

- `url.parse()` **运行时弃用**——请改用 WHATWG `URL` API。
- 移除 `tls.createSecurePair()`。
- `Buffer.SlowBuffer` 运行时弃用。
- 不用 `new` 直接实例化 REPL 运行时弃用。
- 不用 `new` 直接使用 Zlib 类被弃用。
- `child_process.spawn` / `execFile` **以参数数组形式传参**被弃用（另有 `net._setSimultaneousAccepts`、`server.setOptions` 等进入 EOL）。
- **Windows 构建不再支持 MSVC，必须用 ClangCL**；同时最低支持 macOS 升到 13.5、最低 Xcode 16.1，移除 32 位 PowerPC 构建。只影响自行编译 Node 或原生模块的场景。
- 原生扩展 ABI 版本号（`NODE_MODULE_VERSION`）升为 134，**原生 addon 需要按 24 重新编译**。

## 四、注意：22 已有的能力，24 不会"新增"

Node 22 引入的 `require()` 加载 ESM、内置 WebSocket 客户端、`node --run`、`fs.glob` / `fs.globSync`、稳定的 `--watch` 等，22→24 升级不会带来变化；真正要关注的是上文 24 的新特性和弃用项。

## 五、升级检查清单

1. 搜代码里的 `url.parse`、`SlowBuffer`、`tls.createSecurePair`、zlib/REPL 直接实例化写法。
2. 确认启动参数里 `--experimental-permission` 是否要改成 `--permission`。
3. 重新编译原生 addon（ABI 134）。
4. Windows 自建环境从 MSVC 切到 ClangCL。
5. 跑一遍测试套件，确认 `node:test` 的自动等待子测试行为不影响现有断言。

## 来源

- Node.js 24.0.0 发布说明：<https://nodejs.org/en/blog/release/v24.0.0/>
- Node.js 22.0.0 发布说明：<https://nodejs.org/en/blog/release/v22.0.0/>
- 官方发布周期表（nodejs/release）：<https://github.com/nodejs/release>

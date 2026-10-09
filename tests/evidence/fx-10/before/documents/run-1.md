# Node.js 24 相比 22 值得留意的变化（简要说明）

整理时间：2026-10-09。依据 Node.js 官方发布说明与官方发布计划整理，供下班后快速浏览。

## 一、版本状态先看清楚

| 版本线 | 状态 | 代号 | 首发 | Active LTS | 维护期起 | EOL |
|---|---|---|---|---|---|---|
| 22.x | 维护中 LTS | Jod | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| 24.x | 活跃 LTS | Krypton | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| 26.x | Current | — | 2026-05-05 | 2026-10-28 | 2027-10-20 | 2029-04-30 |

- 24 是当前推荐的 LTS，但按计划 **2026-10-20 起进入维护期**（只出关键修复和安全更新）。
- 22 已进入维护期，2027-04-30 EOL；新项目建议直接上 24。
- 偶数版才有 LTS，奇数版（23、25）已 EOL。

## 二、语言与运行时（V8 13.6，22 是 12.4）

24 随 V8 13.6 带来的新 JS 能力：

- `Float16Array`（半精度浮点 TypedArray）
- **显式资源管理**（explicit resource management，`using` / `await using`）
- `RegExp.escape()`
- WebAssembly Memory64
- `Error.isError()`

22 侧的对照（当时已带）：`Iterator` 全局对象、V8 Maglev JIT 默认开启、流默认 `highWaterMark` 提升等。

## 三、标准库与 API 变化（升级最需要关注的部分）

- **`AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现**：性能更好、异步上下文跟踪更稳健；可用 `--no-async-context-frame` 回退。依赖 ALS 内部实现细节的代码要回归测试。
- **`URLPattern` 成为全局对象**：无需 import 即可使用，URL 模式匹配类似正则匹配字符串。
- **权限模型**：`--experimental-permission` 更名为 **`--permission`**，稳定性提升，更适合生产容器化场景限权。
- **Undici 7（fetch 底层）**：HTTP 客户端性能与新特性改进；新增 `NODE_USE_ENV_PROXY` 让 `fetch` 支持读环境变量走 HTTP 代理。
- **`node:test` 测试运行器**（有破坏性变更）：
  - 自动等待子测试结束，`test()` / `t.test()` 不再返回 Promise，**原来手写 `await t.test(...)` 的代码会报错或需调整**；
  - 新增全局 setup/teardown、mock JSON 模块、`--test-timeout` 按单测生效等。
- 其他：`assert.partialDeepStrictEqual()` 转正为稳定 API；`import.meta` 系列属性转正；顶层 WebAssembly 模块与 source phase import 支持；`worker.getHeapStatistics()`；`node:sqlite` 增加事务检测、`setReturnArrays()`、超时选项、聚合函数；TypeScript 类型剥离（直接跑 `.ts`）被标记为 release candidate。

## 四、弃用与移除（升级前先扫一遍代码）

- **`url.parse()` 运行时弃用** —— 改用 WHATWG `URL` / `URLSearchParams`（最常见的迁移点）。
- **移除**：`tls.createSecurePair()`、`fs.Dirent.path`、用文件描述符调用 `fs.truncate()`、`lib` 中过时的 Cipher 导出、6 个 `process.binding`。
- 运行时弃用：`SlowBuffer`、不带 `new` 直接调 REPL / Zlib 类、`fs.F_OK` 等常量、`repl.builtinModules`。
- 弃用：向 `child_process.spawn/execFile` 传参的旧写法（改为 options 形式）。
- 22 已生效的背景项：`util.is*` 系列与 `util._extend/log` 运行时弃用、`createCipher/createDecipher` 移除、import assertions 移除（改 `with`）。

## 五、构建与工具链（如果你要自己编译或跑原生插件）

- **Windows 上不再支持 MSVC，必须用 ClangCL 编译 Node 24**；最低 macOS 13.5 / Xcode 16.1；不再支持 Python 3.8；移除 ppc32、s390 32 位，armv7 降级为实验性。
- **官方下载不再提供 Windows 32 位（x86）安装包**（22 还有）。
- 内置 **npm 升到 11**（22 为 npm 10）；npm 独立发布，也可自行升级。
- `NODE_MODULE_VERSION` 升至 **137**（22 为 127）：**非 N-API 的原生扩展必须重新编译**；N-API/`node-gyp` 常规模块不受影响。
- 文档已预告 corepack 将在 v25+ 移除，需自行安装包管理器。

## 六、升级建议（22 → 24）

1. 先跑一遍测试，重点覆盖 `AsyncLocalStorage`、`url.parse`、测试运行器相关代码。
2. 检查原生依赖是否为 N-API，非 N-API 的重新编译。
3. Windows 上自编译的，提前准备 ClangCL 工具链。
4. 生产环境可试用 `--permission` 限制文件/网络访问。

## 来源链接

- Node.js 24.0.0 官方发布说明：https://nodejs.org/en/blog/release/v24.0.0
- Node.js 22.0.0 官方发布说明：https://nodejs.org/en/blog/release/v22.0.0
- 官方发布计划与 LTS 时间表：https://github.com/nodejs/release#release-schedule
- Node.js 24 API 文档：https://nodejs.org/docs/v24.0.0/api/
- 官方弃用项一览：https://nodejs.org/api/deprecations.html
- 历史版本发布列表：https://nodejs.org/en/blog/release/v24.0.1 （可沿 Previous/Next 浏览各版 changelog）

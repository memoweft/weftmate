# Node.js 24 相比 22 值得留意的变化（简要说明）

> 对比基准：两个大版本的首个正式版 —— Node.js 22.0.0（2024-04-24）与 Node.js 24.0.0（2025-05-06）。资料来自 Node.js 官方发布博客与官方版本页。

## 1. 版本定位

| 版本 | 代号 | 首发 | 状态（截至 2026-09） |
| --- | --- | --- | --- |
| v24 | Krypton | 2025-05-06 | LTS（2025 年 10 月进入长期支持） |
| v22 | Jod | 2024-04-24 | LTS |

- 两个都是偶数版 LTS 线，生产环境建议使用 Active LTS / Maintenance LTS 版本。
- 24 发布后先做了 6 个月的 "Current" 阶段，2025 年 10 月才进入 LTS；22 同理于 2024 年 10 月进入 LTS。
- 官方规则：LTS 通常保证关键 bug 修复共 30 个月，因此 24 的支持窗口比 22 更长。

## 2. Node 24 的主要新特性（22 没有的）

1. **V8 升级到 13.6**（22.0.0 是 V8 12.4），带来一批新的 JS 能力：
   - `Float16Array`
   - 显式资源管理（explicit resource management，`using`/`await using`）
   - `RegExp.escape`
   - WebAssembly Memory64
   - `Error.isError`
2. **npm 11**（22 自带 npm 10）。
3. **AsyncLocalStorage 默认使用 AsyncContextFrame** 实现，异步上下文跟踪性能更好、更稳健。
4. **`URLPattern` 成为全局对象**，无需 import 即可用于 URL 模式匹配。
5. **权限模型（Permission Model）更名**：`--experimental-permission` → **`--permission`**，稳定性提高，更适合推广使用。
6. **测试运行器增强**：`test()` / `t.test()` 自动等待子测试完成，不再需要手动 await；相应地也不再返回 Promise（属破坏性变化）。
7. **Undici 7**（内置 HTTP 客户端栈升级）。
8. **构建要求变化**：Windows 上**移除 MSVC 支持，必须用 ClangCL 编译**；同时提高最低 macOS（13.5）与 Xcode（16.1）版本，Node 24 的 ABI 为 NODE_MODULE_VERSION 134。

## 3. 破坏性变更与弃用（升级 24 时重点检查）

- **`url.parse()` 运行时弃用** → 改用 WHATWG `URL` API（#55017）。
- **移除 `tls.createSecurePair`**（#57361）；`server.setOptions` 等也已走到生命周期终点。
- **`SlowBuffer` 运行时弃用并进入 EOL** → 用 `Buffer`。
- **`child_process.spawn/execFile` 传参方式弃用**（#57199），需检查调用写法。
- **Zlib 类不带 `new` 直接调用被弃用**（#55718）。
- **不带 `new` 实例化 REPL 被运行时弃用**（#54869）。
- **测试运行器不再返回 `t.test()`/`test()` 的 Promise**（#56664），老测试代码可能要改写。
- `fs.existsSync` 传入非法类型、`net._setSimultaneousAccepts`、若干 timers 方法等也列入弃用/EOL。
- 基础要求：最低支持 Python 3.9（移除 3.8）、移除 32 位 PowerPC 支持。

> 作为参照，22.0.0 当年的变化：`require()` 加载 ESM 模块图、内置 WebSocket 客户端默认启用、`node --run`、`fs.glob`/`fs.globSync`、watch 模式转稳定，以及 `createCipher`/`createDecipher` 退役等（本文不再展开）。

## 4. 升级建议（简短版）

1. 先停在 22 的最新 LTS 修补版，再升 24；偶数版 LTS 可直接跨大版本。
2. 重点自查三类代码：`url.parse()`、`child_process` 传参、测试运行器里依赖 `test()` 返回值的写法。
3. Windows 上需要自建 Node 的团队要换成 ClangCL 工具链。
4. 原生模块需针对 ABI 134 重新编译（Node-API 模块通常不受影响）。
5. 顺带留意 npm 11 与 Undici 7 带来的依赖/网络行为差异。

## 5. 来源链接

- [Node.js 24.0.0 (Current) 发布公告](https://nodejs.org/en/blog/release/v24.0.0)
- [Node.js 22.0.0 (Current) 发布公告](https://nodejs.org/en/blog/release/v22.0.0)
- [Node.js 官方版本与状态页（Previous Releases）](https://nodejs.org/en/about/previous-releases)
- [Node.js 官方博客（各版本发布公告索引）](https://nodejs.org/en/blog)

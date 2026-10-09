# Node.js 24 相比 22 值得留意的变化（简短版）

> 对比基准：**v24.0.0（2025-05-06 发布）** vs **v22.0.0（2024-04-24 发布）**，即两个大版本的初始版本，不涉及后续补丁与回移版本。
> 两者都是偶数版本、都走 LTS 线：v24 代号 Krypton，v22 代号 Jod，目前均为 LTS 状态（见官方版本一览）。

## 一、运行时新能力

1. **V8 引擎 12.4 → 13.6**，带来一批新的 JS 特性：
   - `Float16Array`（半精度浮点数组）
   - 显式资源管理（`using` / `await using`）
   - `RegExp.escape()`
   - `Error.isError()`
   - WebAssembly Memory64
2. **npm 10 → 11**：性能、安全性与对现代 JS 包的兼容性改进。
3. **AsyncLocalStorage 默认改用 AsyncContextFrame 实现**：异步上下文跟踪更高效，也更健壮。
4. **`URLPattern` 成为全局对象**：URL 模式匹配（类似正则之于字符串）不用再显式 import。
5. **内置 fetch 底层客户端升级到 Undici 7**：HTTP 性能与新协议特性支持更好。
6. **权限模型**：`--experimental-permission` 改名为 `--permission`，趋于稳定。

> 作为基线参考，v22 当时带来的主要变化是：`require()` 可加载同步 ESM 依赖图、内置 WebSocket 客户端默认启用、`node --run <script>`、`fs.glob()/globSync`、`--watch` 转稳定版。

## 二、需要留意的破坏性变化（semver-major）

1. **测试运行器行为变化**：现在会自动等待子测试结束，不需要再手动 await 测试 promise，减少"未处理 promise"这类常见错误；老代码里的等待写法要相应调整。
2. **主要弃用与移除**（升级时重点排查）：
   - `url.parse()` **运行时弃用** → 改用 WHATWG `URL` API
   - `tls.createSecurePair` **已移除**
   - `SlowBuffer` **运行时弃用**
   - 不带 `new` 实例化 REPL **运行时弃用**；zlib 各类不带 `new` 使用也已弃用
   - `spawn`/`execFile` 在 `{ shell: true }` 时传 `args` 的写法被弃用——注意**只针对 shell:true 这一场景**（因为参数其实只是拼接、并未转义，易出安全问题），普通传参数组不受影响
   - 其他：`server.prototype.setOptions` 进入 EOL、`fs.existsSync` 参数类型校验变严、若干 timers 方法 EOL、6 个 `process` 内部 bindings 不再对外暴露
3. 完整清单见 release 页里的 **Semver-Major Commits** 列表。

## 三、构建与运行环境（影响自编译和原生模块）

- **Windows 不再支持 MSVC**，用源码编译 Node.js（或相关原生模块）必须改用 **ClangCL**。
- 构建最低要求提升：macOS 13.5、Xcode 16.1；不再支持 Python 3.8。
- 移除 32 位 PowerPC（ppc32）平台支持，armv7 降级为 experimental。
- 模块 ABI 版本号（NODE_MODULE_VERSION）有变化：**原生 addon 需要针对 Node 24 重新编译**，不能直接复用 Node 22 的二进制。

## 四、升级建议（一句话版）

生产环境从 22 升 24 时，重点检查四件事：`url.parse` 用法、`child_process` 在 `shell:true` 下的传参、测试运行器的 await 写法、以及 Windows 下原生模块的重编译；其余大多是开箱即得的新特性。

## 来源链接

- [Node.js 24.0.0 发布公告（官方博客）](https://nodejs.org/en/blog/release/v24.0.0)
- [Node.js 22.0.0 发布公告（官方博客）](https://nodejs.org/en/blog/release/v22.0.0)
- [官方版本状态一览（代号与 LTS 状态）](https://nodejs.org/en/about/releases/)
- [PR #57199：spawn/execFile 在 shell:true 下传 args 的弃用说明](https://github.com/nodejs/node/pull/57199)

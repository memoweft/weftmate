# Node.js 24 相比 22 值得留意的变化（简短说明）

整理时间：2026-10-09（账号时区 Asia/Shanghai）。对比基准：**24.0.0 初始版**（2025-05-06 发布）与 **22.0.0 初始版**（2024-04-24 发布）的官方发布说明，并结合两条分支当前维护中的最新小版本。所有内容来自 Node.js 官方资料，链接见文末。

## 1. 先看版本状态（2026-10-09）

| 分支 | 代号 | 首发 | 当前状态 | 最新版本 | 支持期 |
|---|---|---|---|---|---|
| v24 | Krypton | 2025-05-06 | Active LTS（2026-10-20 转 Maintenance） | 24.21.0（2026-09-08） | 至 2028-04-30 |
| v22 | Jod | 2024-04-24 | Maintenance LTS | 22.23.3（2026-09-23） | 至 2027-04-30 |

- 24 不是最新主线：v26 自 2026-05-05 起是 Current。
- 22 仍在维护（安全/关键修复），但已进入维护期；官方建议生产环境只使用 Active LTS 或 Maintenance LTS 版本。
- 两条分支都在持续出小版本，下文标了“初始版”的差异指 24.0.0 引入、22.0.0 没有的东西。

## 2. v24.0.0 官方重点变化

1. **V8 升级到 13.6**（22.0.0 是 V8 12.4），随之可用的新 JS 特性：`Float16Array`、**显式资源管理**（`using` / `await using`）、`RegExp.escape`、WebAssembly Memory64、`Error.isError`。
2. **npm 升到 11**（24 自带）；22 分支一直是 npm 10 系列（如 22.18.0 自带 npm 10.9.3）。升级后注意 lockfile 与 CI 里 npm 版本的差异。
3. **`AsyncLocalStorage` 默认改用 `AsyncContextFrame` 实现**，官方称异步上下文跟踪更高效、更健壮。
4. **`URLPattern` 成为全局对象**，不用再手动 import。
5. **权限模型更进一步**：`--experimental-permission` 改名为 `--permission`，稳定性提升。
6. **测试运行器（`node:test`）自动等待子测试完成**，不再需要手动 `await` 子测试 promise，写测试更省心。
7. **Undici 7**：内置 fetch / HTTP 客户端大版本更新，性能与 HTTP 特性支持更好。
8. **废弃与移除（升级时最容易踩的坑）**：
   - `url.parse()` **运行时废弃** → 改用 WHATWG `URL`；
   - `SlowBuffer` 进入 EOL（运行时废弃）；
   - 移除已废弃的 `tls.createSecurePair()`；
   - 不带 `new` 直接调用 REPL、Zlib 类 → 废弃；
   - 给 `child_process` 的 `spawn` / `execFile` 传参数的老写法 → 废弃。
9. **Windows 构建变化**：不再支持 MSVC，Windows 上从源码编译 Node 需要用 **ClangCL**（只用官方二进制安装包的人不受影响）。

## 3. 从 22 升到 24 的实际兼容点

- **原生扩展（C/C++ addon）必须重新编译**：`NODE_MODULE_VERSION` 从 22 的 127 变为 24 的 137，ABI 不兼容，直接换 Node 版本会导致加载失败。
- 用到 `url.parse`、`tls.createSecurePair`、`SlowBuffer`、不带 `new` 调 zlib/REPL 的代码需要迁移或加兼容处理。
- 依赖内建 npm 的流程（Docker 镜像、CI 缓存）要按 npm 11 调整。

## 4. 别误判：这些不是 24 独占（22 新小版本也有）

- **`require(esm)` 默认开启**：22.12.0 起 22 分支就默认开启了（24 同样默认），不要当成 24 才有的能力。
- **直接运行 `.ts`（类型剥离 type stripping）**：23.6.0 起默认开启、24 继承；**22 分支在 22.18.0 也回移了默认开启**。所以最新 22.x 同样可以直接 `node file.ts`（仍不支持 enum、namespace 运行时代码、装饰器等需编译的语法，见官方 TypeScript 文档）。
- 结论：判断某能力“24 才有”，要看 22.x 的最新小版本，而不是 22.0.0。

## 来源链接

- Node.js 24.0.0 发布说明：https://nodejs.org/en/blog/release/v24.0.0
- Node.js 22.0.0 发布说明：https://nodejs.org/en/blog/release/v22.0.0
- 版本状态与更新日期总表：https://nodejs.org/en/about/releases/
- 官方发布计划（各分支 LTS/维护/EOL 日期）：https://github.com/nodejs/release
- 22.12.0：`require(esm)` 默认开启：https://nodejs.org/en/blog/release/v22.12.0
- 22.18.0：类型剥离默认开启、npm 10.9.3：https://nodejs.org/en/blog/release/v22.18.0
- 23.6.0：`--experimental-strip-types` 默认开启：https://nodejs.org/en/blog/release/v23.6.0
- Node.js 24 完整变更日志（最新 24.21.0）：https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md
- Node.js 22 完整变更日志（最新 22.23.3）：https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V22.md
- 官方 TypeScript 运行支持文档：https://nodejs.org/api/typescript.html

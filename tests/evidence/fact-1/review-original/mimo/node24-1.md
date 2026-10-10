# Node.js 24 相比 22 值得留意的变化（简要说明）

> 比较基准：两个大版本的**初始发布**——Node.js 24.0.0（2025-05-06，Current）[1] 与 Node.js 22.0.0（2024-04-24，Current）[2]。本文只依据这两个版本的官方发布说明，不涉及后续小版本的回移。两版发布时都计划在当年 10 月进入 LTS。[1][2]

## 一、运行时与语言特性（Node 24）

- **V8 13.6、npm 11**：24.0.0 升级了 V8 JavaScript 引擎到 13.6、npm 到 11。[1]（22.0.0 时 V8 为 12.4.254.14。[2]）
- **V8 13.6 带来的新语言/运行时能力**：Float16Array、显式资源管理（explicit resource management）、RegExp.escape、WebAssembly Memory64、Error.isError。[1]
- **AsyncLocalStorage 默认改用 AsyncContextFrame**，并且 **URLPattern 现在是全局可用**。[1]
- **权限模型 flag 改名**：从 `--experimental-permission` 改为 `--permission`。[1]

## 二、Node 22 引入、到 24 已是基线的能力

以下由 22.0.0 引入，在 24 上仍然重要（升级到 24 等于继承这些能力）：

- 支持 **`require()` 加载同步 ESM 图**（require()ing synchronous ESM graphs）[2]；
- **WebSocket 客户端默认启用**[2]；
- 新增 **`node --run <script-in-package-json>`** 与 **`fs.glob` / `fs.globSync`**[2]；
- **`--watch` 标记为稳定**[2]；
- **移除 import assertions**（drop support for import assertions）[2]；
- **stream 默认 `highWaterMark` 提高**（bump default highWaterMark）[2]。

## 三、构建与工具链（Node 24）

- **Windows 上编译要求变化**：已移除 MSVC 支持，在 Windows 上编译 Node.js 现在**要求使用 ClangCL**。[1]（注意：官方此句针对的是**编译 Node.js 本体**，并未在该处规定原生扩展/addon 的编译规则。）
- **内置 Undici 7**。[1]
- **test runner**：其模块现在会**自动等待子测试（subtests）结束**。[1]

## 四、弃用与移除（Node 24 需要留意）

- `url.parse()` **运行时弃用**——改用 WHATWG URL API。[1]
- **移除**已弃用的 `tls.createSecurePair`。[1]
- `SlowBuffer` **运行时弃用**。[1]
- 向 `child_process` 的 `spawn` 和 `execFile` **传递 args 被弃用**（是弃用，非移除）。[1]

## 五、升级时的实务建议

1. 在 Windows 上自建 Node 时，先切换到 ClangCL 工具链；仅针对编译 Node.js 本体这一要求。[1]
2. 检查启动参数里是否还有 `--experimental-permission`，按新名 `--permission` 调整。[1]
3. 排查代码中仍在使用的 `url.parse()`、`tls.createSecurePair`、`SlowBuffer` 以及给 `spawn`/`execFile` 直接传 args 的写法。[1]
4. 若从 22 直接升到 24，22 引入的 ESM `require()`、默认 WebSocket、`node --run`、`fs.glob` 等默认行为变化需要一并纳入测试范围。[2]

---

### 出处

[1] [Release 2025-05-06, Version 24.0.0 (Current), @RafaelGSS and @juanarbol · nodejs/node](https://github.com/nodejs/node/releases/tag/v24.0.0)，capturedAt: 2026-10-10T02:55:30.065Z
> "2025-05-06, Version 24.0.0 (Current), @RafaelGSS and @juanarbol"；"the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"；"support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows"；"The AsyncLocalStorage API now uses AsyncContextFrame by default, and URLPattern is available globally."；"Node.js 24 will enter long-term support (LTS) in October"；"Float16Array / Explicit resource management / RegExp.escape / WebAssembly Memory64 / Error.isError"；"the flag has been changed from --experimental-permission to simply --permission"；"The test runner module now automatically waits for subtests to finish"；"Node.js 24 includes Undici 7"；"Runtime deprecation of url.parse() - use the WHATWG URL API instead (#55017)"；"Removal of deprecated tls.createSecurePair (#57361)"；"Runtime deprecation of SlowBuffer (#55175)"；"Deprecation of passing args to spawn and execFile in child_process (#57199)"

[2] [Release 2024-04-24, Version 22.0.0 (Current), @RafaelGSS and @marco-ippolito · nodejs/node](https://github.com/nodejs/node/releases/tag/v22.0.0)，capturedAt: 2026-10-10T02:55:30.254Z
> "2024-04-24, Version 22.0.0 (Current), @RafaelGSS and @marco-ippolito"；"Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!"；"Node.js 22 will enter long-term support (LTS) in October, but until then, it will be the \"Current\" release for the next six months."；"[02b0bc01fe] - (SEMVER-MAJOR) deps: update V8 to 12.4.254.14 (Michaël Zasso) #52465"；"[c975384264] - (SEMVER-MAJOR) lib: enable WebSocket by default (Aras Abbasi) #51594"；"[1abff07392] - (SEMVER-MAJOR) stream: bump default highWaterMark (Robert Nagy) #52037"；"[4f68c7c1c9] - watch: mark as stable (Moshe Atlow) #52074"；"[128c60d906] - (SEMVER-MINOR) cli: implement node --run <script-in-package-json> (Yagiz Nizipli) #52190"；"[151d365ad1] - (SEMVER-MINOR) fs: expose glob and globSync (Moshe Atlow) #51912"；"[5f7fad2605] - (SEMVER-MINOR) module: support require()ing synchronous ESM graphs (Joyee Cheung) #51977"；"[25c79f3331] - esm: drop support for import assertions (Nicolò Ribaudo) #52104"

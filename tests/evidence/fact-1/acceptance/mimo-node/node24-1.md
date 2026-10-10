# Node.js 24.0.0 相比 22.0.0 值得留意的变化

> 对比基准：两个大版本的**初始发布页**——Node.js 24.0.0（2025-05-06，Current）与 Node.js 22.0.0（2024-04-24，Current）。下述版本号均指这两个初始版本，不涉及其后的补丁回移。

## 一、Windows 工具链：编译 Node.js 本身已必须用 ClangCL

Node.js 24.0.0 的发布说明在亮点段落中写明：**从 Node.js 24 起，Windows 上编译 Node.js 已移除 MSVC 支持，改要求 ClangCL** [1]。这是一条 SEMVER-MAJOR 的构建层变更，影响的是**构建 Node.js 本体**的工具链要求；官方发布页并未就此声明"第三方原生扩展不得用 MSVC 编译"，该点未在官方资料中确认。

Node.js 22.0.0 的发布日志中对应的 Windows 工具链变更是编译标准，而非编译器更换：`[2b1e7c2fcb] - (SEMVER-MAJOR) build: compile with C++20 support on Windows`（Windows 上改用 C++20 编译）[2]。**22.0.0 发布时 Windows 是否仍以 MSVC 为工具链，未在官方资料中确认**（发布日志只列出各构建提交，未给出单一结论句）；可确认的是 24.0.0 发布页明确写出了 MSVC 移除与 ClangCL 必选 [1]。

另有两点与 Windows 构建相关的留意项：

- 24.0.0 发布日志含 `(SEMVER-MAJOR) build: add /bigobj to compile V8 on Windows` 等提交，说明 24 在 Windows 上还有其他构建适配，`/bigobj` 属于为 V8 目标加的编译选项，与"工具链换成 ClangCL"不是同一层次 [1]。
- 24.0.0 的 Permission Model 实验旗标已由 `--experimental-permission` 改为 `--permission`，发布页称其"indicating its increasing stability and readiness for broader adoption"（表明其稳定性提升、为更广泛采用做好准备）[1]。

## 二、原生扩展兼容：默认 ABI 不匹配则拒绝加载，Node-API 是例外

### 2.1 普通原生扩展：跨大版本默认需要重新编译

`src/node_version.h` 中的注释说明了加载规则（22.0.0 与 24.0.0 两个 tag 的该文件此段注释一致）[4][5]：

> Node.js will refuse to load modules with a non-matching ABI version.

以及：

> Node.js will refuse to load modules that weren't compiled against its own module ABI number, exposed as the process.versions.modules property.

配套的官方 process 文档同样写明：`process.versions.modules indicates the current ABI version, which is increased whenever a C++ API changes. Node.js will refuse to load modules that were compiled against a different module ABI version.`（C++ API 变更时该 ABI 版本号会递增；Node.js 会拒绝加载按不同模块 ABI 版本编译的模块）[6]。

同时 Node-API 官方文档也给出了反向印证：**Node-API 之外的其他 Node.js 部分并不提供 ABI 稳定性保证**，包括 the Node.js C++ APIs、the libuv APIs、the V8 API [3]。因此，直接使用 V8/Node C++ API 或 libuv API 写的原生扩展，在 22 与 24 之间跨大版本使用时需按上述规则重新编译（推断依据为 [6] 的"increased whenever a C++ API changes" + [4][5] 的拒绝加载规则 + [3] 的非稳定声明）。

### 2.2 Node-API（N-API）：ABI 稳定的例外

Node-API 官方文档（"Implications of ABI stability"）写明 [3]：

> This API will be Application Binary Interface (ABI) stable across versions of Node.js. It is intended to insulate addons from changes in the underlying JavaScript engine and allow modules compiled for one major version to run on later major versions of Node.js without recompilation.

即：**按一个主版本编译的 Node-API 模块，可在之后的主版本上不重新编译直接运行**——这是普通模块 ABI 不匹配规则的明确例外。其成立条件与边界（同节原文）[3]：

- 例外并非无条件：`Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not.`（Node-API 有保证，Node.js 其他部分以及扩展所用外部库不一定有）
- 需独占使用 Node-API：`Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using #include <node_api.h>`
- 未提供跨大版本 ABI 稳定保证的 API：`none of the following APIs provide an ABI stability guarantee across major versions: the Node.js C++ APIs ... the libuv APIs ... the V8 API`（原文以 API 名列出，非头文件名）。

## 三、NODE_MODULE_VERSION：22.0.0 = 127，24.0.0 = 137

以**版本 tag**（非 changelog 提交）的 `src/node_version.h` 为准 [4][5]：

| 版本 | `NODE_MODULE_VERSION` |
|---|---|
| Node.js 22.0.0 | **127** |
| Node.js 24.0.0 | **137** |

（另：24.0.0 的 `NODE_API_SUPPORTED_VERSION_MAX` 为 10，22.0.0 为 9 [4][5]——这是 Node-API 版本范围宏，与上面的模块 ABI 号不是同一个量。）

需要注意的限定与例外 [4][5]：

- 该宏是**默认值，可被嵌入者覆盖**：`Embedders building Node.js can define NODE_EMBEDDER_MODULE_VERSION to`（定义后 `#define NODE_MODULE_VERSION NODE_EMBEDDER_MODULE_VERSION`），即嵌入版 Node.js 的实际模块 ABI 号可能是别的值。
- **主版本发布线内不改**：`Node.js will not change the module version during a Major release line`——127/137 是这两条初始发布线各自的值；两个大版本之间递增则与 [6] "increased whenever a C++ API changes" 一致。
- 用途与"拒绝加载"规则见第 2.1 节；查询方式为 `process.versions.modules`（即该 ABI 号的运行时暴露）[6]。
- 官方还有嵌入者 ABI 版本注册表（`doc/abi_version_registry.json`），供嵌入方登记其自定义模块版本（本次未抓取该文件原文，其内容未在官方资料中确认）。

## 四、其他值得留意的差异（24.0.0 相对 22.0.0）

- **V8 / npm**：24.0.0 升级 V8 至 13.6、npm 至 11 [1]；22.0.0 发布页亮点含 V8 引擎更新（其 V8 具体版本号以该版 tag 为准，本次未逐字核对，未在官方资料中确认）[2]。
- **语言/平台特性（24.0.0）**：`AsyncLocalStorage API now uses AsyncContextFrame by default`（默认改用 AsyncContextFrame），`URLPattern is available globally`（URLPattern 全局可用）[1]。
- **24.0.0 其余亮点**：V8 13.6 带来 Float16Array、显式资源管理（explicit resource management）、`RegExp.escape`、WebAssembly Memory64、`Error.isError` 等 [1]。
- **22.0.0 亮点**：`require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!` [2]。
- **支持节奏**：两个版本发布时均声明"将在当年 10 月进入 LTS，在此之前保持 Current 六个月"——即 24.0.0 于 2025 年 10 月、22.0.0 于 2024 年 10 月进入 LTS [1][2]；24.0.0 本身在 tag 内 `NODE_VERSION_IS_LTS` 为 0（初始发布非 LTS）[4]。

---

## 出处

[1] [2025-05-06, Version 24.0.0 (Current) | Node.js](https://nodejs.org/en/blog/release/v24.0.0)，capturedAt 2026-10-10T03:08:16.802Z，"Starting with Node.js 24, support for MSVC has been removed, and ClangCL is now required to compile Node.js on Windows."；"including the upgrade of the V8 JavaScript engine to version 13.6 and npm to version 11"；"The AsyncLocalStorage API now uses AsyncContextFrame by default, and URLPattern is available globally."；"the flag has been changed from --experimental-permission to simply --permission"；`[9c1ebb713c] - (SEMVER-MAJOR) build: add /bigobj to compile V8 on Windows`；"As a reminder, Node.js 24 will enter long-term support (LTS) in October, but until then, it will be the \"Current\" release for the next six months."

[2] [2024-04-24, Version 22.0.0 (Current) | Node.js](https://nodejs.org/en/blog/release/v22.0.0)，capturedAt 2026-10-10T03:08:17.295Z，"Highlights include require()ing ESM graphs, WebSocket client, updates of the V8 JavaScript engine, and more!"；`[2b1e7c2fcb] - (SEMVER-MAJOR) build: compile with C++20 support on Windows (StefanStojanovic) #52465`；"Node.js 22 will enter long-term support (LTS) in October, but until then, it will be the \"Current\" release for the next six months."

[3] [Node-API | Node.js v26.11.1 Documentation](https://nodejs.org/api/n-api.html#implications-of-abi-stability)，capturedAt 2026-10-10T03:08:27.845Z，"This API will be Application Binary Interface (ABI) stable across versions of Node.js. It is intended to insulate addons from changes in the underlying JavaScript engine and allow modules compiled for one major version to run on later major versions of Node.js without recompilation."；"Although Node-API provides an ABI stability guarantee, other parts of Node.js do not, and any external libraries used from the addon may not."；"none of the following APIs provide an ABI stability guarantee across major versions: ... the Node.js C++ APIs ... the libuv APIs ... the V8 API"；"Thus, for an addon to remain ABI-compatible across Node.js major versions, it must use Node-API exclusively by restricting itself to using #include <node_api.h>"

[4] [nodejs/node v24.0.0 · src/node_version.h](https://raw.githubusercontent.com/nodejs/node/v24.0.0/src/node_version.h)，capturedAt 2026-10-10T03:08:40.868Z，"#define NODE_MODULE_VERSION 137"；"Node.js will refuse to load modules that weren't compiled against its own module ABI number, exposed as the process.versions.modules property."；"Node.js will refuse to load modules with a non-matching ABI version."；"Node.js will not change the module version during a Major release line"；"Embedders building Node.js can define NODE_EMBEDDER_MODULE_VERSION to"

[5] [nodejs/node v22.0.0 · src/node_version.h](https://raw.githubusercontent.com/nodejs/node/v22.0.0/src/node_version.h)，capturedAt 2026-10-10T03:08:40.709Z，"#define NODE_MODULE_VERSION 127"；"Node.js will refuse to load modules with a non-matching ABI version."；"Embedders building Node.js can define NODE_EMBEDDER_MODULE_VERSION to"

[6] [Process | Node.js v26.11.1 Documentation](https://nodejs.org/api/process.html)，capturedAt 2026-10-10T03:08:17.911Z，"process.versions.modules indicates the current ABI version, which is increased whenever a C++ API changes. Node.js will refuse to load modules that were compiled against a different module ABI version."

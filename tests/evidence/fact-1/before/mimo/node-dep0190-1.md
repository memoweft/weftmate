# Node.js 24.0.0 中 DEP0190 对 `child_process.spawn`/`execFile` 的 `args` 的影响

## 结论摘要

DEP0190 的准确标题是：**"Passing `args` to `node:child_process` `execFile`/`spawn` with `shell` option `true`"**。
它弃用的不是"给 `spawn`/`execFile` 传 `args`"本身，而是一个非常具体的组合：

**当同时指定 `{ shell: true }` 选项时，再向 `child_process.execFile()` 或 `child_process.spawn()` 传入 `args` 数组。**

- **触发条件（唯一）**：调用 `child_process.execFile()` 或 `child_process.spawn()`，且 options 中带有 `shell: true`，并且还传入了 `args` 数组。不带 `shell: true` 的常规 `spawn`/`execFile` 调用**不受影响**。
- **弃用阶段与类型**：**Runtime（运行时弃用）**，于 **v24.0.0** 生效（PR [#57199](https://github.com/nodejs/node/pull/57199)）。此前在 v23.11.0 / v22.15.0 中先以 Documentation-only（仅文档弃用）形式引入（PR [#57389](https://github.com/nodejs/node/pull/57389)）。
- **原因（官方原文）**：当把 `args` 数组与 `{ shell: true }` 一起使用时，数组元素**不会被转义，只会用空格拼接**，可能导致 **shell 注入（shell injection）**。

## 详细说明

Node.js 文档原文（v24.0.0）：

> When an `args` array is passed to `child_process.execFile` or `child_process.spawn` with the option `{ shell: true }`, the values are not escaped, only space-separated, which can lead to shell injection.

由于在 v24.0.0 中它是 **Runtime** 类型的弃用：

- 默认情况下，**第一次**使用该模式（且调用方代码不从 `node_modules` 加载）时，会向 `stderr` 打印一次进程警告；
- 加载自 `node_modules` 的代码默认**不会**触发警告，除非使用 `--pending-deprecation`（或环境变量 `NODE_PENDING_DEPRECATION=1`）；
- 使用 `--throw-deprecation` 时，该警告会变成抛出错误。

该弃用在 v24.0.0 的发布说明中被列为 "Deprecation of passing args to spawn and execFile in child_process (#57199)"，属于 SEMVER-MAJOR 变更。

> 注意区分：DEP0196 是另一个与 `child_process` 相关的弃用（`options.shell` 为空字符串 `''`，Documentation-only），与 DEP0190 无关。

## 建议

1. **不要**在 `shell: true` 的同时给 `spawn`/`execFile` 传 `args` 数组——这正是被弃用的危险组合，参数未转义、易受 shell 注入影响。
2. 正确做法二选一：
   - 需要 shell 语法（管道、通配符等）时：使用 `child_process.exec()` / `execSync()`，把完整命令字符串自己拼好并转义；
   - 需要传参数数组时：去掉 `shell: true`，让 Node 直接以参数数组方式 `spawn`（这种模式不受 DEP0190 影响），必要时对单个参数自行转义。
3. 升级到 Node.js 24 后，用 `--pending-deprecation` 跑一遍测试，提前发现 `node_modules` 里触发该模式的代码。

## 来源

- [Node.js 官方弃用文档 DEP0190（v24.x）](https://nodejs.org/docs/latest-v24.x/api/deprecations.html#DEP0190)
- [DEP0190 原文（v24.0.0 源码 doc/api/deprecations.md）](https://github.com/nodejs/node/blob/v24.0.0/doc/api/deprecations.md)
- [Node.js v24.0.0 发布博客](https://nodejs.org/en/blog/release/v24.0.0)
- [PR #57199 — child_process: deprecate passing args to spawn and execFile](https://github.com/nodejs/node/pull/57199)
- [PR #57389（v23.11.0/v22.15.0 的文档级弃用）](https://github.com/nodejs/node/pull/57389)

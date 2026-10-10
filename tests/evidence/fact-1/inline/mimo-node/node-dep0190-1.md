# Node.js 24.0.0 的 DEP0190：对 child_process.spawn/execFile 的 args 的影响

## 结论摘要

DEP0190「Passing args to node:child_process execFile/spawn with shell option」在 Node.js 24.0.0 中生效。它并不禁用或删除 `args` 参数，而是弃用这种组合用法：**当向 `child_process.execFile` 或 `child_process.spawn` 传入 `args` 数组，同时又设置 `shell: true` 或 `shell: '/path/to/shell'` 时**，参数值不会被转义、只是用空格拼接，可能导致 shell 注入[1]。

## 准确的触发条件

同时满足以下两点才触发 DEP0190：

1. 调用的是 `child_process.execFile()` 或 `child_process.spawn()`，且传入了 `args` 数组；
2. options 中设置 `shell: true` 或 `shell: '/path/to/shell'`（指定 shell 路径）[1]。

官方条目给出的机制说明原文：`When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection.`[1]

不在此范围内的常见情形（据条目原文的字面范围）：

- 省略 `shell` 选项或 `shell: false`（默认不经过 shell）——不在该条原文描述的触发范围内；
- `child_process.exec()`——条目只点名 `execFile` 与 `spawn`[1]；
- `fork()`、`spawnSync`/`execFileSync` 等未被该条点名（官方条目未提及，此处仅按条目字面范围理解）。

## 弃用阶段

- 类型：**Runtime**（运行时弃用）[1]。按该文档对弃用类型的总说明，Runtime 弃用会在首次使用时产生进程警告；`--pending-deprecation` 会对包括 `node_modules` 在内的代码也发出警告[1]。
- 该变更为 **SEMVER-MAJOR 提交**，随 Node.js 24.0.0（Current，2025-05-06 发布）的「Deprecations and Removals」清单一起公布，对应 PR #57199[2]。
- 24.0.0 发布说明中的原文：`Deprecation of passing args to spawn and execFile in child_process (#57199)`[2]。

## 建议（基于原文风险的迁移思路，非逐字官方指引）

- 需要直接执行、无需 shell 时：去掉 `shell: true`，直接传 `args` 数组，让 Node 负责参数分隔；
- 确实需要 shell 解释（管道、重写通配符等）时：改用会走 shell 的调用方式（如 `child_process.exec`）并把整条命令作为字符串传入，避免把未转义的 `args` 数组交给 `shell: true` 的 `spawn`/`execFile`；
- 排查存量代码：搜索 `shell: true` 与 `execFile`/`spawn` 同时出现且带 `args` 数组的调用点。

## 出处

1. [Deprecated APIs | Node.js v24.21.0 Documentation — DEP0190](https://nodejs.org/docs/latest-v24.x/api/deprecations.html#DEP0190)，访问时间 2026-10-10T03:40:15.603Z。原文：`DEP0190: Passing args to node:child_process execFile/spawn with shell option` / `Type: Runtime` / `When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection.`；弃用类型总说明原文：`A runtime deprecation for all code is similar to the runtime deprecation for non-node_modules code, except that it also emits a warning for code loaded from node_modules.`
2. [Node.js 24.0.0 (Current) 发布说明](https://nodejs.org/en/blog/release/v24.0.0)，访问时间 2026-10-10T03:40:12.581Z。原文：`2025-05-06, Version 24.0.0 (Current)` / `Deprecation of passing args to spawn and execFile in child_process (#57199)` / `[c6bca3fd34] - (SEMVER-MAJOR) child_process: deprecate passing args to spawn and execFile (Daniel Venable) #57199`

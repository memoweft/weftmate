# Node.js 24.0.0 中 DEP0190 对 `child_process.spawn`/`execFile` 的 args 影响

## 结论摘要

Node.js v24.x 官方弃用文档将 DEP0190 标为 **`Type: Runtime`**。其正文明确限定了触发条件：**只有当数组形式的 `args` 与 `{ shell: true }` 或 `{ shell: '/path/to/shell' }` 一起传给 `child_process.execFile` 或 `child_process.spawn` 时**，才属于该弃用所描述的场景；原因是这些值“not escaped, only space-separated”，存在 shell 注入风险。[1]

24.0.0 发布公告将该弃用列为该版本的显著变更之一，并在变更日志中给出 SEMVER-MAJOR 提交记录。[2]

## 触发条件（按官方原文）

官方 DEP0190 正文：

> When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection. [1]

可拆解为三个同时成立的条件：

1. 传入的是 **`args` 数组**；
2. 目标 API 是 **`child_process.execFile` 或 `child_process.spawn`**；
3. 同时设置 **`shell: true`** 或 **`shell: '/path/to/shell'`**。

若未启用 shell，或不是以数组形式传 `args`，该条正文所描述的场景并不适用（未启用 shell 时不存在"shell injection"路径）。官方正文未进一步列举其他边界情形；其余细节未在官方资料中确认。

## 弃用阶段

- **类型：`Runtime`。** DEP0190 条目下直接标注 `Type: Runtime`。[1]
- 文档对各类型的一般说明为：`Documentation-only`、`Application (non-node_modules code only)`、`Runtime (all code)`、`End-of-Life`。[1]
- 文档还说明：Application 级弃用默认只在非 `node_modules` 代码首次使用时向 stderr 打印警告；使用 `--throw-deprecation` 时会抛错；使用 `--pending-deprecation` 时对 `node_modules` 中的代码也会发出警告。Runtime 级与之类似，但“also emits a warning for code loaded from node_modules”。[1]

> 注：以上是文档对 `--throw-deprecation` / `--pending-deprecation` 等标志与弃用级别关系的一般性说明；DEP0190 条目本身未额外列出专属的 History 版本变更行，故其逐版本历史细节未在官方资料中确认。

## 建议

官方 DEP0190 正文本身未给出逐条迁移步骤；基于正文所陈述的风险，可采取的安全替代方向是：**避免在 `spawn`/`execFile` 中启用 `shell`，或对参数做正确转义后再交给 shell**。该建议是对正文所述风险的推导，而非官方逐字迁移指南；具体迁移文档未在官方资料中确认。

## 与 v24.0.0 的关系

- 24.0.0 发布公告的 Notable Changes 列出：`Deprecation of passing args to spawn and execFile in child_process (#57199)`。[2]
- 同一公告的变更日志列出：`[c6bca3fd34] - (SEMVER-MAJOR) child_process: deprecate passing args to spawn and execFile (Daniel Venable) #57199`。[2]
- 发布信息行标注为 `2025-05-06, Version 24.0.0 (Current)`。[2]

---

## 出处

[1] [Deprecated APIs | Node.js v24.21.0 Documentation](https://nodejs.org/docs/latest-v24.x/api/deprecations.html#DEP0190)，URL: https://nodejs.org/docs/latest-v24.x/api/deprecations.html#DEP0190 ，capturedAt: 2026-10-10T02:48:41.812Z。原文：

> "DEP0190: Passing args to node:child_process execFile/spawn with shell option"；"Type: Runtime"；"When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection."

[2] [Node.js — Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0)，URL: https://nodejs.org/en/blog/release/v24.0.0 ，capturedAt: 2026-10-10T02:48:38.483Z。原文：

> "2025-05-06, Version 24.0.0 (Current), @RafaelGSS and @juanarbol"；"Deprecation of passing args to spawn and execFile in child_process (#57199)"；"[c6bca3fd34] - (SEMVER-MAJOR) child_process: deprecate passing args to spawn and execFile (Daniel Venable) #57199"

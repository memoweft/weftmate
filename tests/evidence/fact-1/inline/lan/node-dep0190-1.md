# Node.js 24.0.0 DEP0190 对 child_process.spawn / execFile args 的影响

## 概要
DEP0190 为 Node.js 24.0.0 引入的 Runtime 弃用。涉及 `node:child_process` 的 `spawn` 与 `execFile` 在使用 `shell` 选项时同时传入 `args` 数组的情况。

## 触发条件
当满足以下全部条件时触发弃用警告：
* 调用 `child_process.spawn(command, args, options)` 或 `child_process.execFile(file, args, options)`
* `options.shell` 为 `true` 或为具体的 shell 路径字符串，如 `{ shell: '/bin/bash' }`
* 同时提供了 `args` 数组

在此模式下，Node.js 会把 `args` 仅做空格分隔拼接，不会对元素进行 shell 转义/转义处理，导致命令注入风险。

官方描述：
> When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection.

## 弃用阶段
* 类型：Runtime deprecation
* 引入版本：Node.js 24.0.0
* 在 Node.js 24.0.0 发布说明中列为：
  `Deprecation of passing args to spawn and execFile in child_process (#57199)`
* 当前行为：运行时发出弃用警告。未来版本中该用法将被移除/报错，具体移除时间待定。

## 建议
1. 不在 `shell: true` 的情况下传递 `args` 数组。若必须使用 shell，请自行构建完整的命令字符串并负责安全转义。
2. 更安全的做法是 `shell: false`，直接使用 `spawn` / `execFile` 的 `args` 数组，由 Node.js 绕过 shell 执行，避免注入。
3. 若确实需要 shell 功能且需要参数化，可使用 `child_process.exec` 并手动转义，或使用专门的 shell 转义库，并在文档中明确风险。

## 出处
1. Node.js 官方弃用列表 DEP0190：https://nodejs.org/docs/latest-v24.x/api/deprecations.html#DEP0190
   Captured: 2026-10-10T03:53:00.045Z
2. Node.js 24.0.0 发布说明 Deprecations and Removals：https://nodejs.org/en/blog/release/v24.0.0
   Captured: 2026-10-10T03:52:56.688Z
   相关条目：Deprecation of passing args to spawn and execFile in child_process (#57199)

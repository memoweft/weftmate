# Node.js 24.0.0 DEP0190 说明

## 概述
DEP0190：Passing args to node:child_process execFile/spawn with shell option

## 触发条件
当向 `child_process.execFile` 或 `child_process.spawn` 传入 args 数组，同时 options 包含
`{ shell: true }` 或 `{ shell: '/path/to/shell' }` 时触发。

官方描述：
> When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection.

## 弃用类型与阶段
* Type: Runtime
* 在 Node.js 24.0.0 中引入弃用。Release v24.0.0 的 Deprecations and Removals 列表包含：
  `child_process: deprecate passing args to spawn and execFile (Daniel Venable) #57199`
* Runtime 弃用意味着所有代码使用时均会发出进程警告；使用 `--pending-deprecation` 时警告范围更广。

## 影响
* args 不会被转义，仅以空格拼接传递给 shell，导致 shell 注入风险。
* 在 Windows 上使用 `spawn` + `shell` 启动 .bat/.cmd 文件时官方文档已标注 “not recommended, see DEP0190”。

## 建议
* 不要在 `shell: true` 或指定 shell 路径的情况下同时传入 args 数组。
* 替代方案：
  1. 不使用 shell：`spawn` / `execFile` 默认 `shell: false`，直接以数组形式传参，安全。
  2. 需要 shell 时，将整个命令作为单一字符串传给 `child_process.exec()`，或自行构造并正确转义的命令字符串再传给 shell，避免使用 args 数组。
  3. 在 Windows 上若需运行批处理文件，优先使用 `exec()` 或直接 `spawn('cmd.exe', ['/c', 'script.bat'])`。

## 出处
1. Deprecated APIs | Node.js v24.21.0 Documentation, https://nodejs.org/docs/latest-v24.x/api/deprecations.html, capturedAt 2026-10-10T04:19:10.468Z. 相关原文：`Type: Runtime`；`When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection.`
2. Node.js 24.0.0 (Current) Release Notes, https://nodejs.org/en/blog/release/v24.0.0, capturedAt 2026-10-10T04:23:42.986Z. Semver-major 条目：`child_process: deprecate passing args to spawn and execFile (Daniel Venable) #57199`
3. Child process | Node.js v24.21.0 Documentation, https://nodejs.org/docs/latest-v24.x/api/child_process.html, capturedAt 2026-10-10T04:24:42.711Z. Spawning .bat and .cmd files on Windows 部分原文：`using child_process.spawn() with the shell option set (not recommended, see DEP0190), or`

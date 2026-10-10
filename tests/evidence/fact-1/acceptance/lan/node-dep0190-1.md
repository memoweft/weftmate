# Node.js 24.0.0 DEP0190 说明

## 概要
Node.js 24.0.0 将 `child_process.spawn` / `child_process.execFile` 在使用 `shell` 选项时传递 `args` 数组的行为标记为弃用，标识为 DEP0190。

## 触发条件
当向 `child_process.execFile` 或 `child_process.spawn` 传递 `args` 数组，同时选项为 `{ shell: true }` 或 `{ shell: '/path/to/shell' }` 时触发。
官方描述：
> When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection.[1]

## 弃用阶段
DEP0190 类型为 **Runtime**。
> Type: Runtime[1]

在 Node.js 24.0.0 发行说明的 Deprecations and Removals 中明确列出：
> Deprecation of passing args to spawn and execFile in child_process (#57199)[2]
对应的提交记录：
> [c6bca3fd34] - (SEMVER-MAJOR) child_process: deprecate passing args to spawn and execFile (Daniel Venable) #57199[2]

## 建议
* 不要在 `shell: true` 或指定 shell 路径的模式下向 `spawn`/`execFile` 传递 `args` 数组。
* 如需使用 shell，请自行构造完整的命令字符串并做好转义，或改用 `shell: false` 配合 `args` 数组，避免未转义的拼接导致 shell injection。
* 长期方案是移除对 shell 模式的依赖，或使用专门的命令转义库。

## 出处
1. [Deprecated APIs | Node.js v24.21.0 Documentation](https://nodejs.org/docs/latest-v24.x/api/deprecations.html)  
   CapturedAt: 2026-10-10T03:12:50.931Z  
   “DEP0190: Passing args to node:child_process execFile/spawn with shell option”  
   “Type: Runtime”  
   “When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection.”

2. [Node.js — Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0)  
   CapturedAt: 2026-10-10T03:15:03.060Z  
   “Deprecation of passing args to spawn and execFile in child_process (#57199)”

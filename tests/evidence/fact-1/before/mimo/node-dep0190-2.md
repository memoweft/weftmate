# Node.js 24.0.0 的 DEP0190：对 `child_process.spawn`/`execFile` 的 `args` 有何影响？

## 结论

DEP0190 的全称是 **"Passing args to node:child_process execFile/spawn with shell option"**（给带 shell 选项的 `execFile`/`spawn` 传 `args`）。它**不是**全面弃用 `args` 参数本身，弃用的只是下面这一种组合写法：

> 当给 `child_process.execFile` 或 `child_process.spawn` 传入 `args` 数组，**同时**指定选项 `{ shell: true }` 或 `{ shell: '/path/to/shell' }` 时，这些值不会被转义、只会被空格拼接（not escaped, only space-separated），可能导致 shell 注入（shell injection）。

也就是说，普通用法（不启用 shell，即默认 `shell: false`）传 `args` 完全不受影响，例如 `spawn('ls', ['-lh', '/usr'])` 仍然是正常写法。受影响的仅仅是「`args` 数组 + shell 选项」这一组合，且风险实质上是转义缺失带来的命令注入安全隐患。

## 触发条件（同时满足才触发）

1. 调用 `child_process.spawn()`、`child_process.execFile()`（含各自的同步变体等走同一实现的接口）；
2. 传入了 `args` 数组；
3. `options` 中设置了 `shell: true` 或 `shell: '/path/to/shell'`（shell 被显式启用）。

## 弃用阶段与引入版本

- **类型：Runtime（运行时弃用）**。按官方弃用文档的分级，Runtime 弃用适用于**所有代码**（包括 `node_modules`），触发时会实际输出运行时弃用警告，且未来版本可能转为抛错或移除；可用 `--pending-deprecation` 提前观察、`--throw-deprecation` 将警告变为抛错。
- **引入版本：Node.js 24.0.0**（v24 为当时的 Current 版本，2025-05-06 发布），见官方发布说明中 "Deprecations and Removals" 一节的 "Deprecation of passing args to spawn and execFile in child_process (#57199)"。

## 建议

- 需要 shell 语法（管道、通配符等）时，**不要**用 `args` 数组：把完整命令写进 `command` 字符串，并自行对动态输入做转义；或改用 `child_process.exec()`（本就走 shell 执行单条命令字符串）。
- 不需要 shell 时，保持默认 `shell: false` 并继续使用 `args` 数组——这是推荐的写法，天然避免拼接转义问题。
- 尽量避免「shell + args 数组」的组合；它正是 DEP0190 针对的注入风险来源。

## 来源

- [Node.js 官方弃用文档：DEP0190](https://nodejs.org/docs/latest-v24.x/api/deprecations.html#DEP0190)
- [Node.js 24.0.0 发布说明（含 DEP0190 对应的 PR #57199）](https://nodejs.org/en/blog/release/v24.0.0)

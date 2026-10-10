# Node.js 24.0.0 DEP0190：对 `child_process.spawn`/`execFile` 的 `args` 有何影响

## 触发条件

当给 `child_process.execFile` 或 `child_process.spawn` 传入 **`args` 数组**，同时又指定 shell 选项（`{ shell: true }` 或 `{ shell: '/path/to/shell' }`）时，即触发 DEP0190。此时数组中的值不会被转义，只按空格分隔，可能导致 shell 注入[1]。也就是说，触发需要同时满足两个条件：一是使用 `args` 数组形式传参，二是启用了 `shell` 选项（`true` 或指定 shell 路径）。

## 弃用阶段

- **v24.0.0（本主题版本）：Runtime 弃用**，由 PR #57199 引入[3]；v24.0.0 发布说明（2025-05-06，Current）中列有 "Deprecation of passing args to spawn and execFile in child_process (#57199)"[2]。
- 此前在 v23.11.0 与 v22.15.0 中为 Documentation-only 弃用（PR #57389）[3]。

Runtime 属于"影响所有代码"的弃用类别（该类别说明为通用文档，并非 DEP0190 专属条目）：使用 `--throw-deprecation` 命令行标志时，Runtime 弃用会抛出错误；使用 `--pending-deprecation` 时，对从 `node_modules` 加载的代码也会发出警告[1]。

## 建议

1. **避免"传 `args` 数组 + `shell` 选项"的组合**：要么不用 `shell`（或使用 `shell: false`），要么不要用数组形式拼接需经 shell 解释的参数，以消除注入风险[1]。
2. **测试阶段**可用 `--throw-deprecation` 将弃用警告变为错误，便于尽早发现调用点[1]（此为 Runtime 类别的通用行为说明）。
3. 若需要 `shell: true` 的能力，官方条目本身未给出替代 API；如何改造属于实现选择，**未在官方资料中确认**给出专门替代方案。

## 出处

[1] [Deprecated APIs | Node.js v24.21.0 Documentation](https://nodejs.org/docs/latest-v24.x/api/deprecations.html)（捕获时间 capturedAt：2026-10-10T04:13:07.139Z）——"Type: Runtime"；"When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection."；"When the --throw-deprecation command-line flag is used, a Runtime deprecation will cause an error to be thrown."；"When --pending-deprecation is used, warnings will also be emitted for code loaded from node_modules."

[2] [Node.js 24.0.0 release notes](https://nodejs.org/en/blog/release/v24.0.0)（捕获时间 capturedAt：2026-10-10T04:09:58.002Z）——"2025-05-06, Version 24.0.0 (Current)"；"Deprecation of passing args to spawn and execFile in child_process (#57199)"

[3] [node:doc/api/deprecations.md at v24.0.0（raw 源文件）](https://raw.githubusercontent.com/nodejs/node/v24.0.0/doc/api/deprecations.md)（捕获时间 capturedAt：2026-10-10T04:11:03.197Z）——"### DEP0190: Passing `args` to `node:child_process` `execFile`/`spawn` with `shell` option `true`"；"  - version: v24.0.0" … "    description: Runtime deprecation."；"  - version:" … "    - v23.11.0" … "    - v22.15.0" … "    description: Documentation-only deprecation."

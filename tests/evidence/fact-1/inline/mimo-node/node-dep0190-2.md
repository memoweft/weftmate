# Node.js 24.0.0 中 DEP0190 对 child_process.spawn/execFile 的 args 的影响

## 触发条件

当向 `child_process.execFile` 或 `child_process.spawn` **启用 shell 选项**——即传入 `{ shell: true }` 或 `{ shell: '/path/to/shell' }`——并且同时传入 `args` 数组时，即触发 DEP0190（"Passing args to node:child_process execFile/spawn with shell option"）[1]。文档说明此时"the values are not escaped, only space-separated, which can lead to shell injection"，即参数值不做转义、仅以空格拼接，可能导致 shell 注入 [1]。

不启用 shell 的调用不在触发范围内：Node.js 文档指出，默认行为是不调用 shell，此时应省略 shell 选项，或将其设为 `false` 或 nullish 值 [1]。

## 弃用阶段

- DEP0190 在官方弃用文档中的类型徽章为 **`Type: Runtime`**，即 Runtime（all code）级别的弃用 [1]。
- 该条目随 **Node.js 24.0.0**（2025-05-06 发布，发布时为 "Current"，24 系列于 2025 年 10 月进入 LTS）的发布说明列入弃用项："Deprecation of passing args to spawn and execFile in child_process (#57199)" [2]。
- Runtime 级弃用的一般行为（据官方分类说明）：默认对非 `node_modules` 代码首次使用时向 stderr 打印进程警告；使用 `--throw-deprecation` 命令行标志时会抛出错误；使用 `--pending-deprecation` 时，对加载自 `node_modules` 的代码也会发出警告 [1]。DEP0190 条目未标注 "supports --pending-deprecation"（对比 DEP0191 有此标注），故上述 `--pending-deprecation` 行为按 Runtime 一般规则理解，未在该条目下另行确认。

## 建议

1. **不需要 shell 时**：省略 `shell` 选项，或设为 `false` / nullish 值，让 `execFile`/`spawn` 走默认的不调用 shell 的路径，从而不触发该弃用 [1]。
2. **需要 shell 时**：若确实要让 `execFile`/`spawn` 调用默认 shell，须使用 `{ shell: true }` [1]；同时应自行确保参数安全——官方文档指出了未转义导致 shell 注入的风险，但未给出逐字转义 API（常见做法是对参数转义或使用 shell-quote 类库；此句为一般安全建议，非官方原文）。避免用字符串拼接用户输入到命令中。
3. **升级到 24.x 时**：注意这是 Runtime 级弃用，运行时会产生警告，在 `--throw-deprecation` 下会直接抛错，应尽早排查依赖 `shell: true` + `args` 的调用点 [1][2]。

---

## 出处

[1] Deprecated APIs | Node.js v24.21.0 Documentation — https://nodejs.org/docs/latest-v24.x/api/deprecations.html （capturedAt: 2026-10-10T03:47:44.390Z）
> "DEP0190: Passing args to node:child_process execFile/spawn with shell option … Type: Runtime … When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection."；分类说明："When the --throw-deprecation command-line flag is used, A Runtime deprecation will cause an error to be thrown. When --pending-deprecation is used, warnings will also be emitted for code loaded from node_modules."

[2] Node.js 24.0.0 (Current) — https://nodejs.org/en/blog/release/v24.0.0 （capturedAt: 2026-10-10T03:47:41.140Z）
> "2025-05-06, Version 24.0.0 (Current) … As a reminder, Node.js 24 will enter long-term support (LTS) in October … Deprecation of passing args to spawn and execFile in child_process (#57199)"

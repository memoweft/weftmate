# Node.js 24.0.0 的 DEP0190 对 child_process.spawn/execFile 的 args 有什么影响？

## 结论摘要

DEP0190 针对的是 `child_process.execFile` / `child_process.spawn` 在**指定了 shell 选项**时再传入 `args` 数组的用法：其标题为 "DEP0190: Passing args to node:child_process execFile/spawn with shell option"，声明的弃用类型为 **Runtime**（`Type: Runtime`）[1]。Node.js 24.0.0（2025-05-06 发布的 "Current" 版本）的发布说明中列出了这一弃用（#57199）[2]。

## 准确的触发条件

官方描述的触发条件是：当向 `child_process.execFile` 或 `child_process.spawn` 传入 `args` 数组，**并且**同时带有 shell 选项 `{ shell: true }` 或 `{ shell: '/path/to/shell' }` 时，这些值不会被转义、仅按空格分隔，从而可能导致 shell 注入（原文："When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection."）[1]。

需要注意的范围边界：触发条件限定于 shell 选项取 `{ shell: true }` 或 `{ shell: '/path/to/shell' }` 这两种形式；未设置 shell 选项或将其设为空值（nullish）的情形不属于 DEP0190 所述的这一触发条件描述[1]。

## 弃用阶段

- DEP0190 的弃用类型为 **Runtime**。按官方对 Runtime 类型的定义，它针对所有代码（"A runtime deprecation for all code is similar to…except that it also emits a warning for code loaded from node_modules."），即除用户代码外，来自 `node_modules` 的代码也会产生警告[1]。
- 该弃用随 Node.js 24.0.0 发布公告出现：发布页标注 "2025-05-06, Version 24.0.0 (Current)"，并列出 "Deprecation of passing args to spawn and execFile in child_process (#57199)" 以及对应的 SEMVER-MAJOR 提交行 "[c6bca3fd34] - (SEMVER-MAJOR) child_process: deprecate passing args to spawn and execFile (Daniel Venable) #57199"[2]。
- 关于 DEP0190 在文档 History 表格中具体"Added"的版本行，以及此后是否变更过弃用阶段（例如是否进入其他阶段），本次抓取的官方页面正文未能读出该表格行——**未在官方资料中确认**[1]。另外，提交行中的 "SEMVER-MAJOR" 标签是提交标题，不能据此推断其最终发布阶段。
- Runtime 类型在上述引用文本中的效果是"产生警告"；是否因 `--throw-deprecation` 等选项而抛出错误，**未在官方资料中确认**[1]。

## 建议

- DEP0190 在抓取到的正文中只陈述了注入风险本身，没有给出独立的修复建议段落；该条目本身说明：这些值不被转义、仅空格分隔，可能导致 shell 注入[1]。
- 需要避免把其他条目的建议误归给 DEP0190：官方文档中"要么省略 shell 选项、要么将其设为空值；若本意不是调用 shell，请改用 `child_process.execFile`"（原文："…either omit the shell option, or set it to a nullish value. If the intention is not to invoke a shell, use child_process.execFile instead."）这段建议位于 **DEP0196**（`Calling node:child_process functions with options.shell as an empty string`）之下，不属于 DEP0190[1]。
- 因此，针对 DEP0190 的实用建议只能基于其自身陈述：在使用 shell 选项传入 `args` 数组时要意识到值未被转义、可能引发 shell 注入风险[1]；至于官方为 DEP0190 单独给出的迁移/修复措辞，**未在官方资料中确认**[1]。

## 出处

1. [Deprecated APIs | Node.js v24.21.0 Documentation](https://nodejs.org/docs/latest-v24.x/api/deprecations.html)，capturedAt: 2026-10-10T03:13:29.046Z。原文引语："DEP0190: Passing args to node:child_process execFile/spawn with shell option"；"Type: Runtime"；"When an args array is passed to child_process.execFile or child_process.spawn with the option { shell: true } or { shell: '/path/to/shell' }, the values are not escaped, only space-separated, which can lead to shell injection."；"A runtime deprecation for all code is similar to…except that it also emits a warning for code loaded from node_modules."；DEP0196 条目下的 "…either omit the shell option, or set it to a nullish value. If the intention is not to invoke a shell, use child_process.execFile instead."
2. [Node.js 24.0.0 (Current)](https://nodejs.org/en/blog/release/v24.0.0)，capturedAt: 2026-10-10T03:13:25.855Z。原文引语："2025-05-06, Version 24.0.0 (Current)"；"Deprecation of passing args to spawn and execFile in child_process (#57199)"；"[c6bca3fd34] - (SEMVER-MAJOR) child_process: deprecate passing args to spawn and execFile (Daniel Venable) #57199"。

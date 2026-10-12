# APPLE-2 合并前文案复查

2026-10-11：对照 APPLE-2 提交中含「宿主、配对、中继、令牌、界面包」的文案改动，逐条读取当前界面字符串，并扫描共享 UI、iPhone、Mac、Watch、资源及共享包中的中文文案。

修正两处「电脑电脑」、误切「中继续」后的「远程连接续」、两处单价「百万字元」，并补齐 iPhone 两侧空格、简化系统状态说明。版本状态的实际代码已经是「还没连上电脑」，本次修正了对照表的错误记录。连接错误提示也按当前代码更新到表中，见 [文案对照](copy-changes.md)。

回归检查接入现有 `Scripts/check_ui_copy.mjs`，对当前源代码拒绝「电脑电脑」「远程连接续」「字元」「还没连上电脑状态」「WeftMate报告」「通过iPhone」。现有仓库 Apple 文案测试会执行这个检查。新增 `Tests/apple-copy-regression.test.mjs` 验证坏词在界面标签和模型错误中都被拒绝，并确认「临时对话中继续」等正确词句不会被误伤。

验证结果：

- `node --test apps/apple/Tests/apple-copy-regression.test.mjs tests/apple-ui-copy.test.ts tests/apple-callback-isolation.test.mjs`：12/12 通过，无失败、无跳过。
- `node apps/apple/Scripts/check_ui_copy.mjs`：2,056 条当前源码文案通过；原有 53 帧历史截图文字的元数据文案检查通过。
- `swift test --package-path apps/apple/Packages/WeftMateCore --filter 'a11|upd2'`：18/18 通过。
- `git diff --check`：通过。
- `node .github/scripts/public-hygiene.mjs`：8,036 个文本文件，0 个本机身份信息泄漏。

本次仅修改文案和文案回归检查，没有改登录行为或原测试预期；未启动模拟器，未修改系统或模拟器设置，未连接真实账号、电脑或邮箱。已有截图与 OCR 保留拍摄时的原始记录，本次未重拍或改写截图。

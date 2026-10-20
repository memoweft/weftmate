按 `docs/PLAN.md` 第2节运行 `build.mjs OUTPUT/candidate MEMORY_RUNTIME VERSION UNIQUE_ID`、`rerun.ps1 -EvidenceDirectory OUTPUT`（单项默认30分钟，跨端加 `-Relay`，确需已有进程代理时加 `-UseEnvProxy`），同目录脚本提供显式Core、工作审批检查点、离线联调、目标页和Windows原生通知补验（连续补验用不同 `evidencePrefix`），验证码只经绑定Outlook在进程内交接，实际结果及证据留仓库外，不修产品代码、不改系统设置。

持续运行的控制器可用 `node command.mjs OUTPUT CASE CODE_FILE [TIMEOUT_SECONDS]` 顺序执行检查点并保存 `case-CASE.json`；邮箱可用控制器公钥加密后交给 `ctx.setEmailEnvelope`，与 `ctx.fillCode` 一样只在进程中解密，不把地址或验证码写入动作文件。

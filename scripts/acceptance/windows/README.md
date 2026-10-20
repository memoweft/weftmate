按 `docs/PLAN.md` 第2节运行 `build.mjs OUTPUT/candidate MEMORY_RUNTIME VERSION UNIQUE_ID`、`rerun.ps1 -EvidenceDirectory OUTPUT`（单项默认30分钟，跨端加 `-Relay`，确需已有进程代理时加 `-UseEnvProxy`），同目录脚本提供显式Core、工作审批检查点、离线联调、目标页和Windows原生通知补验（连续补验用不同 `evidencePrefix`），验证码只经绑定Outlook在进程内交接，实际结果及证据留仓库外，不修产品代码、不改系统设置。

持续运行的控制器可用 `node command.mjs OUTPUT CASE CODE_FILE [TIMEOUT_SECONDS]` 顺序执行检查点并保存 `case-CASE.json`；邮箱可用控制器公钥加密后交给 `ctx.setEmailEnvelope`，与 `ctx.fillCode` 一样只在进程中解密，不把地址或验证码写入动作文件。

只记首次结果时改用 `node first-result.mjs OUTPUT CASE CODE_FILE [TIMEOUT_SECONDS]`，同名试次会拒绝覆盖；`memory-first.mjs::firstMemoryTrial` 在每个全新隔离数据目录分别跑一次 M1/M3/M7（可加 M2），M7 使用独立的合成零食偏好，不自动补跑 M1。用 `node prepare-memory-profile.mjs INSTALLED_EVIDENCE NEW_OUTPUT` 为同一已安装候选准备额外空白数据目录，各控制器只操作自己的目录；三次试验各用新目录，保留每次首次问答、遗忘回执、来源和原聊天证据。

额外目录准备后，可直接运行 `.\scripts\acceptance\windows\rerun.ps1 -EvidenceDirectory NEW_OUTPUT -Cases @('onboarding','firstReply','memoryFirstTrial')`；实际各项结果读 `memory-first-results.json`，控制器返回 `ok` 仅表示动作完成。默认跑法也已用此单次记忆流程替代会自动重新跑M1的旧M7准备方式。

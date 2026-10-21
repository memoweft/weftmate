按 `docs/PLAN.md` 第2节运行 `build.mjs OUTPUT/candidate MEMORY_RUNTIME VERSION UNIQUE_ID`、`rerun.ps1 -EvidenceDirectory OUTPUT`（单项默认30分钟，跨端加 `-Relay`，确需已有进程代理时加 `-UseEnvProxy`），同目录脚本提供显式Core、工作审批检查点、离线联调、目标页和Windows原生通知补验（连续补验用不同 `evidencePrefix`），验证码只经绑定Outlook在进程内交接，实际结果及证据留仓库外，不修产品代码、不改系统设置。

构建下载受阻时可追加 `VERIFIED_STAGE ELECTRON_DIST`，显式复用已核对版本与哈希的本地 Electron 分发目录，并把输入身份记在仓外证据中。

显式 Core 补验可用 `prepare-explicit-core.mjs NEW_OUTPUT PREPARED_RUNTIME --installed-evidence INSTALLED_OUTPUT`，继续驱动同一已安装候选，再以 `local` 模式运行新数据目录；开发源码模式仅作补充，不能替代安装验收。

持续运行的控制器可用 `node command.mjs OUTPUT CASE CODE_FILE [TIMEOUT_SECONDS]` 顺序执行检查点并保存 `case-CASE.json`；邮箱可用控制器公钥加密后交给 `ctx.setEmailEnvelope`，与 `ctx.fillCode` 一样只在进程中解密，不把地址或验证码写入动作文件。

核验Windows界面时，每次动作前会恢复、显示并聚焦真实窗口；辅助进程不弹控制台。不要用隐藏/透明窗口的旧DOM或关闭后台节流来判界面通过或失败；先恢复正常可见状态，读取原请求结果，不重发消息。

只记首次结果时改用 `node first-result.mjs OUTPUT CASE CODE_FILE [TIMEOUT_SECONDS]`，同名试次会拒绝覆盖；`memory-first.mjs::firstMemoryTrial` 在每个全新隔离数据目录分别跑一次 M1/M3/M7（可加 M2），M7 使用独立的合成零食偏好，不自动补跑 M1。用 `node prepare-memory-profile.mjs INSTALLED_EVIDENCE NEW_OUTPUT` 为同一已安装候选准备额外空白数据目录，各控制器只操作自己的目录；三次试验各用新目录，保留每次首次问答、遗忘回执、来源和原聊天证据。

额外目录准备后，可直接运行 `.\scripts\acceptance\windows\rerun.ps1 -EvidenceDirectory NEW_OUTPUT -Cases @('onboarding','firstReply','memoryFirstTrial')`；实际各项结果读 `memory-first-results.json`，控制器返回 `ok` 仅表示动作完成。默认跑法也已用此单次记忆流程替代会自动重新跑M1的旧M7准备方式。

R1022 跑法修正：C3 分别记录原生目标 turn 停止和排队回复结束，避免把第二条回复时间算作停止时间；M2 不要求确认句复述偏好，首次新聊完整答案单独判读，仅明确简短的当前绿茶偏好自动通过，否定、对比和延后整理等回答保留为人工判读。控制器仅截取自有窗口，通知保留事件事实；命令观察只记录指定会话命令的路径、业务请求ID与状态，不记录认证头。C4 合成种子只用于原生历史分页准备，准备失败与首次有效分页分别保全。

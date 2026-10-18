按 `docs/PLAN.md` 第 2 节执行 `build.mjs OUTPUT/candidate MEMORY_RUNTIME VERSION UNIQUE_ID [VERIFIED_STAGE]`、`rerun.ps1 -EvidenceDirectory OUTPUT`（本机独立身份、默认目录安装，非干净沙盒）；`scenarios.mjs` 自动操作聊天、千条分页、记忆、提醒和浅深页面，`work-steps.mjs` 提供选目录、审批检查点与文件/预览核验，云验证码由绑定 Outlook 连接只读本次邮件并在进程内交接、工作多轮审批及答复含义需人工判读，`prepare-explicit-core.mjs NEW_OUTPUT PREPARED_RUNTIME [ELECTRON_EXE]` 配合 `-Mode dev` 补显式 Core 环境，`native-notifications.mjs APP_ID OUTPUT [PATTERN] [MINIMUM]` 读取该独立身份的真实 Windows 通知历史；不使用沙盒、不改系统设置，实际覆盖与失败见 #509 及包目录结果表。

构建前校验整个已跟踪源码与当前抓取的 `origin/main` 一致，仅允许 `scripts/acceptance/` 有差异；构建脚本、资源准备脚本和 electron-builder 钩子也在校验范围内。拒绝仓库外部输入之外的未跟踪文件，并额外检查 `src/`、`runtime/`、`build/`、`patches/`、`scripts/` 下被忽略但可能参与打包的文件。使用干净的 main 源码副本执行；候选记录同时保留 main 源码 SHA 和验收分支的 buildHead。

`rerun.ps1` 每个场景默认给 30 分钟，覆盖记忆确认/召回和历史重启等多段等待；可用 `-ScenarioTimeoutMinutes <1–30>` 缩短本轮预算。超过预算仍会报超时并在 finally 中关闭控制器及其子进程。

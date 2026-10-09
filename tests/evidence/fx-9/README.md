# FX-9 · 首个云账号执行与发送确认

修复 QA1-01 / QA1-02。基线 `cf211f4`，证据在该基线上加载本包工作树改动后产生；使用真实 `src/main.mjs` / Electron（桌面程序框架）、固定 DSH（助手运行时）、本地真实云入口及 MiMo。全部账号和文件为合成数据，宿主使用系统临时目录和随机回环端口，没有访问 18186 / 8081 或本人日用目录。

| 起点 / 端 | 结果 | 证据 |
|---|---|---|
| 改前首个云账号 / MuMu（安卓模拟器） | 复现：完整回复已显示，文件未创建、审批 0 次，PATCH 审批模式 404，仍提示发送未确认并保留草稿 | [原结果](before/phone-task.json)、[截图](before/android-task-timeout-light.png) |
| 全新宿主首个云账号 / MuMu | 通过：手机审批 3 次，电脑写入并读回 `FX9_PHONE_EXECUTED`，手机看到完成，草稿 / 未确认状态均清除；43.519 秒 | [结果](fresh/phone-task.json)、[审批](fresh/android-task-approval-light.png)、[完成](fresh/android-task-result-light.png) |
| 旧本地账号绑定 / MuMu | 通过：手机审批 4 次、写入 / 读回 / 完成；53.406 秒；原 ownerId（归属标识）、hostId（宿主标识）、密码记录、原设备和合成旧数据保留 | [结果](legacy/phone-task.json)、[保留检查](legacy/android-visual-verification.json)、[绑定](legacy/desktop-legacy-bound.png)、[完成](legacy/android-task-result-light.png) |
| 第二账号尝试 / MuMu | 通过：第二账号独立 owner、零原账号会话、电脑动作 403，界面说明受限；手机批准原桌面重新进入后，原账号手机审批 3 次、写入 / 读回 / 完成，59.061 秒 | [隔离检查](second/android-visual-verification.json)、[受限界面](second/desktop-second-account-limited.png)、[原账号任务](second/phone-task.json)、[完成](second/android-task-result-light.png) |
| 手机网页 390×844 | 通过：真实云注册、桌面批准设备、手机网页审批 3 次、电脑写入 / 读回、完成；51.390 秒，草稿与未确认提示清除 | [结果](mobile-web/phone-task.json)、[审批](mobile-web/mobile-web-task-approval-light.png)、[完成](mobile-web/mobile-web-task-result-light.png) |
| 本地完整 frp（中继）链路 | 未复验：Windows frp 文件在，既有 WSL（Windows 的 Linux 子系统）无 HAProxy（TCP 前置代理），没有已准备的完整本地夹具；没有重建环境或操作生产中继 | [前提检查](relay-prerequisites.json) |

修复保留 `legacyOwnerId` 及所有旧存储路径，仅在未注册、没有历史设备 / 会话 / 命令的空白安装上，原子记录首个云账号为 `executionOwnerId`。审批、工具执行、成果、提问及网页来源按执行会话归属接线，其他账号不能获取旧账号数据或电脑工具。第二账号继续使用现有隔离聊天规则，并给出限制说明。

真实新账号与旧本地账号两轮中，模型最初直接调用 `write` 均出现 `TOOL_SOURCE_UNAVAILABLE`（工具来源不可用），随后使用已批准的 `pwsh` 创建文件并通过 `read` 核验。文件任务与跨端审批出口通过；原失败步骤完整保留在事件和截图中，不把每个工具步骤描述为全部成功。这一共同的直接写入来源回执问题未在 FX-9 扩展修复。

发送确认按原 `/commands/by-request/{requestId}` 回执和匹配 `receiptId` 的会话记录收尾，任务详情读取另行处理。Android（安卓）查回执时同步更新原生持久 outbox（待发送记录），不重发；迟到回执不清其他账号 / 会话或新编辑的草稿。受限聊天会话声明 `taskAvailable:false`，不查询不存在的执行任务。

第二账号验收额外复现同一客户端改变云账号时的授权恢复 400。提供方返回 HTML（网页标记语言）自动提交的账号切换注销表单，现有 JSON（结构化数据）桥不能提交；App 内新授权只重置本客户端 OIDC（身份认证协议）会话 Cookie（会话凭据），按原密码 / 验证码授权新身份。同一 Cookie 容器 A→B→A 的真实提供方回归通过。此云服务修改尚未部署。

定向验证分组分别 144/144、37/37、17/17、24/24、云提供方 11/11 通过（有重叠，不相加）；覆盖账号隔离、审批、工具执行 / 成果、提问、项目 / 网页来源、共享界面、云登录和 Android 桥。`npm run typecheck`、手机资产检查和独立 APK（安卓安装包）构建通过。新增原生回执持久化用例另见 `native-receipt-test.txt`。完整测试交本包 PR（拉取请求）的 CI（持续集成）。

[MiMo 用量](usage.json) 只计可取得的官方响应使用量。两次早期真实模型轮次因运行器在保存 trace（请求轨迹）前抛错，用量未知；已知汇总是下界，未知轮次未记为免费。`approval-channel-failed/` 保留执行归属接线尚未完整时的失败。

运行器改自 QA-1 的合成云 / MuMu 夹具，保存在 [runners](runners/android-task.mjs)。使用 `--device --visual-smoke --phase fresh|legacy|second --apk <本包独立APK> --probe-apk <独立测试APK>`；手机网页去掉 `--device` 并用 `--phase mobile-web`。`before/` 使用旧 UI / 原生包和基线宿主源码，不将新版 APK 重跑称为原始复现。证据不包括真实手表回执、长期浸泡、正式发布或本人账号操作。

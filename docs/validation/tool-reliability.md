# 工具调用与纠错验收

本轮检查模型目录、参数定义、原生执行/审批、结果呈现和继续执行。测试使用隔离账号、项目、数据目录与随机端口；不修改日用提醒、记忆或安装。

## 修复与边界

| 路径 | 修复或检查 | 回归入口 |
| --- | --- | --- |
| 加载工具 | 保留参数校验原因；失败重试仍由原生模型回合完成；不误报电脑未就绪 | `first-work-switch.test.ts`、真实模型加载错误注入 |
| 普通工具错误 | 参数错误能纠正；取消/权限禁止不重试；未知效果须先核对；诊断作为数据，不作为授权 | `tool-reliability.test.ts`、`personal-reply-content-*.test.ts` |
| 文件、检索与命令 | 非文件工具不扫描目录；直接写入仅观察目标；命令观察仅扫描有界元数据，变化后才读内容；登记失败与执行结果分开 | `personal-native-files.test.ts`、真实模型读/查/写/改/命令核对 |
| Windows 桌面 | 明确对象、动作、选择器和字段类型；错误输入在执行前拒绝 | `weftmod-plugin.test.ts`、`weftmod-desktop.test.ts`、真实模型纠错后窗口查询 |
| 脚本与模块 | 脚本参数、模块文件和清单显式为对象；保留原生代码运行、审批、结果验证 | `weftmod-service.test.ts`、`mod-project-runtime.test.ts`、真实模型脚本执行 |
| 提醒 | 账号范围查询与管理；强制所属会话和条目编号；拒绝跨账号及已停止来源 | `schedule-account-query.test.ts`、`personal-schedules.test.ts`、真实模型跨会话删除 |
| 连接器 | 文本和结构化结果均可见；结构化结果同样标记为外部数据；凭据仍在宿主去除 | `personal-connectors*.test.ts`、真实模型与合成 MCP 服务 |
| 网页 | 复用页面读取、快照、网络限制与引用路径 | `personal-browser-*.test.ts`、真实模型与真实 Chromium 读取隔离网页 |
| 目标、待办与任务 | 保留原生目标状态、轮次、后台作业和子任务结果收取 | `personal-goals.test.ts`、`personal-goal-round-driver.test.ts`、`personal-delegation-results.test.ts`、真实模型目标/作业 |
| 提问、审批与取消 | 回答不是执行许可；拒绝不可换工具绕过；停止与执行失败区分 | `personal-user-question*.test.ts`、`personal-approval-*.test.ts`、真实模型拒绝/停止 |
| 记忆与健康 | 通用参数纠错覆盖；记忆版本冲突、禁用召回和忘记边界保留 | `personal-forget-loop.test.ts`、模型反馈原生运行时回归；不使用真实个人记录 |
| 手机与外部服务 | 检查工具输入、输出和原生执行链；设备操作/外部账号依赖仍需对应环境 | `weftmod-plugin.test.ts`、连接器原生测试；不把模拟设备结果当真机验收 |

## 真实模型运行器

`tests/integration/tool-reliability-mimo.mjs` 使用固定 DSH、生产个人宿主与实际 MiMo。凭据只从进程环境 `MIMO_API_KEY` 读取。`WEFTMATE_TOOL_EVIDENCE` 指定私有证据目录；输出包含原始调用/结果、模型用量、源文件摘要和注入标记。

默认组：文件失败恢复、桌面参数纠错、两会话提醒管理、原生审批拒绝。

扩展组设 `WEFTMATE_TOOL_EXTENDED=1`；`WEFTMATE_TOOL_CASES` 可选择 `scripts,goal,connector,cancellation,browser,jobs,delegation,question`。浏览器组还需 `WEFTMATE_TOOL_LOCKS` 指向本机重活锁目录，实际启动独立隐藏 Electron/Chromium。

桌面参数和工具加载错误由测试传输层在真实模型的一次输出中注入，随后不替模型决定修复；报告明确记录注入。不存在文件、真实系统查询、文件内容、提醒状态、结构化金额、拒绝后的文件保留及停止结果分别以实际输出核验。运行器修复或环境准备失败单独记录，不能算产品通过。

全量工具目录审计不等于每种外部服务、手机或真实个人数据都完成验收。邮件/日历的本机 TLS 夹具还依赖 Windows 进程查询；环境准备失败须依 CI 或修复后的环境补验，不得记为通过。

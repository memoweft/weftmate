# 本机运行记录

程序每轮生成独立 `runId`（运行标识）。设置 → 系统状态显示本次启动、上一轮是否正常退出与最近七天检测到的异常退出次数；手机在现有常规设置的系统状态区查看。上次未正常退出时，已有状态提示条提供「查看详情」。诊断摘要先在页内预览，再由使用者复制。

| 记录 | 用途 |
|---|---|
| `host.start` | 本轮启动与版本、模式、运行标识 |
| `host.exit` | 退出原因、操作系统退出码、运行时长、总收尾耗时、收尾是否完成 |
| `host.shutdown_step` | 每个收尾步骤的完成 / 失败与毫秒耗时 |
| `host.previous_unclean_exit` | 上轮没有退出记录；最后事件与时间、匹配的本地转储名称和大小 |
| `host.failure` | 未捕获异常、未处理拒绝、启动及收尾错误的安全定位信息 |
| `renderer.process_gone` / `renderer.recovery` | 渲染进程结束原因、退出码、沿原有策略处理以及随后观察到的窗口重载 |
| `child.process_gone` | Electron（桌面程序框架）辅助进程结束原因、退出码及其自身管理策略 |
| `runtime.process_gone` | DSH（助手运行时）进程退出码 / 信号及随后启动重试、重启成功 / 失败 / 放弃 |
| `host.crash_reporter` / `host.session_end` | 本地转储能力启用与系统关机 / 注销事件 |

新增字段的白名单（允许记录的字段集合）如下。原有模型请求及队列字段继续只记录结构化元数据。

| 字段 | 含义与限制 |
|---|---|
| `runId`, `previousRunId` | 程序生成的 UUID（随机唯一标识），不使用账户或设备名称 |
| `reason` | `user-quit` / `update-restart` / `system-shutdown` / `single-instance` / `startup-failure` / `unknown`；进程事件使用固定原因 |
| `exitCode`, `signal` | 实际退出码；仅认可的操作系统信号，不猜测强杀的退出码 |
| `durationMs`, `shutdownDurationMs` | 本轮运行时长与总收尾耗时 |
| `step`, `status` | 固定收尾步骤与 `completed` / `failed` |
| `normal`, `cleanupComplete` | 正常结束与收尾完成；启动失败、非零退出码或收尾失败不称为正常 |
| `startedAt`, `lastAt`, `lastEvent` | 启动时间、上一轮最后记录的时间及事件名 |
| `action`, `processType`, `source` | 固定恢复决策、进程类型、程序内错误来源标签 |
| `dumpCount`, `dumpBytes`, `dumps` | 转储数量、总大小及 `{name,size}`；名称只允许程序生成的 `UUID.dmp` |
| `name`, `code`, `message`, `stackFrames` | 专用错误入口产生；普通日志调用不能传入这些字段 |

`logs/current-run.json` 是持久启动标记。启动先刷新临时标记到磁盘，再原子替换；退出先刷新 `host.exit`，再标记已退出。两步之间断电时，已刷新的退出记录优先；已退出标记也保留安全的退出结果，日志过期后不会把正常退出误判为崩溃。强杀、原生崩溃或断电无法执行 JavaScript（脚本）退出回调，下一轮据缺失的 `host.exit` 检测异常，原因无法确定时明确说明。第二实例只写独立启动 / 让位记录，不改正在运行实例的标记。半行损坏日志不会粘连后续记录。落盘失败不抛出，不阻止启动或退出。

备份关闭函数内部捕获的错误也通过仅观察的回调保留错误码与源码帧，回调失败不改变备份状态、打包范围或退出行为。

错误脱敏（去除敏感信息）沿现有 `redactSecretText` 加强：密钥、令牌、口令、Cookie（会话凭据）、授权头、邮箱、长随机串、网址和绝对路径遮掉。磁盘消息进一步采用技术模板，仅保留「Cannot read properties of undefined」等可确认的错误形态；自由原文、属性名、变量名、文件名、账户名、对话、提示词、模型输出和文件内容不记录。堆栈最多八帧，仅保留应用实际源码白名单中的相对路径与行列号，不保留函数名或参数；应用外帧省略。摘要对历史记录再次校验，带程序版本和系统版本，不含机器名。

日志在 `<dataDirectory>/logs/host-YYYY-MM-DD.jsonl`，最长七天、每片 2 MiB（兆二进制字节），轮转后的总大小最多 32 MiB。这个容量适合排查七天内偶发一次：轮转不会因某一天超过 2 MiB 停止记录。较高频的元数据可能先触及总量上限而缩短可查窗口。如果需要查超过七天的偶发问题，建议由本人决定改为十四天 / 64 MiB；本包保持七天默认值。

原生转储在 `<dataDirectory>/Crashpad/`。在创建窗口之前设置 `app.setPath('crashDumps', ...)`，然后用 `crashReporter.start({uploadToServer:false})` 启用；没有上传地址、第三方服务或自动发送。保留最近五个 `.dmp`（原生转储文件），总大小最多 100 MiB、最长七天，每次启动清理。不跟随符号链接或目录联接。转储与上一轮的关系仅按「上轮启动至此次启动」的修改时间窗口推断，不声称已定位根因。[Electron 官方说明](https://www.electronjs.org/docs/latest/api/crash-reporter)确认本地模式及 `crashDumps` 路径可设置；目录内部结构由 Electron 管理。

安装版数据目录来自 `desktop-config.json` 的 `dataDirectory`，默认产品目录为 `%APPDATA%/com.memoweft.weftmate`。普通卸载保留资料；明确选「删除数据」调用现有卸载清理，删除整个配置资料目录，包含日志及转储。转储可能含进程内存，因此不进诊断摘要、导出或公开证据。

BK-1（个人备份）的 `included()` 当前排除 `Crashpad/`，**会包含 `logs/`**。本包按授权边界没有改备份范围。建议后续备份包明确排除整个 `logs/`（含启动标记），并决定已有备份的处理方式；因此「日志不进备份」目前尚未成立。ST-4（数据与存储）按账户导出资料，不加入全局宿主日志或转储；原有脱敏诊断导出也不自动带这两者。

测试使用 `tests/helpers/process-evidence.mjs`：`spawn()` 跑子进程，`track()` 接已有 Electron 进程，`runSync()` 兼容同步运行器，`recordLaunchFailure()` 留下启动失败。输出原始 / 无符号十进制与十六进制退出码、信号、输出各最近 1 MiB 和系统提交内存余量。异常时先保存宿主元数据日志与转储清单，再清理资料；转储内容始终不复制。`finalize()` 按创建时间、精确可执行路径、命令行中的隔离目录三项匹配清理，停止前再次核对，失败保留目录。PR #208 合并后，`tests/bl-29-runtime-close.test.ts` 应改用此助手。

手机本包验证使用网页视口；原生系统状态栏与底部导航栏没有验收。用户禁止 MuMu（安卓模拟器）和桌面接管，因此不把网页截图当成系统栏证据。真实系统文件夹打开与原生卸载勾选界面留本人试用确认，测试用替身及合成目录覆盖其接缝。

# 苹果运行记录字段约定

所有样例和截图使用合成数据。生产日志只在本机，不进仓库、不发云端、不进入备份。日期是 UTC ISO 8601；界面日期使用设备时区且不显示秒。事件外的元数据放在 `fields` 内，跨端合并时应统一这一层的位置。

| 字段 | 含义 | 平台 |
|---|---|---|
| at / event / runId / platform / appVersion / osVersion | 记录时间、闭集事件、每次进程启动随机 UUID、平台与已安装版本 | 三端 |
| fields.recordIndex | 每轮单调序号，与 runId 配合；同一秒发生的相同错误也分别计数，Watch 重放可去重 | 三端 |
| fields.launchKind | cold / resume；恢复沿用当前 runId | 三端 |
| fields.state | foreground / inactive / background，最后落盘状态 | 三端 |
| fields.reason / fields.exitCode | user_quit / system_termination / update，或未正常结束分类；仅已知时有退出码 | 三端模块；Mac 正常退出接线；iOS applicationWillTerminate best effort |
| previousRunId / lastAt / lastEvent | 上一轮运行标识、最后落盘时间和事件 | 三端 |
| fields.errorType / code / errorCode / phase | 闭集类型、泛化错误码、数字 HTTP / URL 错误码、失败阶段；无错误正文 | 三端 |
| fields.module / file / line | 自家模块、编译期源文件白名单、行号；无绝对路径和业务文件名 | 三端 |
| fields.status | online / offline / login_required / certificate_error / relay_unavailable / connecting | 手机 / Mac；Watch 记录通道失败 |
| fields.signal / exceptionCode / exceptionType / terminationReason | 数字系统诊断码与 signal / watchdog / memory_pressure / unknown | 手机 / Mac MetricKit |
| diagnosticBeginAt / diagnosticEndAt / diagnosticAppVersion | 系统诊断覆盖时段、被诊断的程序版本；at 是接收时间 | 手机 / Mac |
| fields.association | previous_run_candidate / unavailable，诊断可能跨多轮，不声称精确归属 | 手机 / Mac |
| frames | 最多 8 个自家二进制模块 + 数字文本偏移；SDK 未给出符号时不伪造函数名 | 手机 / Mac |
| reports[].name / at / fields.reportCount | 固定格式系统报告名、修改时间和数量，最多列出 50 个，不读取报告正文 | Mac |

| 事件 | 意义 | 平台 |
|---|---|---|
| app.start | 冷启动 / 后台恢复 | 三端 |
| app.state | 生命周期状态落盘 | 三端 |
| app.exit | 能确定的结束；完成 durable write 后才能标记 clean | Mac 生命周期；三端共用 API |
| app.previous_unclean_exit | 前台或 inactive 缺结束记录：suspected_foreground_crash；iOS / Watch 后台：terminated_in_background，不弹提示；Mac 后台也属于可疑退出 | 三端 |
| app.failure | Objective-C 未捕获异常 best effort，以及关键错误兜底；不读取异常原因、userInfo 或原始 stack | 手机 / Mac |
| connection.change | 状态变化，泛化错误码；无宿主身份 | 手机 / Mac |
| sync.failure / approval.failure | 同步、审批、通知或配对通道失败，保留阶段与错误码 | 三端 |
| diagnostic.crash / hang / cpu / disk | 延迟送达的 MetricKit 白名单投影 | 手机 / Mac |
| diagnostic.reports | 系统报告目录元数据盘点，不算新异常次数 | Mac |

摘要 JSON：`platform`, `appVersion`, `osVersion`, `generatedAt`, `recentAbnormalRecords`（最多 20 条）, `abnormalCountsLast7Days`（按保留记录逐事件统计；手机 Watch 栏统计已接收副本）, `retentionPolicy`（retentionDays / maxBytes）。缺正常退出仅是线索，绝不单凭退出标记声称是已确诊崩溃；后台回收也计入“异常结束线索”而不是“崩溃数”。

集中脱敏：未知字段全部丢弃；每个可自由赋值的字符串字段使用有限词表；只允许数字的系统错误码；编译期源码位置限自家模块和固定源码文件名；系统报告文件名限 WeftMateMac + 时间 + ips 固定格式。禁止正文、提示词、输出、用户文件名、身份、地址、域名、IP、URL、Cookie、凭据、随机业务串。运行 UUID 是诊断身份，不能填入业务身份。版本字符串只允许数字和版本分隔符。系统诊断树只在内存解析后立即丢弃。

手机 / Mac：7 天，目录总上限 2 MiB（预留 4 KiB 启动标记、手机 Watch inbox 最多 128 KiB 也计入上限）。手表：7 天，256 KiB。每日文件超限删最旧整文件，不截断 JSON 行。时钟回拨仍按持久化高水位做清理。分享时在不备份的临时目录创建固定名快照，最多一份，覆盖旧快照；需用户主动点击。Watch 发送最多 150 条 / 256 KiB，手机接收最多保留 150 条 / 128 KiB；发送失败不删手表原记录，重连、前台刷新补送，手机按完整记录去重。

MetricKit 模拟器无真实投递；真机才有真实崩溃、卡顿、CPU / 磁盘诊断。Swift fatalError / SIGKILL / 断电不可靠调用任何退出处理器，由落盘标记和后续 MetricKit 提供线索。完整符号名需要匹配的系统符号化信息；当前 SDK callStackTree 通常是模块 + 偏移，只保存这项。24 小时负载可能覆盖多次启动，previousRunId 是候选关联。

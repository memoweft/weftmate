# 五端本机运行记录

Windows、Android、macOS、iOS 和 watchOS 的运行记录只在设备本机保留，不上传、不接第三方崩溃服务、不随系统备份或设备迁移带走。程序每轮生成独立 `runId`（运行标识）。设置里的「运行记录」显示本次启动、上一轮结束情况和最近七天异常线索；Android 在已有区域增加「本机（这部手机）」，电脑宿主记录仍可单独查看。上次没有正常结束时，已有状态提示条提供详情入口；后台被系统回收不弹异常提示。记录缺少正常退出仅是线索，不直接称为已确诊崩溃。

诊断摘要先给人话预览，再由使用者复制 JSON（结构化数据格式）。Android「分享日志文件」只在使用者主动点击后打开系统分享面板，分享历史记录的脱敏投影，不自动发送。普通手机浏览器没有原生壳，网页运行异常只在浏览器本地保存容量很小的最近记录，可在同一设置区域查看。

## 统一诊断摘要

五端复制出去的摘要是一个对象，采用苹果端 DIAG-3 的结构；人话预览与机器可读摘要分开。Windows 与 Android 的 `status().summary` 是这个对象的 JSON 字符串，`summaryPreview` 是预览文字。字段类型如下。

| 字段 | 类型与约定 |
|---|---|
| `platform` | `windows` / `android` / `macos` / `ios` / `watchos` |
| `appVersion` | 已安装程序版本，不使用账户、设备或宿主身份 |
| `osVersion` | 操作系统版本，不含机器名 |
| `generatedAt` | 生成时间，UTC（协调世界时）的 ISO 8601（标准日期格式）字符串 |
| `recentAbnormalRecords` | 最多 20 条最近异常线索；每条含 `at / event / runId / platform / appVersion / osVersion / fields`；苹果系统诊断可以有下表注明的白名单扩展 |
| `abnormalCountsLast7Days` | 按事件名计数的对象，值为整数；统计保留的七天记录，不局限于摘要里最后 20 条 |
| `retentionPolicy.retentionDays` | 本端的保留天数 |
| `retentionPolicy.maxBytes` | 本端运行记录总大小上限，数值为字节；转储另有本机限制，不进入摘要 |
| 记录的 `at / event / runId` | 原始标准时间、固定事件名、程序生成的 UUID（随机唯一标识）；页面显示日期使用设备时区，不显示秒 |
| 记录的 `fields` | 白名单字段字典，摘要中的所有值均为字符串；未知字段、自由文本和用户文件名全部丢弃 |
| `fields.recordIndex` | 每轮单调递增序号；用 `runId + recordIndex` 区分同一秒内相同事件，不按秒去重 |

Windows 历史日志没有序号时，读取时按文件顺序补序号，不丢弃同秒的不同记录。新 Windows 原始 JSONL（每行一个 JSON 对象）日志的序号和诊断字段在顶层；Android、苹果原始日志的事件字段在 `fields` 内。对外摘要统一使用上表结构，原始日志无需为摘要格式改写历史记录。

以下示例使用合成运行标识：

```json
{
  "platform": "android",
  "appVersion": "0.1.0",
  "osVersion": "12 (API 31)",
  "generatedAt": "2026-10-11T12:00:00Z",
  "recentAbnormalRecords": [{
    "at": "2026-10-11T11:59:00Z",
    "event": "app.failure",
    "runId": "00000000-0000-4000-8000-000000000001",
    "platform": "android",
    "appVersion": "0.1.0",
    "osVersion": "12 (API 31)",
    "fields": {"recordIndex": "2", "source": "native-uncaught", "name": "java.lang.RuntimeException"}
  }],
  "abnormalCountsLast7Days": {"app.failure": 1},
  "retentionPolicy": {"retentionDays": 7, "maxBytes": 2097152}
}
```

## 平台事件与白名单字段

Windows 完整包冒烟的首窗失败摘要另外包含 `startup`：固定阶段名和自进程启动起的 `elapsedMs`（毫秒耗时）。启动器为每次启动分配独立文件，通过 `WEFTMATE_FIRST_WINDOW_TRACE` 开启旁路记录；普通启动不写这份记录。它在主模块应用依赖执行前安装，覆盖应用就绪、配置与凭据存储、单实例锁、运行时子进程拉起、窗口创建、准备显示、页面加载完成；原生进程启动及模块链接之前仍不可观测。文件中的进程号和绝对时间仅用于本机核对，不进入新增摘要。

这份记录独立于进程树查询。Windows 查询仅请求需要的 CIM（系统管理信息）属性，使用系统 PowerShell（命令行解释器）与系统模块目录；仍保持 3 秒采样上限。失败时 `children.reason` 明确区分超时、查询程序缺失、输出过大、无效 JSON、无效结果及其他查询失败。`hostLog: no-current-run` 只说明未匹配到本轮日志；查询不可用时不能据此判断宿主尚未启动。首窗原有 30 秒期限、返回值及异常不变，没有重试。

Windows 保留既有 `host.*` 事件名；Android 和苹果使用 `app.*`。共同摘要格式不把平台事实强行改成同一种退出原因。

| 事件 | Windows | Android | macOS / iOS / watchOS |
|---|---|---|---|
| 冷启动 / 后台恢复 | `host.start`；桌面进程启动 | `app.start`，`phase=cold/resume`，恢复沿用 `runId` | `app.start`，`launchKind=cold/resume` |
| 能确定的结束 | `host.exit`，退出码、收尾结果 | `app.exit`，已知界面结束；系统历史退出在下轮解释 | `app.exit`；macOS 正常退出接线；iOS 系统退出回调尽力记录 |
| 生命周期状态 | `host.session_end` | `app.background` | `app.state`，前台 / 非活跃 / 后台 |
| 上轮没有正常结束 | `host.previous_unclean_exit` | `app.previous_unclean_exit`；正常的历史结束用 `app.previous_exit` | `app.previous_unclean_exit`；iOS / Watch 后台终止标记 `terminated_in_background`，不弹提示 |
| 未捕获与关键错误 | `host.failure` | `app.failure`，原生异常或网页运行异常 | `app.failure`；手机 / Mac 的 Objective-C（苹果对象运行时）异常尽力记录 |
| 连接变化 | 既有宿主元数据；本包不新增接线 | `connection.change`，在线 / 离线 / 需要登录 / 证书错误 / 中继不可用 | `connection.change`；手机 / Mac；Watch 通道失败用同步事件 |
| 同步 / 审批失败 | 既有宿主失败与阶段元数据；本包不新增接线 | `sync.failure` / `approval.failure`，含后台任务、离线副本与通知操作 | `sync.failure` / `approval.failure`，含通知与 Watch 配对通道 |
| 通知失败 | — | `notification.failure` | 归入同步 / 审批阶段 |
| 网页内核 / 渲染进程 | `renderer.process_gone` / `renderer.recovery` | `webview.process_gone` / `webview.recovery`，崩溃或回收、退出优先级、重建结果 | — |
| 辅助 / 运行时进程 | `child.process_gone` / `runtime.process_gone` | Android 历史进程退出原因 | — |
| 界面加载 / 签名 / 回退 | 既有启动失败、渲染恢复 | `ui.load_failure` / `ui.verification_failure` / `ui.fallback` | — |
| 系统诊断 | 本机 Crashpad（原生转储机制），不导出转储 | Android 11 及以上历史退出 API（应用程序接口） | `diagnostic.crash` / `diagnostic.hang` / `diagnostic.cpu` / `diagnostic.disk`；手机 / Mac 的 MetricKit（苹果系统诊断框架）；Mac 另有 `diagnostic.reports`，盘点不计新异常 |

| 白名单字段 | 限制与平台差异 |
|---|---|
| `reason / phase / source / action / state / status / processType` | 每个平台各自的固定词表；状态码字段可为数字的字符串，不接受地址或业务文本 |
| `code / name / errorType / errorCode` | 固定安全错误码、已知异常类或数字系统错误码；不记录异常消息原文 |
| `exitCode / signal / normal / cleanupComplete / durationMs / shutdownDurationMs` | Windows 已知退出结果及收尾耗时；没有真实退出码时不猜测 |
| `previousRunId / lastAt / lastEvent / previousAt / exitTimeKnown` | 前一轮运行标识、已知时间和事件；Android 时间未知时明确标记，不拿最后活动时间冒充实际退出时间 |
| `reasonCode / importance / importanceCode / priority / didCrash` | Android 系统退出原因、前台 / 后台重要性级别与网页内核崩溃事实 |
| `script / line / column / stackFrame1` … `stackFrame8` | Android / Windows 自家源码白名单定位；最多八帧；不含异常消息、参数或用户文件路径 |
| `module / file / line / frames` | 苹果编译期模块与源文件白名单；系统诊断树最多八个自家二进制模块 + 数字偏移，不伪造未提供的函数名 |
| `diagnosticBeginAt / diagnosticEndAt / diagnosticAppVersion / association` | 苹果延迟系统诊断的覆盖时段和版本；`previous_run_candidate` 是候选关联，不声称精确归属 |
| `dumpCount / dumpBytes` | Windows 转储数量与总大小；摘要不含转储文件名或正文 |
| `reports / reportCount` | 苹果 Mac 固定格式系统报告元数据，不读报告正文；具体字段见 PR #210 的字段表 |

苹果字段与保留策略以 [DIAG-3 字段表](https://github.com/memoweft/WeftMate/blob/wp/diag-3-apple-run-log/apps/apple/Tests/Evidence/DIAG-3/fields.md)和 [RunLog.swift](https://github.com/memoweft/WeftMate/blob/wp/diag-3-apple-run-log/apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/RunLog.swift) 为依据，DIAG-2 不改苹果实现。

## Android 原生记录与历史退出

原生日志位于 `Context.noBackupFilesDir/diagnostics/android-YYYY-MM-DD.jsonl`，按天分片；持久启动标记是同目录的 `current-run.json`。写入刷新到磁盘，标记以临时文件原子替换；被系统直接杀掉仍能在下一轮恢复前一轮状态。写失败只使运行记录状态变为错误，不中断应用。后台进入、恢复更新前台状态，恢复沿用本轮标识。

Android 11（API 30）及以上调用 `ActivityManager.getHistoricalProcessExitReasons`，按上一轮进程号和启动时间筛选系统历史记录，不读系统给的自由文本描述和进程转储。退出原因映射如下。

| 系统原因 | 记录原因 | 解释与提示 |
|---|---|---|
| `REASON_CRASH` / `REASON_CRASH_NATIVE` / `REASON_ANR` | `crash` / `native_crash` / `anr` | 系统确认的崩溃 / 原生崩溃 / ANR（应用无响应），记异常并提示 |
| `REASON_LOW_MEMORY` | `low_memory`；后台回收为 `terminated_in_background` | 前台保留异常线索；后台正常回收不提示 |
| `REASON_USER_REQUESTED` / `REASON_USER_STOPPED` | `user_requested` / `user_stopped` | 使用者划掉、强行停止等，保留实际系统分类 |
| `REASON_PERMISSION_CHANGE` / `REASON_PACKAGE_UPDATED` | `permission_change` / `system_update` | 权限变化、程序包更新；保留原因，不冒充崩溃 |
| `REASON_EXIT_SELF` | `activity_finished` | 程序自行结束，视为正常 |
| `REASON_UNKNOWN` / 其余原因 | `unknown` / `system_other` | 不推断缺失的原因；后台系统回收按正常后台结束处理 |
| 无历史记录或 API 30 以下 | `unknown`；根据最后落盘前台 / 后台状态判断是否提示 | 未知实际退出时间写 `exitTimeKnown=false`；界面明确时间未知 |

网页内核结束由 `onRenderProcessGone` 记录并销毁失效的 WebView（安卓网页控件），建立新界面；区分崩溃和内存回收。网页运行期间 `error` / `unhandledrejection`（未处理的拒绝）经通用桥方法写原生日志；只接受错误类型、自家脚本名和行列号。新桥方法为 `diagnostics.status`、`diagnostics.record`、`diagnostics.share`，不新增 `/personal/v1` 路由。**需要新壳版本**：应用启动标记、系统退出查询、未捕获异常处理、网页内核恢复及三个桥方法都依赖新增原生代码；版本号由发布流程统一递增。

应用的未捕获异常处理器先落安全 `app.failure`，然后把控制权交还原来的系统处理器，让 Android 按原来方式结束应用。交还的是固定技术提示、没有原始消息或异常原因链、仅有安全本包栈帧的异常副本，避免再次向默认处理器传递原文。新增诊断代码没有 `Log.*`（安卓系统日志调用）。但 Android 的系统 pre-handler（异常预处理器）会在应用默认处理器之前打印原异常，公开 SDK（软件开发工具包）不能替换它；[AOSP 的 RuntimeInit 实现](https://android.googlesource.com/platform/frameworks/base/%2B/296c28979c5b212e9e32be397901f93e15b60bf3/core/java/com/android/internal/os/RuntimeInit.java)明确分开这两步。MuMu 实测确认：本机日志不含注入私文，但系统 logcat 原文检查失败。**不能声称所有系统日志都已脱敏**；本包不绕过非 SDK 限制、不改模拟器日志设置、不取消默认崩溃终止。Android 系统和网页内核自身日志不经过该模块，分享入口只提供重新投影的本机 JSONL 文件，公开证据也只使用脱敏后的日志样例。系统日志的绝对脱敏要求尚未满足，须在后续平台范围评审中处理。

## 保留、备份与分享边界

| 平台 | 运行记录保留 | 总大小上限与备份 |
|---|---|---|
| Windows | 7 天；每片 2 MiB（兆二进制字节） | JSONL 总计 32 MiB；`logs/` 与 `Crashpad/` 不进个人备份 |
| Android | 7 天；每日分片 | 2 MiB，预留启动标记空间；`noBackupFilesDir` 不进 Auto Backup（自动备份），现有 `backup_rules.xml` / `data_extraction_rules.xml` 也排除应用目录与设备迁移数据 |
| macOS / iOS | 7 天；每日文件 | 2 MiB；预留启动标记空间；iOS 接收的 Watch 副本也计入目录上限；目录标记不备份 |
| watchOS | 7 天；每日文件 | 256 KiB（二进制千字节）；目录标记不备份；配对手机只接收有界副本 |

所有平台不记录对话、提示词、模型输出、文件内容、用户文件名、账户名、邮箱、设备名、服务器地址、域名、IP、密钥、令牌、Cookie（会话凭据）、授权头、URL（网址）查询串或随机业务长串。运行 UUID 和每轮序号是程序生成的诊断身份，不得替换成业务身份。摘要与分享在读取历史数据时再次校验白名单。原生转储可能含内存，绝不进入摘要、日志分享或公开证据。

## Windows 原有记录与可靠退出

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

BK-1（个人备份）的 `included()` 排除数据目录下的 `Crashpad/` 与整个 `logs/`（含启动标记）：运行日志和原生转储是本机诊断，不随备份带走，恢复到新电脑后从空记录开始。此前已经生成的备份里可能带有旧的宿主日志（当时只有元数据），不回头改写旧备份。ST-4（数据与存储）按账户导出资料，不加入全局宿主日志或转储；原有脱敏诊断导出也不自动带这两者。

测试使用 `tests/helpers/process-evidence.mjs`：`spawn()` 跑子进程，`track()` 接已有 Electron 进程，`runSync()` 兼容同步运行器，`recordLaunchFailure()` 留下启动失败。输出原始 / 无符号十进制与十六进制退出码、信号、输出各最近 1 MiB 和系统提交内存余量。异常时先保存宿主元数据日志与转储清单，再清理资料；转储内容始终不复制。`finalize()` 按创建时间、精确可执行路径、命令行中的隔离目录三项匹配清理，停止前再次核对，失败保留目录。PR #208 合并后，`tests/bl-29-runtime-close.test.ts` 应改用此助手。

DIAG-2 的 Android 验收使用 MuMu（安卓模拟器）独立测试包名和合成数据：冷启动、强行停止后再启动、正常后台恢复、未捕获异常和网页内核崩溃恢复。证据必须是带系统状态栏的整屏截图，并注明系统 / 页面主题、系统版本及底部导航区域是否可见；模拟器隐藏底部导航栏时如实标注，不声称该区域已验收。脱敏日志与摘要样例放在任务书指定的仓库外 Runtime（运行数据）证据目录；生成脚本使用 `WEFTMATE_EVIDENCE_DIR`，未设置时使用被忽略的 `.local/evidence/`。模拟器验证不能替代真实设备的低内存回收、实际 ANR、系统更新 / 权限变更或厂商后台管理行为；这些属于本人真机验证清单。苹果 MetricKit 的真实投递同样需要真机。真实系统文件夹打开与 Windows 原生卸载勾选界面仍留本人试用确认，测试使用合成路径替身。


## 系统状态与诊断包（R0-2）

设置 → 系统状态显示「对话与工具、记忆、回复模型、远程连接、安全连接」五行，分别对应宿主、记忆桥、模型入口、中继和证书。组件自己的自动恢复机制先处理短暂失败并留下脱敏运行记录；状态页只在使用者主动打开设置时显示，正常项不显示修复按钮。不可用时说明影响的功能与下一步；电脑可只重启／重连出问题的那一项，手机和远程网页只读。远程连接或证书失败不会阻止本机继续使用。

记忆核心有 `health.runtime.semantic_recall` 时，记忆行另显示「按意思找」的未启用、准备中、就绪、不可用及人话原因。查询不加载模型；旧核心未提供这个字段时不显示。查找不可用时仍可按关键词查找，重连只重试当前账户的记忆连接。

三项运行表现复用现有记录：`host.ready.durationMs` 为本次启动到桌面界面就绪的用时；`model.first_token.durationMs` 只在前台回复首次正文时记录一次，思考、后续正文与后台请求均不重复；最近 20 个样本取中位数。当前内存读取 Electron（桌面程序框架）已有进程工作集，单位为 MB（兆字节）。未记录的值显示「尚未记录」，不把零伪装成已测量结果；参照线为启动 10 秒、首字 5 秒、内存 1 GB（吉字节），用于排查而非硬性预算。

电脑点击「导出诊断包」先在设置页展开内容说明，再由既有系统保存框选择位置。ZIP（压缩包格式）固定包含：`manifest.json`、`runtime-records.jsonl`、`diagnostics-summary.json`、`components.json`、`versions.json`、`performance.json`。只将运行记录与摘要的已知事件、固定状态、数值和安全错误模板投影进去；未知字段与自由文本丢弃。组件仅包含固定标识、状态与原因代码，语义查找仅含状态；版本不含账户或电脑身份。压缩包不遍历账户目录，不包含对话、记忆、凭据、端点、文件路径、机器名或 Crashpad（原生崩溃转储）文件。敏感内容扫描使用合成正文、记忆、密钥、登录凭据和路径污染输入，解压全部成员后检查，必须零命中。

上次没有正常退出的提示、运行记录、诊断摘要预览与日志文件夹入口继续使用 DIAG-1 的实现；不新增第二套崩溃报告或上传服务。真实保存框由本人试用时确认；自动验收用合成保存路径替身，避免接管本人桌面。

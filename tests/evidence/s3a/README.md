# S3a · 推送接口与 Android 后台通知

所有宿主使用合成账户、系统临时目录与随机回环端口。MuMu（安卓模拟器）仅安装本包 `com.memoweft.weftmate.mobile.s3aqa` / `.test`，未覆盖本人应用；真实模型只使用 MiMo（小米模型服务），密钥经进程内凭据替身保存，未请求 8081 / LAN（局域网模型）或日用宿主。

## 已验证

| 场景 | 证据 / 结果 |
|---|---|
| 前台、后台存活，各收到审批 / 任务完成 / 提醒 | `mumu.json`；通知栏浅 / 深 `notification-shade-*`、`background-notifications-*` |
| 通知栏实际点「批准」→ 原审批回执 → 合成电脑任务继续并完成 | `notification-approve-original-receipt-host-continues`；既有原宿主 / DSH（助手运行时）事件夹具，没有独立审批执行器 |
| 宿主勿扰仅动态、有声 / 静默决定、同 ID 去重、已读 / 待办处理撤销、真实测试通知、无常驻项 | `mumu.json`；五类十个渠道读取真实 Android（安卓）权限 / 声音状态，静默提醒使用无声渠道 |
| 被杀后 WorkManager（安卓后台任务库）补发 | 退出测试引导后启动普通应用进程，切后台，再仅结束本包进程；确认 PID（进程标识符）消失；仅在 QA（质量验证）包把持久 WorkSpec 的 `last_enqueue_time` 调为已到期，然后 `adb shell cmd jobscheduler run -f <package> <jobId>`，冷进程重新读宿主、发出遗漏提醒；不是实际系统等待 15 分钟的时延成绩 |
| 首次需要才申请、用途解释、拒绝后状态说明 | `permission-request-light/dark.png` 为真实 Android 系统弹窗；`permission-denied-light.png` 和 UI（界面）测试检查拒绝后的手动开启说明 |
| 真实 MiMo 一分钟提醒 → 固定 DSH 调度 → 宿主动态 → 后台 Android 唯一系统通知 → 点击精确动态 | `real-mimo.json`、`real-mimo-shade-*`、`real-mimo-deeplink.png`、`real-mimo-desktop.png` |
| 原生 360×780 / 390×844、实际 Electron（桌面程序框架）1000px / 480px 浅深、通知模式菜单打开 | `ui.json`（页面错误 0、无横向溢出）；`native-*`、`electron-*` |

Android 原生消费器、Keystore（安卓密钥库）身份、原生网络、业务桥与系统通知均是真实实现。测试宿主没有部署云登录；CDP（浏览器调试协议）驱动仅让云登录页面组合保持休眠，合成账户仍经产品原生 `auth.login` 认证，没有替换任何业务响应。生产云登录闭环由 LG（登录）工作包验证，不把本包夹具当作生产云登录验收。

周期任务最短 15 分钟且联网，受 Doze（省电休眠）、后台限制和厂商策略影响，**尽力而为，不保证及时，可能延迟约 15 分钟以上**。系统「强行停止」会阻止任务，须再次手动打开应用。MuMu 直接退出 instrumentation（原生测试引导）后曾拒绝作业冷启动并报 `user 0 is stopped`；最终驱动退出测试模式、进入正常应用进程后再结束该进程，冷任务补发通过。此前 `pm revoke`（强制撤销权限）会结束采样进程，最终权限拒绝改为实际点击系统弹窗；MuMu 界面导出可能写完 XML（界面结构）后返回139，驱动使用已写文件核对可见按钮。

## 定向检查

- Android JVM（Java 虚拟机）44/44，包括新通知决定 / 已读与处理 / 去重 / 五类十渠道 / 跨来源账户身份 / Worker（后台任务）凭据与重试 / 无提供方登记等 7 项；调试包、测试包构建通过。
- 宿主动态 / 通知决定 / 推送15/15：103,680种宿主决定组合保留；设备登记、令牌轮换 / 撤销、私有载荷边界、有效设备派发、重启 / 删除与原审批等通过。
- 云19/19：登记 DPoP（设备持钥证明）认证 / 隔离 / 不回显、设备撤权 / 账号注销级联清理、新 schema（存储结构）8、进程入口与既有账号生命周期回归通过。Windows（微软桌面系统）现有目录 `fsync`（同步落盘）不适用，因此使用现成 Ubuntu Node（JavaScript 运行时），未修改生产落盘逻辑。
- 手机桥与生成资产 / 主对话12/12、`npm run typecheck` 通过；Impeccable（界面检查工具）机械检查0项。完整测试交 PR（拉取请求）CI（持续集成），最终结果由 Claude 查看。
- 最终合并 manifest（应用清单）保留 WorkManager 需要的普通 `WAKE_LOCK`（唤醒锁）权限，移除库默认、未使用的 `FOREGROUND_SERVICE` 权限及 `SystemForegroundService`；本实现无常驻通知、前台服务、Google Play 服务或电池白名单请求。

真实 MiMo 共4次请求：输入10,123 token（令牌，含缓存8,448）、输出160、总计10,283，逐次回执见 `real-mimo.json`，汇总见 `mimo-total.json`。没有额外模型请求。

## 交付边界

需要新壳版本：新增原生通知 / 动态桥、任务库、权限 / 系统状态接线；本包未改安卓版本号和界面包默认版本，由 Claude 合并递增并发布。当前 PushProvider（推送提供方接口）明确未配置，没有 FCM（Firebase 云消息）/ 厂商 / APNs（苹果推送服务）真实网络；未来接口只传事件 ID / 类型，设备自己向宿主取正文及决定。云 schema8 未部署，真实一加13厂商后台设置、Apple（苹果端）本地通知、长期调度延迟与浸泡未验。Apple 接线清单与完整契约见 CLIENT_API 9.8.2；本包不改 `apps/apple`。

本人一加13最多三步：①「设置 → 通知」打开系统通知设置，允许 WeftMate 通知及所需分类；②「查看后台运行设置」进入应用系统页，按需要允许自启动、后台活动并取消后台限制（具体名称以手机当前系统为准）；③回 WeftMate 发送测试通知，切到后台检查收到。仍不保证被杀后的及时性，不主动申请电池优化白名单。

运行器：`tests/integration/s3a-mumu.mjs`、`s3a-mimo.mjs`、`s3a-ui.mjs`。只能在独占 MuMu 并装好独立包后运行；会清本包 QA 数据，不可改成日用包名。尺寸验证结束恢复原 MuMu 显示覆盖值；收尾卸载本包两个 APK（安卓安装包）并关闭本包启动的模拟器，不停止 MuMu 后台服务。

系统边界参考：[Android 周期任务最短间隔与省电约束](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest)、[Android 通知运行时权限](https://developer.android.com/develop/ui/views/notifications/notification-permission)。

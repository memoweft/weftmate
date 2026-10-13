# AND-5 · 安卓原生动态

动态列表、五类筛选（全部／待处理／任务／提醒／记忆）、待处理优先、未读标记、分页、下拉刷新、三态，以及周回顾和记忆周报正文使用 Jetpack Compose（安卓声明式界面）。审批、提问、提醒和任务打开原生聊天，按审批／问题编号或来源事件定位。通知沿用生产 PendingIntent（延迟启动入口）与原账号校验，进入原生动态对应条目或其对话；通知审批动作及回执没有改动。

记忆编辑／删除、报告的「完整操作」、成果预览与设置子页继续使用框架内的原网页。记忆周报内的「还对」、状态、话题分组与周回顾来源入口是原生控件；复杂操作在原生列表的原有位置保留入口，不要求用户切换整个应用。网页版继续服务手机浏览器，本包没有改网页文件。

浅色基准是当前安卓壳里的网页界面，深色按 10 月 13 日补充的中性灰磨砂规范。正文、行卡片、信息顺序与文案对照现有 `apps/mobile-ui/www/styles.css`、`activity.css` 和 `components/activity-view.js`。颜色只取 `DesignTokens.kt`；共享颜色由 AND-4 更新并合入。图标来自项目安卓图标产物。

本页按钮和选择控件按 `controls-spec`（控件规范）实现：44 的点按区、22 的项目图标、15／20 的标签字、999 的按钮圆角、12 的菜单圆角；按下缩到 97%，禁用整体 45%，有键盘焦点环。五个互斥筛选按“超过四项用菜单”收进同一入口，全部／待处理／任务／提醒／记忆都在，当前项只加勾。图标按钮不带文字。菜单动作带项目图标，危险项在末尾并有分隔；记忆忘掉的二次确认继续沿原网页处理。

深色菜单 Android 12+ 使用其自身弹出窗口的 `FLAG_BLUR_BEHIND`（窗口背景模糊），不模糊菜单文字、不改活动窗口，关闭时还原属性；真实范围是菜单后面的整屏背景。系统不支持或关闭窗口模糊时使用生成的实色回退。`controls-audit.json` 核对 15 项深色令牌（透明度量化到最近的 8 位值），菜单取证记录系统能力与实际窗口标志。滚动内容不设置模糊，长对话浅／深各 12 次滑动的帧数据单独记录。

现有契约没有独立每日摘要类型；呈现接口实际返回的 `weeklyInsight`（每周回顾）、`memoryDigest`（记忆周报）和 `system.dnd.summary`（勿扰期间提醒汇总），没有新造类别。已读提交当前 `attentionRevision`（注意内容版本）并在重试时复用请求编号；全部已读只提交已读取的冻结快照。标为已读不会批准审批或回答问题。账号／筛选变化丢弃旧响应；单一动态模型同时更新列表与底栏未读点。

所有运行只用 `com.memoweft.weftmate.mobile.and5qa` 独立包、合成账号和电脑、随机端口及临时目录。没有请求日用端口、日用数据、线上 WeftMate 云服务，没有接管桌面或修改模拟器设置。SDK（安卓开发工具）ADB（安卓调试桥）使用本包随机端口的私有服务，从 `MuMuManager.exe info -v 0` 获取实际调试端口；每轮在重活名额和 `mumu.lock`（模拟器占用锁）内安装、取证、卸载、断开并关闭私有服务，失败也清理。

手机独立空状态使用合成身份的 `authSource: "phone"`，验证页面不会读取电脑动态、不出现故障或“正在连接”。注册及手机独立聊天由 AND-4／MOB-4 验收。本包验证“已有手机独立身份进入动态”，不把它说成完整云登录验收。

`fixture.mjs` 复用 AND-4 的真实个人账号登录与聊天，替换动态快照及合成审批／问题投影；旧任务定位场景另提供 220 条合成历史，按正式接口处理前后分页和来源窗口。`NativeFeedInstrumentedTest.kt` 操作生产界面与网络层；`native-run.mjs` 调用生产通知轮询并点击实际系统通知，覆盖应用后台及进程被结束后的冷启动。合成审批／提问用于验证进入原生卡片，没有把它们算成真实模型审批提交；原有审批与通知动作继续沿原账本和回执。证据不含凭据、本机用户路径或机器名。

并排图见 [pairs.html](pairs.html) 及 `pairs/`。浅色左网页、右原生：同一合成账号、固定快照、逻辑宽度和主题。原网页通过原 `HybridActivity` 与已有回退偏好启动，仅测试包适配逻辑宽度，没有改变网页代码。深色左侧直接渲染提供的控件规范预览，右侧是本包原生；深色不再对照旧网页的墨绿主题。拼接保留原始图像像素与状态栏，规范预览的所有外部请求被拦截。

原生与 iPhone 的差异不再作为验收基准：安卓保留当前网页的双层标题、五类筛选、原位周报正文和纯图标底栏；iPhone 既有页的大标题、文字底栏与详情浮层没有照搬。待处理优先和人话时间遵循本包要求。

最终数量、通知结果与逐张系统栏色差如下。MuMu（安卓模拟器）没有可见底部系统手势条，原始整屏图仍保留其实际区域；不以这些图声称真机底部系统栏已验收。

## 最终实测

- 本包独立开发阶段完整必过：337 文件，1930 通过、0 失败、14 项既有跳过。
- 本包独立开发阶段固定运行时：34 文件，239 通过、0 失败。
- 安卓 JVM（Java 虚拟机）：102 项、0 失败；离线 APK（安卓安装包）与仪器化包构建通过，路由库存自动比对通过。
- 本包独立开发阶段手机交互组五文件：114 通过、0 失败；合入父分支后类型检查、8 项相关检查和公开卫生复验通过。
- 原生 360／390 浅／深四组均通过；后台／冷启动两次均点击真实系统通知进入原生聊天。
- 220 条历史的旧任务跳转验证包含全部事件 1–220，无中段缺口，屏幕定位到事件 2。分页、下拉手势、自动增量、记忆确认、已读及底栏清点均包含在四组测试内。

| 通知场景 | 点击方式 | 进入页 | 进程验证 | 结果 |
|---|---|---|---|---|
| 后台 | tap actual system notification row | 原生聊天 | 保留后台进程 | 通过 |
| 冷启动 | tap actual system notification row | 原生聊天 | 前后 PID（进程编号）不同 | 通过 |

| 长对话主题 | 合成消息数 | 滑动次数 | 渲染帧 | 卡顿帧 | 比例 |
|---|---:|---:|---:|---:|---:|
| 浅色基准 | 82 | 12 | 298 | 173 | 58.05% |
| 深色／固定磨砂面板 | 82 | 12 | 359 | 156 | 43.45% |

这些是共享机器同一轮的观测值，不把单轮结果当成稳定性能保证。列表和消息文字本身没有模糊；菜单仅在打开时设置自身窗口背景模糊，关闭恢复。

## 深色取值核对

参考来自提供的 `controls-spec.json`，源码绑定核对见 `controls-audit.json`；透明度取最近的 8 位表示。

| 令牌 | 规范深色值 | 安卓绑定 | 核对 |
|---|---|---|---|
| canvas | #1c1c1e | nativeDarkCanvas | 一致 |
| surface | #2a2a2c | nativeDarkSurface | 一致 |
| surface-soft | rgba(120,120,128,.26) | nativeDarkSoft | 一致 |
| line | rgba(255,255,255,.14) | nativeDarkLine | 一致 |
| ink | #f2f2f4 | nativeDarkInk | 一致 |
| ink-secondary | #c4c4c9 | nativeDarkSecondary | 一致 |
| ink-muted | #a3a3a9 | nativeDarkMuted | 一致 |
| accent | #e6e6e8 | nativeDarkAccent | 一致 |
| accent-hover | #ffffff | nativeDarkAccentHover | 一致 |
| accent-soft | rgba(255,255,255,.16) | nativeDarkAccentSoft | 一致 |
| on-accent | #1c1c1e | nativeDarkOnAccent | 一致 |
| danger | #ffa3ad | nativeDarkDanger | 一致 |
| selected-on-soft | rgba(255,255,255,.18) | nativeDarkSelectedOnSoft | 一致 |
| surface-float | rgba(44,44,46,.74) | nativeDarkSurfaceFloat | 一致 |
| danger-soft | rgba(255,110,125,.20) | nativeDarkDangerSoft | 一致 |

## 逐张系统栏

原始整屏图均未裁切。系统版本、应用读取的系统深浅与实际底部区域写在 `screenshots.json`；测试没有修改模拟器系统主题。下面的色差比较真实状态栏与相邻顶栏中央背景。系统通知面板属于系统界面，其差值单独列出，不与应用主题作一致性判定。

| 原始图 | 实际像素／逻辑尺寸 | 页面主题 | 系统版本／读取主题 | 状态栏色差 | 底部系统区域 |
|---|---|---|---|---:|---|
| [and5-360-dark-auto-refresh.png](and5-360-dark-auto-refresh.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-empty.png](and5-360-dark-empty.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-error.png](and5-360-dark-error.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-filter-menu.png](and5-360-dark-filter-menu.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-final-badge.png](and5-360-dark-final-badge.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-list-all-read.png](and5-360-dark-list-all-read.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-list-unread-pending.png](and5-360-dark-list-unread-pending.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-loading.png](and5-360-dark-loading.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-memory-confirmed.png](and5-360-dark-memory-confirmed.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-memory-filter.png](and5-360-dark-memory-filter.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-memory-inline.png](and5-360-dark-memory-inline.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-memory-menu.png](and5-360-dark-memory-menu.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-memory-review-web.png](and5-360-dark-memory-review-web.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-more-loaded.png](and5-360-dark-more-loaded.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-no-computer.png](and5-360-dark-no-computer.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-open-approval.png](and5-360-dark-open-approval.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-open-question.png](and5-360-dark-open-question.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-open-reminder.png](and5-360-dark-open-reminder.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-open-task.png](and5-360-dark-open-task.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-pending-read.png](and5-360-dark-pending-read.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-pull-refresh.png](and5-360-dark-pull-refresh.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-retry.png](and5-360-dark-retry.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-row-menu.png](and5-360-dark-row-menu.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-web-empty.png](and5-360-dark-web-empty.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-web-list-unread-pending.png](and5-360-dark-web-list-unread-pending.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-web-row-menu.png](and5-360-dark-web-row-menu.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-weekly-inline.png](and5-360-dark-weekly-inline.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-dark-weekly-source.png](and5-360-dark-weekly-source.png) | 720×1280／360×640 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-auto-refresh.png](and5-390-light-auto-refresh.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-empty.png](and5-390-light-empty.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-error.png](and5-390-light-error.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-filter-menu.png](and5-390-light-filter-menu.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-final-badge.png](and5-390-light-final-badge.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-list-all-read.png](and5-390-light-list-all-read.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-list-unread-pending.png](and5-390-light-list-unread-pending.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-loading.png](and5-390-light-loading.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-memory-confirmed.png](and5-390-light-memory-confirmed.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-memory-filter.png](and5-390-light-memory-filter.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-memory-inline.png](and5-390-light-memory-inline.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-memory-menu.png](and5-390-light-memory-menu.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-memory-review-web.png](and5-390-light-memory-review-web.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-more-loaded.png](and5-390-light-more-loaded.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-no-computer.png](and5-390-light-no-computer.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-open-approval.png](and5-390-light-open-approval.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-open-question.png](and5-390-light-open-question.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-open-reminder.png](and5-390-light-open-reminder.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-open-task.png](and5-390-light-open-task.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-pending-read.png](and5-390-light-pending-read.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-pull-refresh.png](and5-390-light-pull-refresh.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-retry.png](and5-390-light-retry.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-row-menu.png](and5-390-light-row-menu.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-web-empty.png](and5-390-light-web-empty.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-web-list-unread-pending.png](and5-390-light-web-list-unread-pending.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-web-row-menu.png](and5-390-light-web-row-menu.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-weekly-inline.png](and5-390-light-weekly-inline.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-light-weekly-source.png](and5-390-light-weekly-source.png) | 720×1280／390×693.3 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-auto-refresh.png](and5-390-dark-auto-refresh.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-empty.png](and5-390-dark-empty.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-error.png](and5-390-dark-error.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-filter-menu.png](and5-390-dark-filter-menu.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-final-badge.png](and5-390-dark-final-badge.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-list-all-read.png](and5-390-dark-list-all-read.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-list-unread-pending.png](and5-390-dark-list-unread-pending.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-loading.png](and5-390-dark-loading.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-memory-confirmed.png](and5-390-dark-memory-confirmed.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-memory-filter.png](and5-390-dark-memory-filter.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-memory-inline.png](and5-390-dark-memory-inline.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-memory-menu.png](and5-390-dark-memory-menu.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-memory-review-web.png](and5-390-dark-memory-review-web.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-more-loaded.png](and5-390-dark-more-loaded.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-no-computer.png](and5-390-dark-no-computer.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-open-approval.png](and5-390-dark-open-approval.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-open-question.png](and5-390-dark-open-question.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-open-reminder.png](and5-390-dark-open-reminder.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-open-task.png](and5-390-dark-open-task.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-pending-read.png](and5-390-dark-pending-read.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-pull-refresh.png](and5-390-dark-pull-refresh.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-retry.png](and5-390-dark-retry.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-row-menu.png](and5-390-dark-row-menu.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-web-empty.png](and5-390-dark-web-empty.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-web-list-unread-pending.png](and5-390-dark-web-list-unread-pending.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-web-row-menu.png](and5-390-dark-web-row-menu.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-weekly-inline.png](and5-390-dark-weekly-inline.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-weekly-source.png](and5-390-dark-weekly-source.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-notification-panel-background.png](and5-390-dark-notification-panel-background.png) | 720×1280／390×693.3 | 系统通知面板 | 15／浅 | 2.323 | 不可见，未验真机手势条 |
| [and5-390-dark-notification-background.png](and5-390-dark-notification-background.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-390-dark-notification-panel-cold.png](and5-390-dark-notification-panel-cold.png) | 720×1280／390×693.3 | 系统通知面板 | 15／浅 | 2.323 | 不可见，未验真机手势条 |
| [and5-390-dark-notification-cold.png](and5-390-dark-notification-cold.png) | 720×1280／390×693.3 | 深 | 15／浅 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-auto-refresh.png](and5-360-light-auto-refresh.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-empty.png](and5-360-light-empty.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-error.png](and5-360-light-error.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-filter-menu.png](and5-360-light-filter-menu.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-final-badge.png](and5-360-light-final-badge.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-list-all-read.png](and5-360-light-list-all-read.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-list-unread-pending.png](and5-360-light-list-unread-pending.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-loading.png](and5-360-light-loading.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-memory-confirmed.png](and5-360-light-memory-confirmed.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-memory-filter.png](and5-360-light-memory-filter.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-memory-inline.png](and5-360-light-memory-inline.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-memory-menu.png](and5-360-light-memory-menu.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-memory-review-web.png](and5-360-light-memory-review-web.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-more-loaded.png](and5-360-light-more-loaded.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-no-computer.png](and5-360-light-no-computer.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-open-approval.png](and5-360-light-open-approval.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-open-question.png](and5-360-light-open-question.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-open-reminder.png](and5-360-light-open-reminder.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-open-task.png](and5-360-light-open-task.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-pending-read.png](and5-360-light-pending-read.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-pull-refresh.png](and5-360-light-pull-refresh.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-retry.png](and5-360-light-retry.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-row-menu.png](and5-360-light-row-menu.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-web-empty.png](and5-360-light-web-empty.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-web-list-unread-pending.png](and5-360-light-web-list-unread-pending.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-web-row-menu.png](and5-360-light-web-row-menu.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-weekly-inline.png](and5-360-light-weekly-inline.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |
| [and5-360-light-weekly-source.png](and5-360-light-weekly-source.png) | 720×1280／360×640 | 浅 | 15／深 | 0.000 | 不可见，未验真机手势条 |

两组尺寸每一种原生状态均已保留：未读与待处理、行菜单、类别菜单、已读待处理、各类对话去向、更多页、周回顾正文与来源、记忆正文／菜单／确认、原网页完整操作、全部已读、下拉刷新、自动更新、空、加载、错误与重试、手机独立空状态与最终底栏点。浅色三组网页并排、深色三组规范并排及每组三行说明见 `pairs.html`。

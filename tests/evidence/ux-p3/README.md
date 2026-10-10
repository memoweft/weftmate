# UX-P3 · D50 侧栏对齐参照与遗留修正

全部使用合成账号、项目、对话，随机端口与系统临时目录；真实模型请求 0。Windows 用生产 Electron（桌面程序框架）窗口，手机网页与安卓界面包使用真实 Chromium 触屏模式；系统通知另用真实 MuMu（安卓模拟器）独立原生包。未访问本人日用程序 / 数据或 8081。私人参照图仅本机查看，没有复制到仓库，也没有出现在证据截图中。

前图界面资源固定为公开提交 `82c62fce183e068717369d5a4f6de55b91d74910`；宿主保持隔离合成数据。参照采用两枚对话行尾图标；更多由右键、菜单键 / Shift+F10 或手机长按进入。

## 逐项规格、参照文字对照与前后图

| 项目 | 实现与对照 | 前 | 后 |
|---|---|---|---|
| 1 没指着 | 项目只有文件夹与名称；对话单行标题、单状态位；选中整行圆角浅底色。 | [浅色](before-electron-1200-light-sidebar-idle.png)、[深色](before-electron-1200-dark-sidebar-idle.png) | [浅色](after-electron-1200-light-sidebar-idle.png)、[深色](after-electron-1200-dark-sidebar-idle.png) |
| 2 项目悬停 / 聚焦 | 名称与按钮在同一整行内，更多在新对话左边；无项目选中态；与相邻选中对话左右边缘误差 0px，间距 3px。 | [浅色](before-electron-1200-light-project-hover-selected.png)、[深色](before-electron-1200-dark-project-hover-selected.png) | [浅色](after-electron-1200-light-project-hover-selected.png)、[深色](after-electron-1200-dark-project-hover-selected.png)；[浅色](after-electron-1200-light-project-keyboard.png)、[深色](after-electron-1200-dark-project-keyboard.png) |
| 3 对话悬停 / 信息卡 | 按参照保留置顶 / 归档两个图标；黑色提示；0.5 秒信息卡在行右，设备图标 / 相对时间 / 可选项目；右键 / 菜单键进入更多。隐藏新对话菜单不再阻断卡片。 | [浅色](before-electron-1200-light-chat-hover-card.png)、[深色](before-electron-1200-dark-chat-hover-card.png) | [浅色](after-electron-1200-light-chat-hover-card.png)、[深色](after-electron-1200-dark-chat-hover-card.png)；[浅色](after-electron-1200-light-pin-tooltip.png)、[深色](after-electron-1200-dark-pin-tooltip.png)；[浅色](after-electron-1200-light-archive-tooltip.png)、[深色](after-electron-1200-dark-archive-tooltip.png)；[浅色](after-electron-1200-light-chat-menu.png)、[深色](after-electron-1200-dark-chat-menu.png) |
| 4 层级 / 窄侧栏 / 长名称 | 只缩进子对话文字，背景等宽；统一分组行间距与内边距，长名称给操作位让空间；键盘焦点采用行内环，避免被滚动容器裁切。 | [浅色](before-electron-1200-light-narrow-sidebar.png)、[深色](before-electron-1200-dark-narrow-sidebar.png) | [浅色](after-electron-1200-light-narrow-sidebar.png)、[深色](after-electron-1200-dark-narrow-sidebar.png)；[浅色](after-electron-1200-light-long-project.png)、[深色](after-electron-1200-dark-long-project.png)；[浅色](after-electron-480-light-chat-hover-card.png)、[深色](after-electron-480-dark-chat-hover-card.png) |
| 5 状态优先级 | 运行中转圈 > 未读点 > 空。运行与未读同时有只显示转圈；置顶 / 临时保留菜单状态与无障碍描述，不再叠加状态图标。 | [浅色](before-electron-1200-light-sidebar-idle.png)、[深色](before-electron-1200-dark-sidebar-idle.png) | [浅色](after-electron-1200-light-sidebar-running.png)、[深色](after-electron-1200-dark-sidebar-running.png)；[浅色](after-electron-1200-light-sidebar-unread.png)、[深色](after-electron-1200-dark-sidebar-unread.png)；[浅色](after-electron-1200-light-sidebar-pinned.png)、[深色](after-electron-1200-dark-sidebar-pinned.png)；[浅色](after-electron-1200-light-sidebar-temporary.png)、[深色](after-electron-1200-dark-sidebar-temporary.png) |
| 6 手机抽屉 | 390×844 / 360×780 同层级、等宽背景、3px 间距；长按首层置顶 / 归档 / 更多，项目长按新建；无悬停卡。 | 沿 UX-2 合成基线 | [浅色](after-phone-web-390-light-drawer.png)、[深色](after-phone-web-390-dark-drawer.png)；[浅色](after-phone-web-360-light-long-press-menu.png)、[深色](after-phone-web-360-dark-long-press-menu.png)；[浅色](after-android-bundle-390-light-drawer.png)、[深色](after-android-bundle-390-dark-drawer.png)；[浅色](after-android-bundle-360-light-long-press-menu.png)、[深色](after-android-bundle-360-dark-long-press-menu.png) |
| 7 滚动条 | 公共 controls.css 统一 Chromium（浏览器引擎）伪元素实现，移除各区域的标准属性声明；8px 轨道内 4px 滑块，悬停 6px；按钮 display:none、宽高0。 | [UX-P2 点名旧图](../ux-p2/after-electron-480-dark-settings-memory.png)；[设置左栏旧图](../ux-p2/after-electron-1200-dark-settings-general.png) | [浅色](after-electron-480-light-settings-memory.png)、[深色](after-electron-480-dark-settings-memory.png)；[浅色](after-electron-1200-light-settings-general.png)、[深色](after-electron-1200-dark-settings-general.png)；[深色预览](library/desktop-dark-markdown.png) |
| 8 窄设置 / 搜索 | 账户用量条不再插入窄设置；记忆搜索按钮在输入框内，回车即搜。 | [浅色](before-electron-480-light-settings-memory.png)、[深色](before-electron-480-dark-settings-memory.png) | [浅色](after-electron-480-light-settings-memory.png)、[深色](after-electron-480-dark-settings-memory.png)；[浅色](after-electron-480-light-settings-general.png)、[深色](after-electron-480-dark-settings-general.png) |
| 9 刷新 | 记忆 / 设备 / 模型 / 系统 / 项目 / 网页资料 / 备份列表改小刷新图标。进入自动读取，记忆世界版本变化刷新列表；手机恢复前台自动读。 | [浅色](before-electron-1200-light-settings-memory.png)、[深色](before-electron-1200-dark-settings-memory.png) | [浅色](after-electron-1200-light-settings-memory.png)、[深色](after-electron-1200-dark-settings-memory.png)；[浅色](after-mobile-390-light-memory.png)、[深色](after-mobile-390-dark-memory.png) |
| 10 深色浮层 | 菜单 / 下拉 / 信息卡统一高一级表面、细边线、浮层阴影；浅色表面沿原样。 | [浅色](before-electron-1200-light-chat-menu.png)、[深色](before-electron-1200-dark-chat-menu.png) | [浅色](after-electron-1200-light-chat-menu.png)、[深色](after-electron-1200-dark-chat-menu.png)；[浅色](after-electron-1200-light-project-menu.png)、[深色](after-electron-1200-dark-project-menu.png)；[浅色](after-electron-1200-light-memory-menu.png)、[深色](after-electron-1200-dark-memory-menu.png) |
| 11 系统通知 | 宿主生成 notification.title/body；完成具体任务名 + 已完成提示，失败一句原因，审批具体操作，提醒内容。桌面与安卓消费同一字段；真实 error/blocked 原生终态映射失败。 | [S3a 旧图](../s3a/background-notifications-dark.png) | [completed浅色](notification-completed-light.png)、[completed深色](notification-completed-dark.png)、[failed浅色](notification-failed-light.png)、[failed深色](notification-failed-dark.png)、[approval浅色](notification-approval-light.png)、[approval深色](notification-approval-dark.png)、[reminder浅色](notification-reminder-light.png)、[reminder深色](notification-reminder-dark.png) |
| 12 手机设置标题 / 后台入口 | 主对话标题包装只作用于聊天页；设置子页显示通知 / 记忆等页名。后台运行入口为带箭头的次级按钮。 | [浅色](before-mobile-390-light-notifications.png)、[深色](before-mobile-390-dark-notifications.png) | [浅色](after-mobile-390-light-notifications.png)、[深色](after-mobile-390-dark-notifications.png)；[浅色](after-android-bundle-390-light-notifications.png)、[深色](after-android-bundle-390-dark-notifications.png) |
| 13 页面家族 | 动态 / 目标 / 成果库保持独立页名、隐藏对话专用控件、小刷新、主操作 + 更多、统一筛选与三态；成果库额外重验 18 项，含浅深、窄窗、手机、预览与事件刷新。 | [浅色](before-electron-1200-light-library.png)、[深色](before-electron-1200-dark-library.png) | [浅色](after-electron-1200-light-activity.png)、[深色](after-electron-1200-dark-activity.png)；[浅色](after-electron-1200-light-goals.png)、[深色](after-electron-1200-dark-goals.png)；[成果列表](library/desktop-light-list.png)；[手机错误态](library/mobile-360-dark-error.png)；[桌面加载态](library/desktop-dark-loading.png) |

## 滚动条原因与实际测量

标准 `scrollbar-width / scrollbar-color` 非 auto 时，Chromium 会使用标准滚动条并压过 WebKit（浏览器引擎）伪元素，所以仅隐藏 `::-webkit-scrollbar-button` 不足以覆盖那条绘制路径。本包将所有区域分散的标准声明移除，公共 `controls.css` 为 Chromium 重置标准属性、定制滑块和隐藏按钮；其他引擎只有一处标准细滚动条回退。

需要区分旧证据与当前代码：本人点名的 UX-P2 旧图仍有三角；开工提交已经包含 UX-P2 末轮 `auto!important` 覆盖，当前前图未再稳定复现箭头。前后测量里 `CSS.supports('selector(::-webkit-scrollbar)')` 都是 true，不能把原因说成该检测在本机不支持。最终所有已创建的对话区、侧栏、设置两栏、菜单、弹窗、预览、成果库 / 目标 / 动态容器为标准属性 auto、按钮 none / 0px；相关原始测量见 [before-checks.json](before-checks.json) 和 [after-checks.json](after-checks.json)。没有只靠源码正则判断成功。

## 第 8 条 / 8a 自查

- [x] 1 没有系统按钮 / 原生滚动条箭头残留；新刷新 / 搜索图标按钮复用公共四态样式；现有 textarea（多行输入框）与统一下拉保持。
- [x] 2 可点入口均为图标按钮、次级按钮、菜单项或整行；悬停、按下、聚焦、禁用态完整。
- [x] 3 入口在侧栏行尾、右键 / 长按、设置、已有更多工具位；没有在输入区或标题外插用量条。
- [x] 4 背景等宽、0px 左右边缘误差、3px 行间距；子标题缩进；运行转圈保持正圆、不被 flex（弹性布局）压扁；480px 信息卡不盖住指针路径，贴边翻转检查通过。
- [x] 5 置顶 / 记忆开关状态保留，列表加载 / 空 / 错误与重试均有呈现；成果库真实三态与恢复检查通过。
- [x] 6 Electron 1200 / 480、收窄侧栏、手机 360×780 / 390×844，均浅深；系统通知也浅深。
- [x] 7 对照 Codex 三种侧栏状态的层级、密度、整行底色、两枚悬停操作、侧置信息卡；项目和选中子对话不再错位或紧贴。
- [x] 8 本包项目菜单、对话菜单、账户菜单、记忆更多、手机快捷 / 更多 / 项目菜单、信息卡均有浅深打开态；成果库的行菜单、筛选、标签与预览弹层见 library 子目录。
- [x] 9 最终关键截图已目检并确认，没有以只截触发按钮作为完成证据。

8a：独立页名、对话专用工具隐藏、小刷新与自动刷新、列表主动作 + 更多、统一分段 / 标签、人话时间 / 大小、保存提示、三态均沿页面家族统一。通知保存改轻提示，不留下“已同步”一行。机械检测只报告原有非本包新增的 `execution-group` 2px 左边线；本包可见截图没有该遗留样式。

## 验证与复现

- `node tests/integration/ux-p3-sidebar.mjs`：真实 Electron、手机网页、安卓界面包的浅深 / 状态 / 对齐 / 长按 / 信息卡路径 / 滚动条检查；[结果](after-checks.json)。`--before` 使用固定前版资源。
- `node --test apps/mobile-ui/tests/chat-interactions.test.mjs apps/mobile-ui/tests/sidebar-interactions.test.mjs`：96/96；包含 390 / 360 浅深几何、长按、项目菜单、设置标题 / 记忆搜索与刷新。
- 桌面 / 共享领域相关组：92/92、90/90、最终 52/52（各组有重叠）；最后资源 / 浮层 / 通知 16/16。最终组含真实 Electron 的 UI-1（第一轮界面）互动验收。没有运行本地全量测试。
- `node tests/integration/tb-3-library.mjs`（指定 `WEFTMATE_LIBRARY_EVIDENCE_DIR=tests/evidence/ux-p3/library`）：18 项真实程序检查，正常 / 加载 / 空 / 错误 / 重试、图片 / Markdown / PDF、480px 与手机 390 / 360、事件刷新；[结果](library/verification.json)。
- `node tests/integration/ux-p3-notifications-native.mjs`：真实 Android NotificationManager（系统通知管理器）记录逐项等于宿主文案，8 张浅深通知；[结果与清理](notification-checks.json)。Android（安卓）`ActivityNotificationPolicyTest` 8/8，原生编译通过。
- `npm run typecheck`（类型检查）、令牌生成一致性、手机资源一致性 / 77 个脚本语法检查通过；审稿页桌面与手机 `session-menu` 场景浅深通过，侧栏证据与名称已更新。
- 完整测试交 PR（拉取请求）CI（持续集成）；推送后读取检查快照，最终结果由 Claude 看，不等待。

## Apple（苹果端）对应改动清单

1. Mac（苹果电脑）项目行常态仅展开 / 合上文件夹与截断名称；悬停 / 聚焦整行浅底色，行内更多 / 新对话。取消项目选中态；与子对话背景等宽、左右对齐、间隔 3px，仅标题缩进一级。
2. Mac 对话状态位运行转圈 > 未读点 > 空；置顶 / 临时保留菜单与无障碍属性。悬停两枚置顶 / 归档图标及黑色提示；更多由右键 / 菜单键，约 0.5 秒信息卡在行右，设备图标、相对时间、可选项目；贴边翻转 / 收窄且不盖指针。
3. iPhone（苹果手机）抽屉同层级与状态优先级；长按首层置顶 / 归档 / 更多，项目长按新建，不显示悬停卡。设置子页顶栏显示分类名，后台运行入口是带箭头次级行；小刷新 / 自动刷新、输入框内搜索 / 回车。
4. Mac 采用原生无箭头细滚动条，检查侧栏、对话、设置两栏、菜单、弹窗、预览和三个固定页；深色菜单 / 下拉 / 信息卡采用高一级表面与细边线。动态 / 目标 / 成果库遵循 8a。
5. Apple 动态模型解析可选 `notification.title/body`，Mac / iPhone 系统通知与 Watch（苹果手表）展示优先使用宿主字段；旧宿主回退动态 `title/summary`。保留私密级别、批准 / 拒绝、点击深链；补完成 / 失败 / 审批 / 提醒 / 临时脱敏测试，不在客户端拼“任务完成”类别文案。
6. 新 `folder-open` 母版及 Apple 普通 / 小尺寸资产、黑色提示颜色令牌已生成；Apple 原生实现留对应工作包，本包不声称已实现。

## 交付边界与清理

需要新安卓壳版本：原生通知消费宿主文案字段；本包没有修改 versionCode / versionName 或界面包默认版本，由 Claude 合并后统一递增。没有新增权限、发布、部署或真实模型 / 生产链路测试。

原生测试已卸载自己的 QA（验收测试）包与测试包、退出探针、删除自己的反向映射与临时目录，关闭自己启动的 MuMu；未动本人程序、模型服务或其他包。主验收浏览器 / Electron / 隔离宿主均在 finally（收尾处理）关闭；已清理进程：4 个本包残留 Electron，按创建时间、可执行路径和命令行同时核对后清理；最终残留 0。详见 [cleanup.json](cleanup.json)。

## 全部截图索引


### 前版

- [before-electron-1200-dark-account-menu.png](before-electron-1200-dark-account-menu.png)
- [before-electron-1200-dark-activity.png](before-electron-1200-dark-activity.png)
- [before-electron-1200-dark-archive-tooltip.png](before-electron-1200-dark-archive-tooltip.png)
- [before-electron-1200-dark-chat-hover-card.png](before-electron-1200-dark-chat-hover-card.png)
- [before-electron-1200-dark-chat-keyboard.png](before-electron-1200-dark-chat-keyboard.png)
- [before-electron-1200-dark-chat-menu.png](before-electron-1200-dark-chat-menu.png)
- [before-electron-1200-dark-goals.png](before-electron-1200-dark-goals.png)
- [before-electron-1200-dark-library.png](before-electron-1200-dark-library.png)
- [before-electron-1200-dark-long-project.png](before-electron-1200-dark-long-project.png)
- [before-electron-1200-dark-memory-menu.png](before-electron-1200-dark-memory-menu.png)
- [before-electron-1200-dark-narrow-sidebar.png](before-electron-1200-dark-narrow-sidebar.png)
- [before-electron-1200-dark-pin-tooltip.png](before-electron-1200-dark-pin-tooltip.png)
- [before-electron-1200-dark-pinned-hover.png](before-electron-1200-dark-pinned-hover.png)
- [before-electron-1200-dark-project-collapsed.png](before-electron-1200-dark-project-collapsed.png)
- [before-electron-1200-dark-project-hover-selected.png](before-electron-1200-dark-project-hover-selected.png)
- [before-electron-1200-dark-project-keyboard.png](before-electron-1200-dark-project-keyboard.png)
- [before-electron-1200-dark-settings-general.png](before-electron-1200-dark-settings-general.png)
- [before-electron-1200-dark-settings-memory.png](before-electron-1200-dark-settings-memory.png)
- [before-electron-1200-dark-sidebar-idle.png](before-electron-1200-dark-sidebar-idle.png)
- [before-electron-1200-light-account-menu.png](before-electron-1200-light-account-menu.png)
- [before-electron-1200-light-activity.png](before-electron-1200-light-activity.png)
- [before-electron-1200-light-archive-tooltip.png](before-electron-1200-light-archive-tooltip.png)
- [before-electron-1200-light-chat-hover-card.png](before-electron-1200-light-chat-hover-card.png)
- [before-electron-1200-light-chat-keyboard.png](before-electron-1200-light-chat-keyboard.png)
- [before-electron-1200-light-chat-menu.png](before-electron-1200-light-chat-menu.png)
- [before-electron-1200-light-goals.png](before-electron-1200-light-goals.png)
- [before-electron-1200-light-library.png](before-electron-1200-light-library.png)
- [before-electron-1200-light-long-project.png](before-electron-1200-light-long-project.png)
- [before-electron-1200-light-memory-menu.png](before-electron-1200-light-memory-menu.png)
- [before-electron-1200-light-narrow-sidebar.png](before-electron-1200-light-narrow-sidebar.png)
- [before-electron-1200-light-pin-tooltip.png](before-electron-1200-light-pin-tooltip.png)
- [before-electron-1200-light-pinned-hover.png](before-electron-1200-light-pinned-hover.png)
- [before-electron-1200-light-project-collapsed.png](before-electron-1200-light-project-collapsed.png)
- [before-electron-1200-light-project-hover-selected.png](before-electron-1200-light-project-hover-selected.png)
- [before-electron-1200-light-project-keyboard.png](before-electron-1200-light-project-keyboard.png)
- [before-electron-1200-light-settings-general.png](before-electron-1200-light-settings-general.png)
- [before-electron-1200-light-settings-memory.png](before-electron-1200-light-settings-memory.png)
- [before-electron-1200-light-sidebar-idle.png](before-electron-1200-light-sidebar-idle.png)
- [before-electron-480-dark-settings-general.png](before-electron-480-dark-settings-general.png)
- [before-electron-480-dark-settings-memory.png](before-electron-480-dark-settings-memory.png)
- [before-electron-480-dark-sidebar.png](before-electron-480-dark-sidebar.png)
- [before-electron-480-light-settings-general.png](before-electron-480-light-settings-general.png)
- [before-electron-480-light-settings-memory.png](before-electron-480-light-settings-memory.png)
- [before-electron-480-light-sidebar.png](before-electron-480-light-sidebar.png)
- [before-mobile-390-dark-memory.png](before-mobile-390-dark-memory.png)
- [before-mobile-390-dark-notifications.png](before-mobile-390-dark-notifications.png)
- [before-mobile-390-light-memory.png](before-mobile-390-light-memory.png)
- [before-mobile-390-light-notifications.png](before-mobile-390-light-notifications.png)

### 新版

- [after-android-bundle-360-dark-drawer.png](after-android-bundle-360-dark-drawer.png)
- [after-android-bundle-360-dark-long-press-menu.png](after-android-bundle-360-dark-long-press-menu.png)
- [after-android-bundle-360-dark-notifications.png](after-android-bundle-360-dark-notifications.png)
- [after-android-bundle-360-light-drawer.png](after-android-bundle-360-light-drawer.png)
- [after-android-bundle-360-light-long-press-menu.png](after-android-bundle-360-light-long-press-menu.png)
- [after-android-bundle-360-light-notifications.png](after-android-bundle-360-light-notifications.png)
- [after-android-bundle-390-dark-drawer.png](after-android-bundle-390-dark-drawer.png)
- [after-android-bundle-390-dark-long-press-menu.png](after-android-bundle-390-dark-long-press-menu.png)
- [after-android-bundle-390-dark-notifications.png](after-android-bundle-390-dark-notifications.png)
- [after-android-bundle-390-light-drawer.png](after-android-bundle-390-light-drawer.png)
- [after-android-bundle-390-light-long-press-menu.png](after-android-bundle-390-light-long-press-menu.png)
- [after-android-bundle-390-light-notifications.png](after-android-bundle-390-light-notifications.png)
- [after-electron-1200-dark-account-menu.png](after-electron-1200-dark-account-menu.png)
- [after-electron-1200-dark-activity.png](after-electron-1200-dark-activity.png)
- [after-electron-1200-dark-archive-tooltip.png](after-electron-1200-dark-archive-tooltip.png)
- [after-electron-1200-dark-chat-hover-card.png](after-electron-1200-dark-chat-hover-card.png)
- [after-electron-1200-dark-chat-keyboard.png](after-electron-1200-dark-chat-keyboard.png)
- [after-electron-1200-dark-chat-menu.png](after-electron-1200-dark-chat-menu.png)
- [after-electron-1200-dark-goals.png](after-electron-1200-dark-goals.png)
- [after-electron-1200-dark-library.png](after-electron-1200-dark-library.png)
- [after-electron-1200-dark-long-project.png](after-electron-1200-dark-long-project.png)
- [after-electron-1200-dark-memory-menu.png](after-electron-1200-dark-memory-menu.png)
- [after-electron-1200-dark-narrow-sidebar.png](after-electron-1200-dark-narrow-sidebar.png)
- [after-electron-1200-dark-pin-tooltip.png](after-electron-1200-dark-pin-tooltip.png)
- [after-electron-1200-dark-pinned-hover.png](after-electron-1200-dark-pinned-hover.png)
- [after-electron-1200-dark-project-collapsed.png](after-electron-1200-dark-project-collapsed.png)
- [after-electron-1200-dark-project-hover-selected.png](after-electron-1200-dark-project-hover-selected.png)
- [after-electron-1200-dark-project-keyboard.png](after-electron-1200-dark-project-keyboard.png)
- [after-electron-1200-dark-project-menu.png](after-electron-1200-dark-project-menu.png)
- [after-electron-1200-dark-settings-general.png](after-electron-1200-dark-settings-general.png)
- [after-electron-1200-dark-settings-memory.png](after-electron-1200-dark-settings-memory.png)
- [after-electron-1200-dark-sidebar-idle.png](after-electron-1200-dark-sidebar-idle.png)
- [after-electron-1200-dark-sidebar-pinned.png](after-electron-1200-dark-sidebar-pinned.png)
- [after-electron-1200-dark-sidebar-running.png](after-electron-1200-dark-sidebar-running.png)
- [after-electron-1200-dark-sidebar-temporary.png](after-electron-1200-dark-sidebar-temporary.png)
- [after-electron-1200-dark-sidebar-unread.png](after-electron-1200-dark-sidebar-unread.png)
- [after-electron-1200-light-account-menu.png](after-electron-1200-light-account-menu.png)
- [after-electron-1200-light-activity.png](after-electron-1200-light-activity.png)
- [after-electron-1200-light-archive-tooltip.png](after-electron-1200-light-archive-tooltip.png)
- [after-electron-1200-light-chat-hover-card.png](after-electron-1200-light-chat-hover-card.png)
- [after-electron-1200-light-chat-keyboard.png](after-electron-1200-light-chat-keyboard.png)
- [after-electron-1200-light-chat-menu.png](after-electron-1200-light-chat-menu.png)
- [after-electron-1200-light-goals.png](after-electron-1200-light-goals.png)
- [after-electron-1200-light-library.png](after-electron-1200-light-library.png)
- [after-electron-1200-light-long-project.png](after-electron-1200-light-long-project.png)
- [after-electron-1200-light-memory-menu.png](after-electron-1200-light-memory-menu.png)
- [after-electron-1200-light-narrow-sidebar.png](after-electron-1200-light-narrow-sidebar.png)
- [after-electron-1200-light-pin-tooltip.png](after-electron-1200-light-pin-tooltip.png)
- [after-electron-1200-light-pinned-hover.png](after-electron-1200-light-pinned-hover.png)
- [after-electron-1200-light-project-collapsed.png](after-electron-1200-light-project-collapsed.png)
- [after-electron-1200-light-project-hover-selected.png](after-electron-1200-light-project-hover-selected.png)
- [after-electron-1200-light-project-keyboard.png](after-electron-1200-light-project-keyboard.png)
- [after-electron-1200-light-project-menu.png](after-electron-1200-light-project-menu.png)
- [after-electron-1200-light-settings-general.png](after-electron-1200-light-settings-general.png)
- [after-electron-1200-light-settings-memory.png](after-electron-1200-light-settings-memory.png)
- [after-electron-1200-light-sidebar-idle.png](after-electron-1200-light-sidebar-idle.png)
- [after-electron-1200-light-sidebar-pinned.png](after-electron-1200-light-sidebar-pinned.png)
- [after-electron-1200-light-sidebar-running.png](after-electron-1200-light-sidebar-running.png)
- [after-electron-1200-light-sidebar-temporary.png](after-electron-1200-light-sidebar-temporary.png)
- [after-electron-1200-light-sidebar-unread.png](after-electron-1200-light-sidebar-unread.png)
- [after-electron-480-dark-chat-hover-card.png](after-electron-480-dark-chat-hover-card.png)
- [after-electron-480-dark-settings-general.png](after-electron-480-dark-settings-general.png)
- [after-electron-480-dark-settings-memory.png](after-electron-480-dark-settings-memory.png)
- [after-electron-480-dark-sidebar.png](after-electron-480-dark-sidebar.png)
- [after-electron-480-light-chat-hover-card.png](after-electron-480-light-chat-hover-card.png)
- [after-electron-480-light-settings-general.png](after-electron-480-light-settings-general.png)
- [after-electron-480-light-settings-memory.png](after-electron-480-light-settings-memory.png)
- [after-electron-480-light-sidebar.png](after-electron-480-light-sidebar.png)
- [after-mobile-360-dark-drawer-states.png](after-mobile-360-dark-drawer-states.png)
- [after-mobile-360-dark-drawer.png](after-mobile-360-dark-drawer.png)
- [after-mobile-360-dark-longpress.png](after-mobile-360-dark-longpress.png)
- [after-mobile-360-dark-project-longpress.png](after-mobile-360-dark-project-longpress.png)
- [after-mobile-360-light-drawer-states.png](after-mobile-360-light-drawer-states.png)
- [after-mobile-360-light-drawer.png](after-mobile-360-light-drawer.png)
- [after-mobile-360-light-longpress.png](after-mobile-360-light-longpress.png)
- [after-mobile-360-light-project-longpress.png](after-mobile-360-light-project-longpress.png)
- [after-mobile-390-dark-drawer-states.png](after-mobile-390-dark-drawer-states.png)
- [after-mobile-390-dark-drawer.png](after-mobile-390-dark-drawer.png)
- [after-mobile-390-dark-longpress-more.png](after-mobile-390-dark-longpress-more.png)
- [after-mobile-390-dark-longpress.png](after-mobile-390-dark-longpress.png)
- [after-mobile-390-dark-memory-more.png](after-mobile-390-dark-memory-more.png)
- [after-mobile-390-dark-memory.png](after-mobile-390-dark-memory.png)
- [after-mobile-390-dark-notifications.png](after-mobile-390-dark-notifications.png)
- [after-mobile-390-dark-project-longpress.png](after-mobile-390-dark-project-longpress.png)
- [after-mobile-390-dark-settings-general.png](after-mobile-390-dark-settings-general.png)
- [after-mobile-390-light-drawer-states.png](after-mobile-390-light-drawer-states.png)
- [after-mobile-390-light-drawer.png](after-mobile-390-light-drawer.png)
- [after-mobile-390-light-longpress-more.png](after-mobile-390-light-longpress-more.png)
- [after-mobile-390-light-longpress.png](after-mobile-390-light-longpress.png)
- [after-mobile-390-light-memory-more.png](after-mobile-390-light-memory-more.png)
- [after-mobile-390-light-memory.png](after-mobile-390-light-memory.png)
- [after-mobile-390-light-notifications.png](after-mobile-390-light-notifications.png)
- [after-mobile-390-light-project-longpress.png](after-mobile-390-light-project-longpress.png)
- [after-mobile-390-light-settings-general.png](after-mobile-390-light-settings-general.png)
- [after-phone-web-360-dark-drawer.png](after-phone-web-360-dark-drawer.png)
- [after-phone-web-360-dark-long-press-menu.png](after-phone-web-360-dark-long-press-menu.png)
- [after-phone-web-360-dark-settings.png](after-phone-web-360-dark-settings.png)
- [after-phone-web-360-light-drawer.png](after-phone-web-360-light-drawer.png)
- [after-phone-web-360-light-long-press-menu.png](after-phone-web-360-light-long-press-menu.png)
- [after-phone-web-360-light-settings.png](after-phone-web-360-light-settings.png)
- [after-phone-web-390-dark-drawer.png](after-phone-web-390-dark-drawer.png)
- [after-phone-web-390-dark-long-press-menu.png](after-phone-web-390-dark-long-press-menu.png)
- [after-phone-web-390-dark-settings.png](after-phone-web-390-dark-settings.png)
- [after-phone-web-390-light-drawer.png](after-phone-web-390-light-drawer.png)
- [after-phone-web-390-light-long-press-menu.png](after-phone-web-390-light-long-press-menu.png)
- [after-phone-web-390-light-settings.png](after-phone-web-390-light-settings.png)

### 真实系统通知

- [notification-approval-dark.png](notification-approval-dark.png)
- [notification-approval-light.png](notification-approval-light.png)
- [notification-completed-dark.png](notification-completed-dark.png)
- [notification-completed-light.png](notification-completed-light.png)
- [notification-failed-dark.png](notification-failed-dark.png)
- [notification-failed-light.png](notification-failed-light.png)
- [notification-reminder-dark.png](notification-reminder-dark.png)
- [notification-reminder-light.png](notification-reminder-light.png)

### 成果库 / 预览 / 菜单 / 三态

- [library/before-desktop-dark-markdown.png](library/before-desktop-dark-markdown.png)
- [library/before-desktop-light-list.png](library/before-desktop-light-list.png)
- [library/desktop-480-dark-menu.png](library/desktop-480-dark-menu.png)
- [library/desktop-480-dark-preview.png](library/desktop-480-dark-preview.png)
- [library/desktop-480-dark-project-open.png](library/desktop-480-dark-project-open.png)
- [library/desktop-480-dark-time-open.png](library/desktop-480-dark-time-open.png)
- [library/desktop-480-dark.png](library/desktop-480-dark.png)
- [library/desktop-480-light-menu.png](library/desktop-480-light-menu.png)
- [library/desktop-480-light-preview.png](library/desktop-480-light-preview.png)
- [library/desktop-480-light-project-open.png](library/desktop-480-light-project-open.png)
- [library/desktop-480-light-time-open.png](library/desktop-480-light-time-open.png)
- [library/desktop-480-light.png](library/desktop-480-light.png)
- [library/desktop-dark-add-open.png](library/desktop-dark-add-open.png)
- [library/desktop-dark-csv-preview.png](library/desktop-dark-csv-preview.png)
- [library/desktop-dark-empty.png](library/desktop-dark-empty.png)
- [library/desktop-dark-error.png](library/desktop-dark-error.png)
- [library/desktop-dark-grid.png](library/desktop-dark-grid.png)
- [library/desktop-dark-image.png](library/desktop-dark-image.png)
- [library/desktop-dark-list.png](library/desktop-dark-list.png)
- [library/desktop-dark-loading.png](library/desktop-dark-loading.png)
- [library/desktop-dark-markdown.png](library/desktop-dark-markdown.png)
- [library/desktop-dark-missing-menu.png](library/desktop-dark-missing-menu.png)
- [library/desktop-dark-missing-preview.png](library/desktop-dark-missing-preview.png)
- [library/desktop-dark-pdf.png](library/desktop-dark-pdf.png)
- [library/desktop-dark-png-preview.png](library/desktop-dark-png-preview.png)
- [library/desktop-dark-preview-expanded.png](library/desktop-dark-preview-expanded.png)
- [library/desktop-dark-preview-menu.png](library/desktop-dark-preview-menu.png)
- [library/desktop-dark-project-open.png](library/desktop-dark-project-open.png)
- [library/desktop-dark-py-preview.png](library/desktop-dark-py-preview.png)
- [library/desktop-dark-row-menu.png](library/desktop-dark-row-menu.png)
- [library/desktop-dark-tabs-open.png](library/desktop-dark-tabs-open.png)
- [library/desktop-dark-time-open.png](library/desktop-dark-time-open.png)
- [library/desktop-dark-zip-preview.png](library/desktop-dark-zip-preview.png)
- [library/desktop-empty.png](library/desktop-empty.png)
- [library/desktop-light-add-open.png](library/desktop-light-add-open.png)
- [library/desktop-light-csv-preview.png](library/desktop-light-csv-preview.png)
- [library/desktop-light-empty.png](library/desktop-light-empty.png)
- [library/desktop-light-error.png](library/desktop-light-error.png)
- [library/desktop-light-grid.png](library/desktop-light-grid.png)
- [library/desktop-light-keyboard-focus.png](library/desktop-light-keyboard-focus.png)
- [library/desktop-light-list.png](library/desktop-light-list.png)
- [library/desktop-light-loading.png](library/desktop-light-loading.png)
- [library/desktop-light-markdown.png](library/desktop-light-markdown.png)
- [library/desktop-light-missing-menu.png](library/desktop-light-missing-menu.png)
- [library/desktop-light-missing-preview.png](library/desktop-light-missing-preview.png)
- [library/desktop-light-pdf.png](library/desktop-light-pdf.png)
- [library/desktop-light-png-preview.png](library/desktop-light-png-preview.png)
- [library/desktop-light-preview-expanded.png](library/desktop-light-preview-expanded.png)
- [library/desktop-light-preview-menu.png](library/desktop-light-preview-menu.png)
- [library/desktop-light-project-open.png](library/desktop-light-project-open.png)
- [library/desktop-light-py-preview.png](library/desktop-light-py-preview.png)
- [library/desktop-light-row-menu.png](library/desktop-light-row-menu.png)
- [library/desktop-light-tabs-open.png](library/desktop-light-tabs-open.png)
- [library/desktop-light-time-open.png](library/desktop-light-time-open.png)
- [library/desktop-light-zip-preview.png](library/desktop-light-zip-preview.png)
- [library/desktop-missing-disabled.png](library/desktop-missing-disabled.png)
- [library/mobile-360-dark-empty.png](library/mobile-360-dark-empty.png)
- [library/mobile-360-dark-error.png](library/mobile-360-dark-error.png)
- [library/mobile-360-dark-list.png](library/mobile-360-dark-list.png)
- [library/mobile-360-dark-loading.png](library/mobile-360-dark-loading.png)
- [library/mobile-360-dark-preview-menu.png](library/mobile-360-dark-preview-menu.png)
- [library/mobile-360-dark-preview.png](library/mobile-360-dark-preview.png)
- [library/mobile-360-dark-project-open.png](library/mobile-360-dark-project-open.png)
- [library/mobile-360-dark-row-menu.png](library/mobile-360-dark-row-menu.png)
- [library/mobile-360-dark-time-open.png](library/mobile-360-dark-time-open.png)
- [library/mobile-360-light-empty.png](library/mobile-360-light-empty.png)
- [library/mobile-360-light-error.png](library/mobile-360-light-error.png)
- [library/mobile-360-light-list.png](library/mobile-360-light-list.png)
- [library/mobile-360-light-loading.png](library/mobile-360-light-loading.png)
- [library/mobile-360-light-preview-menu.png](library/mobile-360-light-preview-menu.png)
- [library/mobile-360-light-preview.png](library/mobile-360-light-preview.png)
- [library/mobile-360-light-project-open.png](library/mobile-360-light-project-open.png)
- [library/mobile-360-light-row-menu.png](library/mobile-360-light-row-menu.png)
- [library/mobile-360-light-time-open.png](library/mobile-360-light-time-open.png)
- [library/mobile-360.png](library/mobile-360.png)
- [library/mobile-390-dark-empty.png](library/mobile-390-dark-empty.png)
- [library/mobile-390-dark-error.png](library/mobile-390-dark-error.png)
- [library/mobile-390-dark-list.png](library/mobile-390-dark-list.png)
- [library/mobile-390-dark-loading.png](library/mobile-390-dark-loading.png)
- [library/mobile-390-dark-preview-menu.png](library/mobile-390-dark-preview-menu.png)
- [library/mobile-390-dark-preview.png](library/mobile-390-dark-preview.png)
- [library/mobile-390-dark-project-open.png](library/mobile-390-dark-project-open.png)
- [library/mobile-390-dark-row-menu.png](library/mobile-390-dark-row-menu.png)
- [library/mobile-390-dark-time-open.png](library/mobile-390-dark-time-open.png)
- [library/mobile-390-light-empty.png](library/mobile-390-light-empty.png)
- [library/mobile-390-light-error.png](library/mobile-390-light-error.png)
- [library/mobile-390-light-list.png](library/mobile-390-light-list.png)
- [library/mobile-390-light-loading.png](library/mobile-390-light-loading.png)
- [library/mobile-390-light-preview-menu.png](library/mobile-390-light-preview-menu.png)
- [library/mobile-390-light-preview.png](library/mobile-390-light-preview.png)
- [library/mobile-390-light-project-open.png](library/mobile-390-light-project-open.png)
- [library/mobile-390-light-row-menu.png](library/mobile-390-light-row-menu.png)
- [library/mobile-390-light-time-open.png](library/mobile-390-light-time-open.png)

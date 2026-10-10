# UX-P1 · Windows、手机网页与安卓界面打磨

基线：`99e75a74`。截图全部使用合成账号、随机端口与临时目录；产品参考图只在本机阅读，未复制到仓库。Windows 截图来自 `_electron.launch` 启动的真实程序窗口，手机网页走浏览器传输，安卓最终图来自独立 APK（安卓安装包）的 MuMu（安卓模拟器）系统截图。

| 清单 | 修复 | 修复前 | 修复后 |
|---|---|---|---|
| 1 | 消息行悬停 / 聚焦显示操作；最后一条助手回复保留操作；合并重复更多菜单 | [桌面对话](before-01-desktop-light.png) | [常态](after-01-desktop-light.png)、[悬停](after-01-desktop-hover.png)、[键盘](after-01-desktop-keyboard.png) |
| 2 | 输入区裸「开旁聊」移入带图标的「+」菜单；消息菜单保留从这里开旁聊 | [输入区](before-02-desktop-light.png) | [菜单](after-02-desktop-menu.png) |
| 3 | 更早内容按钮居中，使用次级样式 | [更早内容](before-03-desktop-earlier.png) | [更早内容](after-03-desktop-earlier.png) |
| 4 | 侧栏临时对话收进新旁聊右侧下拉 | [侧栏](before-04-desktop-light.png) | [下拉](after-04-desktop-dropdown.png) |
| 5 | 记忆开关显示勾选；期限收进子菜单并显示单选状态 | [原菜单](before-05-desktop-light.png) | [主菜单](after-05-desktop-light.png)、[期限单选](after-05-desktop-submenu.png) |
| 6 | 默认全部类型，顶部类型按钮与搜索；每条类型 / 状态 / 更新日期 / 来源对话 | [原记忆页](before-06-desktop-light.png) | [浅色](after-06-desktop-light.png)、[深色](after-06-desktop-dark.png) |
| 7 | 正常小绿点、形成数量、队列；异常提示原因 / 积压 / 查看 | [正常](before-07-desktop-light.png)、[异常](before-07-desktop-warning.png) | [正常](after-07-desktop-light.png)、[异常](after-07-desktop-warning.png) |
| 8 | 统计后显示单个确认卡片；取消预览、开始、暂停、恢复、取消运行 | [并排按钮](before-08-desktop-light.png) | [确认卡](after-08-desktop-light.png)、[运行进度](after-08-desktop-progress.png) |
| 9 | 设置分组标题改模型与能力；个性化改编辑图标 | [导航](before-09-desktop-light.png) | [导航](after-09-desktop-light.png) |
| 10 | 测试通过后由继续保存并前进；内容独立滚动，底栏不遮挡控件 | [被遮挡的保存按钮](before-10-desktop-light.png) | [模型页](after-10-desktop-light.png)、[滚到最后控件](after-10-desktop-scrolled.png)、[480px](after-10-desktop-480.png) |
| 11 | 三条示例改为带图标和悬停 / 按下态的建议卡片 | [浅色](before-11-desktop-light.png)、[深色](before-11-desktop-dark.png) | [浅色](after-11-desktop-light.png)、[深色](after-11-desktop-dark.png) |
| 12 | 浅深正文均为 400，Windows 中文字体优先 YaHei UI，关闭字体合成粗体 | [深色正文](before-12-desktop-dark.png) | [深色正文](after-12-desktop-dark.png)、[480px](after-12-desktop-480-dark.png) |
| 13 | 顶部工具行参与布局、不缩掉占位；搜索 / 日期图标有读屏名称 | [390浅](before-13-web-390-light.png)、[360深](before-13-web-360-dark.png) | [390浅](after-13-web-390-light.png)、[360深](after-13-web-360-dark.png)、[安卓实屏](after-13-android-native-dark.png) |
| 14 | 单行搜索：输入、上一条、下一条、计数、更多、关闭 | [390浅](before-14-web-390-light.png)、[360深](before-14-web-360-dark.png) | [390浅](after-14-web-390-light.png)、[360深](after-14-web-360-dark.png)、[安卓100条与更多](after-14-android-native-dark.png) |
| 15 | 桌面与手机共用浅深高亮颜色令牌，逐主题测试 ≥4.5:1 | [桌面深色](before-15-desktop-dark.png)、[手机深色](before-15-web-360-dark.png) | [桌面深色](after-15-desktop-dark.png)、[手机深色](after-15-web-360-dark.png)、[安卓深色](after-15-android-native-dark.png) |
| 16 | 状态提示移到输入卡片上方，给提示留出背景和间距 | [360深色旧布局](before-16-web-360-dark.png) | [360深色提示](after-16-web-360-dark.png)、[安卓真实账户切换状态](after-16-android-native-dark.png) |

手机网页及界面包 Chromium（浏览器引擎）均覆盖 390×844、360×780、浅深主题，所有完整图保留在本目录。安卓修复前图使用原界面包 Chromium，修复后使用实际 MuMu 系统截图；没有把浏览器图片记作原生实屏。补充的 `before-03` 与 `before-16` 从基线提交读取原 CSS（样式表）/布局，不回滚工作树；截图只比较相应控件。

验证：

- `node tests/integration/ux-p1-polish.mjs`：真实 Electron（桌面程序框架）、480px、两种手机尺寸与两种传输，通过；模型检查 / 保存、记忆状态 / 整理为合成响应，所有场景无真实模型请求。检查记录见 [after-checks.json](after-checks.json)。
- `node tests/integration/ux-p1-android.mjs`：独立包 `com.memoweft.weftmate.mobile.uxp1qa`、真实原生登录与桥接、主对话 / 搜索浅深色通过；版本保持 `0.8.15 / code28`。[原生记录](android-native-checks.json)。完成后卸载两只本包 APK、删除本包端口映射，关闭本包启动的模拟器。
- 相关 Node 单元 / 契约测试 **104/104**；手机聊天 / 视觉交互 **96/96**；`npm run typecheck`、手机生成资源一致性及语法检查通过；独立 Android（安卓）`assembleDebug / assembleDebugAndroidTest` 通过。完整测试交 CI（持续集成）。
- 默认全部类型、稳定分页、跨类型游标拒绝、跨快照版本拒绝、来源账本归属及全部浅深高亮对比度有专门断言；引导「继续」保存一次并进入记忆步骤，确认卡取消 / 开始 / 暂停 / 取消、消息悬停 / 键盘聚焦与单行搜索均有交互断言。
- 顺手处理：置顶 / 已读的勾选状态；手机记忆开关与期限单选；主对话重复更多按钮；分享预览与旁聊来源摘要的内层滚动，保留弹窗单一内容滚动。设置导航和内容可各自滚动，属于并列区域。480px 和 360×780 未出现页面横向溢出；内容仍可滚动到末尾。
- impeccable（界面设计打磨）机械检查返回空问题列表。审稿页接入本包记忆 / 引导 / 手机搜索与安卓实屏证据，主对话场景改为搜索展示。

边界与额外回归：

- 来源对话由既有 MemoWeft（记忆核心）任务账本关联。旧证据无账本映射、已删除或缺失时，保留来源详情入口并明确无法定位，避免伪造链接。`/memory/items` 增补 `kind=all / includeSources / totalCount / sourceConversationIds`，旧单类型默认保持。
- 未做 Apple（苹果端）原生界面、目标页、通知设置页或真实用户数据验证；未向 8081 发请求。没有新增原生权限或修改安卓版本号。
- 额外旧 `ui-5-session-menu.mjs` 回归内置真实 MiMo（小米模型服务）配置，已中止且不计通过。隔离用量账本记录 **5 请求、13,241 输入、4,096 缓存输入、189 输出**；请求跟踪中 8081 命中为 0。此用量与本包合成验收分开记录。[聚合记录](legacy-regression.json)。
- 已结束旧回归遗留的 5 个本包 Electron 进程。自动审批拒绝递归删除其隔离临时目录（返回 `blocked by policy`），该目录留在本机 `C:/Temp/weftmate-ui-5-mimo-f5ce2183-b4e3-4c29-a55e-b52126050449`，未提交任何运行数据或凭据。

Apple 对应改动：消息操作仅悬停 / 聚焦 / 最后助手回复显示；旁聊进入附件菜单；临时对话进入新旁聊下拉；记忆与期限菜单显示勾选 / 单选；记忆默认全部与来源对话、健康行、整理确认卡及进度控制；设置分组与个性化图标；模型页测试后继续保存；第一句建议卡；统一正文浅深字重；手机工具行占位、单行搜索与高亮对比度、输入上方提示。共用 Apple 颜色令牌已重新生成，原生界面接线仍由 Apple 包完成。

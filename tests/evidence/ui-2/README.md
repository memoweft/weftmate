# UI-2 手机界面统一验收

手机使用与 UI-1 / 1b / 1c 一致的中性色、细边框、助手 Markdown（结构化文本）正文与用户气泡。首页为可搜索的会话列表，顶部新对话；运行状态点来自真实会话状态，待审批点通过既有审批接口读取。进入会话后，工具步骤默认收起，先展开可读描述，再点具体步骤读取原文。轮询保留已展开的步骤和已读取的内容。

「输出与来源」全屏列表读取 CLIENT_API 3.16，正向分页并合并调用，同名成果沿用服务端最新项规则。成果全屏预览可保存到手机；来源先显示使用次数与每次的描述，点开才读详情，失败可收起重试。页面返回恢复对话滚动位置、跟随状态与草稿。已读取的来源列表按账户与会话缓存，离线时明确显示读取自缓存。

| 状态 | 浅色 | 深色 |
| --- | --- | --- |
| 会话列表与运行 / 待审批点 | [light-list.png](light-list.png) | [dark-list.png](dark-list.png) |
| 运行中、默认收起步骤与停止 | [light-running.png](light-running.png) | [dark-running.png](dark-running.png) |
| 三按钮审批卡 | [light-approval.png](light-approval.png) | [dark-approval.png](dark-approval.png) |
| 步骤展开后的可读描述 | [light-steps.png](light-steps.png) | [dark-steps.png](dark-steps.png) |
| 成果全屏预览与保存 | [light-artifact.png](light-artifact.png) | [dark-artifact.png](dark-artifact.png) |
| 来源全屏使用摘要 | [light-source.png](light-source.png) | [dark-source.png](dark-source.png) |

截图为真实 Chromium（浏览器引擎）390×844 页面，原生桥使用隔离的合成账户与合成记录；没有个人内容、真实模型请求或脚本执行。本机 ADB（安卓调试桥）设备列表为空，SDK（安卓开发工具集）没有模拟器组件及可用 AVD（安卓虚拟设备），因此按工作包指定的浏览器回退验收。没有在本人设备安装 APK（安卓安装包），不把浏览器视口缩小测试算作真实 IME（输入法）键盘验收；原生壳沿用现有 WindowInsets（窗口安全区）处理。

复现：

```powershell
$env:WEFTMATE_UI2_EVIDENCE='1'
node --test apps/mobile-ui/tests/visual-interactions.test.mjs
```

默认不设置此环境变量时，截图写 `.local/ui-2/`。固定断言涵盖首页搜索与状态、浅 / 深 / 跟随系统、步骤两层展开与详情按需读取、轮询保留展开状态、来源分页合并与重试、离线来源缓存、成果 Markdown / 表格、返回原滚动位置、草稿切换与重启、更早历史独立游标、320px / 横屏布局和缩小视口的输入区位置。完整断言清单见 [verification.json](verification.json)。

本机结果：手机相关测试 **100/100**，Android JVM（Java 虚拟机）**27/27**，`:app:assembleDebug`、`npm run typecheck`、手机版本包发布回归通过。Android **0.8.4 / versionCode 17**；新页面使用新增原生来源列表路由，发布最低 **code17**。没有新增系统权限，登录 / 云登录 / 配对码 / 附件 / 审批模式与三种决定 / 历史上翻 / 离线能力继续由原测试覆盖。完整测试由 PR CI（持续集成）执行。

后续边界：本包未发布宿主 UI（网页界面）更新包或 APK；未做真实 Android 设备、真实输入法、跨设备通知和生产云登录验收。来源只能展示既有已捕获的网页 / 文件与工具详情，不新增任意网页访问能力；记忆引用字段由记忆工作包提供。

# 记忆周报验收

使用真实 Electron（桌面程序框架）生产窗口与手机网页，连接随机端口、临时目录中的合成宿主和记忆桥。没有真实模型请求，没有读取日用宿主、已安装程序或真实账户内容；参考产品的私人截图只在本机查看。

合入 AUTH-1 后，桌面通过生产 `/auth/desktop` 入口直接进入机主账户，断言登录页不可见；手机桥只使用合成 HTTPS（加密传输）云服务完成邮箱核对、设备证明与 `/auth/cloud-session` 交换后的会话，并断言远程桌面入口返回 403、两端仍是同一个机主。周报操作与状态断言保持原保护点。

周报直接展示记忆原文，按已有主题分组，新增最多展示 6 条。「还有 2 条」打开按周筛选的记忆页。每条的「…」复用既有纠正、遗忘详情及确认；久未使用复核另保留「还对」按钮。样例含跨两周的记忆、本周已确认纠正及遗忘、2 条超过 90 天的旧记忆。电脑和手机分别走了纠正、忘掉、确认旧记忆，以及返回后的最新周报；电脑确认后，手机看到同一确认状态。

| 内容 | 截图文件 |
|---|---|
| 电脑周报，1200 / 480，浅 / 深 | `electron-{1200,480}-{light,dark}-report.png` |
| 电脑复核段，1200 / 480，浅 / 深 | `electron-{1200,480}-{light,dark}-review.png` |
| 手机网页，360×780 / 390×844，浅 / 深 | `phone-web-{360,390}-{light,dark}-report.png` |
| 手机复核段，同四组合 | `phone-web-{360,390}-{light,dark}-review.png` |
| 每条记忆菜单打开状态 | `electron-{light,dark}-memory-menu.png`、`phone-web-{light,dark}-memory-menu.png` |
| 既有纠正确认打开状态 | `electron-{light,dark}-correction-open.png`、`phone-web-{light,dark}-correction-open.png` |
| 既有遗忘确认打开状态 | `electron-{light,dark}-forget-open.png`、`phone-web-{light,dark}-forget-open.png` |
| 周报设置与星期选择器打开状态 | `electron-{light,dark}-digest-settings.png`、`electron-{light,dark}-weekday-open.png`、`phone-web-{light,dark}-digest-settings.png`、`phone-web-{light,dark}-weekday-open.png` |

验证脚本：[mem-3-weekly-memory-digest.mjs](../../integration/mem-3-weekly-memory-digest.mjs)。界面结果见 [verification.json](verification.json)。单元测试：[personal-memory-digest.test.ts](../../personal-memory-digest.test.ts)，原生定时测试见 [personal-schedules.test.ts](../../personal-schedules.test.ts)。完整测试计数与合主线后的持续集成结果以工作包交付报告为准。

纠正夹具使用真实核心的替换编号／旧版失效／修订链形状，覆盖新编号仍能再次操作；按周列表也跟随当前有效版本。自然纠正统计复用已有修订链，不增加查询或模型请求。

边界：手机证据是网页内容截图，不含操作系统状态栏或浏览器工具栏。未改安卓原生壳、苹果端或版本号，不能将本组图称为原生系统栏验收。现有记忆核心没有已清除记忆的历史遗忘清单和逐条历史召回时间，本版由宿主登记今后的已确认遗忘和实际召回；旧记忆明确提示缺少使用记录。人物与事物仍受既有核心直接纠正能力限制。

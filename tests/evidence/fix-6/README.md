# FIX-6 Windows 标题栏遮罩与通知

运行 `node tests/integration/fix-6-titlebar.mjs`。Playwright（界面自动化工具）的 `_electron.launch` 启动真实 `src/main.mjs`，使用系统临时标记目录、随机端口和合成账号。测试入口仅记录标题栏与通知调用，未替换窗口或 preload（预加载桥）。呈现数据来自隔离合成宿主；不调用模型，不使用日用数据。

- `before-{light,dark}-settings-{open,closed}.png`：基线 `b65cae8` 的桌面呈现脚本。
- `after-{light,dark}-settings-{open,closed}.png`：修改后的浅 / 深色打开遮罩及关闭恢复，共 8 张操作系统窗口截图，包含系统绘制的右上角按钮。
- `verification.json`：实际标题栏背景 / 符号颜色、令牌遮罩、混色期望值与恢复值；通知应用身份、原生标题 / 正文、图标加载结果与系统显示事件。

验收同时覆盖打开设置后切换浅 / 深色、更换主题色、嵌套不同透明度确认框（打开顺序与 DOM〔文档对象模型〕顺序不同）、直接删除顶层确认框、Esc 关闭恢复。混色单测使用 `design/tokens/tokens.json` 的真实 `desktop-scrim`。

通知由生产共用的 `desktopNotificationOptions` 构造，读取原生通知属性，并要求系统 `show` 事件成功。应用身份与 `package.json` 的打包 `appId` 一致，开发启动同样设置；此处验收为开发程序，未重新制作安装包。Windows 的通知身份规则参见 [Electron 官方通知文档](https://www.electronjs.org/docs/latest/tutorial/notifications)。

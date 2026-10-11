# WeftMate 安装窗口验收

全部使用 `inst1qa` 测试身份、隔离的当前用户安装登记与合成数据，安装目录在系统盘随机的 `wi1-…` 目录中。合成根目录保持短路径：既有 NSIS 升级先把旧文件搬到临时目录，长测试根会把深层运行时文件的搬移目标推到 262 个字符；本次根目录下的最长搬移目标为 244 个字符。没有更换文件处理引擎或绕过它的失败检查。使用独立后台桌面，没有切换本人桌面，没有全局鼠标键盘输入，没有访问本人安装或日用数据。

安装器沿用 NSIS（Windows 安装器）与 electron-builder（桌面打包工具）的默认执行脚本，页面改为单页品牌绘制层。当前用户默认位置、静默参数、应用内更新与差分块图沿用原链路。交互卸载只有保留数据的确认与进度，继续调用 `--uninstall-cleanup`，不提供删除数据选项。未知发布者与 SmartScreen（系统下载信誉保护）由 Windows 显示，本包没有签名证书。

真实窗口由 `tests/helpers/installer-window.cs` 的 PrintWindow（按窗口句柄取图）保存。每次捕获采用目标窗口自己的 DPI awareness context（像素密度坐标上下文），按 DWM（桌面窗口管理器）报告的可见窗口边界取图；`raw/` 同时保留完整原始窗口，结果记录原始／可见尺寸与边界偏移，避免将原生窗口和 Electron（桌面程序框架）的坐标混用。程序通过测试包专属的随机 CDP（Chromium 调试协议）端口设置自身浅深色；正式包没有测试主题、调试端口、合成失败与错误记录入口。截图没有遮盖、拼接窗口或设计稿替代。

| 过程 | 浅色窗口 | 深色窗口 | 行为 |
|---|---|---|---|
| 初次安装 | [install-light.png](install-light.png) | [install-dark.png](install-dark.png) | 自动安装，品牌标志、说明、真实进度，无下一步 |
| 自动打开程序 | [opened-light.png](opened-light.png) | [opened-dark.png](opened-dark.png) | 实际安装程序的首次引导窗口 |
| 程序运行中覆盖 | [running-retry-light.png](running-retry-light.png) | [running-retry-dark.png](running-retry-dark.png) | 提示退出程序，重试与取消；没有强制结束程序 |
| 手动升级 | [update-light.png](update-light.png) | [update-dark.png](update-dark.png) | 从 `0.1.1-preview.21` 到 `0.1.2-preview.22`，显示正在更新 |
| 自动重新打开 | [reopened-light.png](reopened-light.png) | [reopened-dark.png](reopened-dark.png) | 更新后的实际程序窗口 |
| 卸载确认 | [uninstall-confirm-light.png](uninstall-confirm-light.png) | [uninstall-confirm-dark.png](uninstall-confirm-dark.png) | 显示实际合成数据目录，明确不会删除数据 |
| 卸载进度 | [uninstall-light.png](uninstall-light.png) | [uninstall-dark.png](uninstall-dark.png) | 删除程序、快捷方式与安装登记，保留数据 |
| 合成执行段失败 | [failure-light.png](failure-light.png) | [failure-dark.png](failure-dark.png) | 实际安装器中止后显示排查说明，确认后返回失败码 2，不停在隐藏的完成页 |

`interactive-results.json` 保存版本、两种主题、自动打开、运行中重试、数据保留与卸载的结果。合成 `keep-me.txt` 在升级后逐字一致，卸载后仍存在；正常程序启动会更新自己的日志和配置，因此不把整个数据目录称为零字节变化。测试结束再删除经过标记核验的合成目录、测试配置与安装器缓存。

复验命令：

```powershell
# 重活须先按 parallel-rules.md 占一个名额。
node scripts/nightly/installed-smoke.mjs --test-identity inst1qa --out .local/inst-1-smoke
node scripts/nightly/installed-smoke.mjs --test-identity inst1qa --install --out .local/inst-1-smoke-installed --installer <经过发布检查的测试安装包>
# 本包的相邻合成版本，私钥完成即删除；不发布版本或标签。
node tests/inst-1-upgrade-build.mjs .local/inst-1-first 0.1.1-preview.21 <固定运行时构建目录>
node tests/inst-1-upgrade-build.mjs .local/inst-1-upgrade 0.1.2-preview.22 <固定运行时构建目录>
powershell.exe -NoProfile -NonInteractive -File tests/inst-1-interactive.ps1 -Installer <0.1.1测试安装包> -UpgradeInstaller <0.1.2测试安装包>
```

图标使用既有同一母版的品牌图形：安装器、程序 EXE（可执行文件）、卸载登记与快捷方式使用同一份九尺寸 ICO（Windows 图标文件），程序窗口与任务栏保留既有系统浅深色变体。尺寸为 16、20、24、32、40、48、64、128、256；新增绘制层明确加载 64 像素图形，避免将最小图标放大。测试验证每个图形载荷完整。后台桌面没有 Explorer（文件管理器）的任务栏，没有接管本人任务栏取图；安装登记、快捷方式名称与 ICO 资源检查用于这一项。

本地结果见 [验证汇总](validation-results.json)，视觉范围与处置见 [独立审查](review.md)。相同程序载荷下，原样安装器为 184,455,855 字节（175.91 MiB，二进制兆字节），品牌安装器为 184,603,821 字节（176.05 MiB），增加 147,966 字节（144.5 KiB，二进制千字节），约 0.0802%。未增加安装框架或另一个网页运行时。原始窗口见 [raw](raw/)，与几何记录成对保留。云端结果与合主线后的复验在本包 result（结果文件）及 PR（拉取请求）中记录。

# WeftMate 安装窗口验收

本目录记录 INST-1 与追加的自绘标题栏、单页安装位置。全部使用 `inst1qa` 测试身份、合成数据和独立后台桌面，通过 PrintWindow（按窗口句柄取图）捕获实际 NSIS（Windows 安装引擎）窗口。没有切换本人桌面、发送全局鼠标键盘、访问本人安装／数据或请求18186。截图未遮盖、拼接或替换；`raw/` 保留完整原图，JSON（结构化记录）保存窗口几何。

窗口与默认／自定义手动流程在主线 `1491fe5a` 上采集；之后合入 `1ddae8b3` 的 AUTH-1（登录与启动门）改动，安装器绘制、目录校验与 NSIS 源码没有变化。合后重新构建测试身份，默认与实装冒烟各7场景通过，边界检查0命中；程序打开的照片保留原采集版本，不冒充新登录界面的截图。最新主线与同载荷体积复验见 `validation-results.json` 的 `postAuthMerge`。

首次安装显示位置、更改和安装按钮；默认位置点一次安装即可。顶部可拖动，只有自绘关闭按钮，没有系统标题栏或最大化。安装与卸载过程中关闭禁用；覆盖升级沿用已有登记的位置，直接显示正在更新。数据不跟随安装位置变化，卸载明确保留数据，继续调用 `--uninstall-cleanup`。未知发布者与 SmartScreen（系统下载信誉保护）仍由 Windows 显示。

| 过程 | 浅色截图 | 深色截图 |
|---|---|---|
| 默认位置准备安装 | [default-ready-light.png](default-ready-light.png) | [default-ready-dark.png](default-ready-dark.png) |
| 默认位置安装进度 | [default-install-light.png](default-install-light.png) | [default-install-dark.png](default-install-dark.png) |
| 默认位置自动打开 | [default-opened-light.png](default-opened-light.png) | [default-opened-dark.png](default-opened-dark.png) |
| 默认位置运行中重试 | [default-running-retry-light.png](default-running-retry-light.png) | [default-running-retry-dark.png](default-running-retry-dark.png) |
| 默认位置覆盖升级 | [default-update-light.png](default-update-light.png) | [default-update-dark.png](default-update-dark.png) |
| 默认位置自动重开 | [default-reopened-light.png](default-reopened-light.png) | [default-reopened-dark.png](default-reopened-dark.png) |
| 默认位置卸载确认 | [default-uninstall-confirm-light.png](default-uninstall-confirm-light.png) | [default-uninstall-confirm-dark.png](default-uninstall-confirm-dark.png) |
| 默认位置卸载进度 | [default-uninstall-light.png](default-uninstall-light.png) | [default-uninstall-dark.png](default-uninstall-dark.png) |
| 自定义位置准备安装 | [custom-ready-light.png](custom-ready-light.png) | [custom-ready-dark.png](custom-ready-dark.png) |
| 自定义位置安装进度 | [custom-install-light.png](custom-install-light.png) | [custom-install-dark.png](custom-install-dark.png) |
| 自定义位置自动打开 | [custom-opened-light.png](custom-opened-light.png) | [custom-opened-dark.png](custom-opened-dark.png) |
| 自定义位置运行中重试 | [custom-running-retry-light.png](custom-running-retry-light.png) | [custom-running-retry-dark.png](custom-running-retry-dark.png) |
| 自定义位置覆盖升级 | [custom-update-light.png](custom-update-light.png) | [custom-update-dark.png](custom-update-dark.png) |
| 自定义位置自动重开 | [custom-reopened-light.png](custom-reopened-light.png) | [custom-reopened-dark.png](custom-reopened-dark.png) |
| 自定义位置卸载确认 | [custom-uninstall-confirm-light.png](custom-uninstall-confirm-light.png) | [custom-uninstall-confirm-dark.png](custom-uninstall-confirm-dark.png) |
| 自定义位置卸载进度 | [custom-uninstall-light.png](custom-uninstall-light.png) | [custom-uninstall-dark.png](custom-uninstall-dark.png) |
| 选好自定义位置 | [custom-location-light.png](custom-location-light.png) | [custom-location-dark.png](custom-location-dark.png) |
| 不可写位置留在原页 | [unwritable-light.png](unwritable-light.png) | [unwritable-dark.png](unwritable-dark.png) |
| 合成执行段失败 | [failure-light.png](failure-light.png) | [failure-dark.png](failure-dark.png) |
| 125% 原生窗口布局 | [ready-dpi-120-light.png](ready-dpi-120-light.png) | [ready-dpi-120-dark.png](ready-dpi-120-dark.png) |
| 150% 原生窗口布局 | [ready-dpi-144-light.png](ready-dpi-144-light.png) | [ready-dpi-144-dark.png](ready-dpi-144-dark.png) |
| 200% 原生窗口布局 | [ready-dpi-192-light.png](ready-dpi-192-light.png) | [ready-dpi-192-dark.png](ready-dpi-192-dark.png) |

`interactive-position-default-results.json` 与 `interactive-position-custom-results.json` 记录实际安装、版本、自动打开／重开、未传 `/D` 的覆盖升级、图标哈希、开始菜单目标、开机项与卸载后的移除，以及合成数据保留。自定义目录含中文和空格；拒绝写入由合成目录的实际 ACL（访问权限）产生，不是伪造错误文案。路径选择替身只替换系统选择器的返回值，以便自动重试不可写和可写目录；目录解析与写入／空间校验均走真实代码。

`silent-directory-results.json` 单独记录 `/S /currentuser /D=<路径>` 的真实安装与卸载，目标同样含中文和空格。按 NSIS 标准，`/D` 位于最后且不额外包引号；核对卸载登记、开始菜单目标、程序文件移除及合成数据保留。

`frame-results.json` 另记录真实系统文件夹选择器的打开和确认、已有空 WeftMate 目录不重复嵌套、窗口样式、标题区域拖动命中、Tab（焦点切换）顺序及 Esc（退出键）取消。系统选择器保持 Windows 自己的界面；公开截图的测试入口把导航限制在合成目录，并隐藏真实固定位置，不修改系统设置。浅深主题以系统实际设置为准。安装器测试主题只影响自身窗口。

本机实际窗口 DPI（像素密度）为144。120／144／192渲染密度通过测试包专属入口指定，因此照片是实际原生窗口的125%／150%／200%布局，而非缩放图片；记录同时保留实际144 DPI。没有改变本人系统缩放，不能把这称为真实跨显示器 `WM_DPICHANGED` 验收。字体与布局按新密度重建的代码已复审；真实跨显示器移动、Windows 10、英文长文案及人工读屏未实测。

自定义位置的开机项核对实际 HKCU（当前用户注册表）命令，并在后台桌面重放该命令，检查合成数据目录中的真实宿主启动记录。更新测试调用既有 `prepareAppRollback`，由真实监护进程执行哈希核验、静默安装、重新启动与健康确认。迁移测试运行原样的 `migrate-installed-desktop.ps1`，每步都传自定义 `-InstalledExe`；只有计划任务操作替换为合成响应，不创建或操作本人任务，安装器／程序启动／随机端口验证／清理均实际执行。监护首次正常退出的关闭检测返回 SYSTEM_QUERY_FAILED，全部旧进程消失后重跑未经修改的快照监护才达到健康；新程序窗口起初隐藏，仅在隔离桌面显现。浅色再覆盖同一V2，深色由V1手动覆盖到V2。含空格路径的应用自启开关查询回报关闭，实际登记命令重放启动成功。这些是现有应用边界，不改启动／更新应用文件。详情与限制见验证汇总。

图标沿用同一九尺寸 ICO（Windows 图标文件）：16、20、24、32、40、48、64、128、256。绘制层加载256像素图形，控件按当前密度绘制。后台桌面没有 Explorer（文件管理器）的任务栏，因此用实际登记、快捷方式、图标哈希和窗口标题检查名称／图标，没有接管本人任务栏取图。

复验命令：

```powershell
# Electron（桌面程序框架）、完整单测和打包按 parallel-rules.md 占名额。
node tests/inst-1-upgrade-build.mjs <新输出目录> 0.1.1-preview.21 <已验证暂存目录>
node tests/inst-1-upgrade-build.mjs <另一新输出目录> 0.1.2-preview.22 <已验证暂存目录>
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tests/inst-1-frame.ps1 -Installer <0.1.1测试安装包>
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tests/inst-1b-interactive.ps1 -Mode default -Installer <0.1.1测试安装包> -UpgradeInstaller <0.1.2测试安装包>
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tests/inst-1b-interactive.ps1 -Mode custom -Watchdog -Installer <0.1.1测试安装包> -UpgradeInstaller <0.1.2测试安装包>
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tests/inst-1-directory.ps1
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tests/inst-1-silent-directory.ps1 -Installer <测试安装包>
node scripts/nightly/installed-smoke.mjs --test-identity inst1qa --out .local/inst-1b-smoke
node scripts/nightly/installed-smoke.mjs --test-identity inst1qa --install --installer <测试安装包> --out .local/inst-1b-smoke-installed
```

成功后卸载测试身份，核对数据标记与配置归属再删除合成根、测试配置及更新缓存。原版 NSIS 目录搬移有 MAX_PATH（传统路径长度）限制，合成 TEMP（临时目录）使用短的 `wi1-…` 根；位置页也提供过长路径的解释。没有修改文件处理引擎或绕过失败检查。完整结果见 [验证汇总](validation-results.json) 与 [独立审查](review.md)，云端检查与收尾见 PR（拉取请求）#226 及调度方结果文件。

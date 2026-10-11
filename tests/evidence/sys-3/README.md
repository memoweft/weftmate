# Windows 系统集成验收

使用 `sys3qa` 测试身份的真实安装版 Electron（桌面程序框架），合成账号、临时目录和随机端口。真实模型请求 0。资源管理器登记通过读取注册表并调用登记的启动命令验证；通知通过真实 `Notification` 对象的测试钩子触发动作，没有模拟系统鼠标或键盘。

`results.json` 中的 10 项检查全部通过：当前实例接收文件并保留文字、文件夹进入新项目对话、单文件／多文件／文件夹冷启动、设置开关、通知允许／拒绝／高风险查看。直接允许与拒绝时窗口保持隐藏，回执确认后产生结果通知；查看打开原审批并显示操作详情。卸载后右键登记与开机项均已清除，测试助手报告残留进程 0。

| 场景 | 浅色 | 深色 |
|---|---|---|
| 单文件与原输入文字 | `received-single-file-light.png` | `received-single-file-dark.png` |
| 多文件附件 | `received-multiple-files-light.png` | `received-multiple-files-dark.png` |
| 文件夹与新对话 | `received-folder-light.png` | `received-folder-dark.png` |
| 常规设置中的右键开关 | `settings-context-menu-light.png` | `settings-context-menu-dark.png` |
| 480px 窄窗设置 | `settings-context-menu-480-light.png` | `settings-context-menu-480-dark.png` |
| 高风险通知打开原审批 | `notification-high-risk-conversation-light.png` | `notification-high-risk-conversation-dark.png` |

当前 `nativeCapture` 仍是未取得原生横幅：系统接口收到显示回调，但截图接口没有找到对应可见区域。上表最后一行是程序内审批截图，不能当作 Windows 原生通知横幅截图。未改变本人系统主题、通知设置或锁屏设置。

复现入口：

```powershell
node scripts/nightly/installed-smoke.mjs --test-identity sys3qa --out .local/sys-3-smoke
node scripts/nightly/installed-smoke.mjs --test-identity sys3qa --out .local/sys-3-smoke-installed --install
node tests/integration/sys-3-windows.mjs --installer <sys3qa 安装包路径>
node --test tests/windows-system-integration.test.ts
```

文件进入当前输入中的对话，保留已有草稿；文件夹沿已有只读默认值登记，并新开项目对话。特殊目录沿已有的具体确认，普通目录不加介绍或导览。附件数量和大小沿现有机制。

Windows 11 的新式菜单另需 `IExplorerCommand`（资源管理器命令接口）与带身份的扩展，见 [Microsoft 的文件资源管理器集成说明](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/integrate-packaged-app-with-file-explorer)。预估拆成原生扩展和带身份安装／升级／卸载两个工作包，共约 2–3 个工作日，另留签名与真机验证时间。本包登记项在“显示更多选项”中。

# FIX-7：Windows 标题栏下方的浮层可用区域

生产 `src/main.mjs` 由 Playwright（界面自动化工具）`_electron.launch` 启动，使用系统临时隔离目录、随机端口和合成测试账号。截图通过 Electron（桌面程序框架）`desktopCapturer` 获取操作系统窗口，包含系统绘制的右上角最小化、最大化和关闭按钮。

`before-*` 使用 FIX-6 已合入的提交 `2a6aa9f7ad9fa02d77883940a32eb7083fae8641` 中三个界面资产；`after-*` 使用本包代码。设置、删除、遗忘均通过实际可见控件打开。记忆接口使用合成数据，此处验证布局，不宣称真实记忆形成或删除。

| 场景 | 浅色改前 → 改后 | 深色改前 → 改后 |
|---|---|---|
| 1200×800 设置 | [改前](before-light-wide-settings.png) → [改后](after-light-wide-settings.png) | [改前](before-dark-wide-settings.png) → [改后](after-dark-wide-settings.png) |
| 1200×800 删除确认 | [改前](before-light-wide-delete.png) → [改后](after-light-wide-delete.png) | [改前](before-dark-wide-delete.png) → [改后](after-dark-wide-delete.png) |
| 1200×800 遗忘确认 | [改前](before-light-wide-forget.png) → [改后](after-light-wide-forget.png) | [改前](before-dark-wide-forget.png) → [改后](after-dark-wide-forget.png) |
| 480×520 设置 | [改前](before-light-narrow-settings.png) → [改后](after-light-narrow-settings.png) | [改前](before-dark-narrow-settings.png) → [改后](after-dark-narrow-settings.png) |
| 480×520 删除确认 | [改前](before-light-narrow-delete.png) → [改后](after-light-narrow-delete.png) | [改前](before-dark-narrow-delete.png) → [改后](after-dark-narrow-delete.png) |
| 480×520 遗忘确认 | [改前](before-light-narrow-forget.png) → [改后](after-light-narrow-forget.png) | [改前](before-dark-narrow-forget.png) → [改后](after-dark-narrow-forget.png) |

[verification.json](verification.json) 记录每张图对应的实际元素尺寸、标题栏下沿、窗口尺寸及设计间距。改后断言顶部至少留出一份间距、底部与左右不越界，并相对于标题栏下方区域垂直居中。设置宽窗口四边 32px、窄窗口四边 12px；普通对话框至少 16px。横向使用包含块百分比，避免纵向滚动条挤占窗口宽度时左右留白不足。

Windows 专用选择器使用 `data-native-platform="win32"`；标题栏高度来自 `env(titlebar-area-height)`，回退到现有 44px 设计令牌，与主进程 `titleBarOverlay.height` 一致。共享锚定菜单读取同一标题栏的实际下沿。macOS 与网页检查在此 Windows Electron 内切换平台标记，断言设置边界与改前完全一致；未运行 macOS 原生程序。

验证命令：

```powershell
node tests/integration/fix-7-titlebar-inset.mjs
node tests/integration/fix-6-titlebar.mjs
node --test tests/personal-desktop-ui.test.ts tests/personal-access-ui-interaction.test.ts tests/personal-desktop-motion.test.ts tests/personal-desktop-ipc.test.ts tests/personal-access-memory-ui.test.ts tests/settings-registry.test.ts
node --test tests/personal-popovers.test.ts tests/mobile-ui-core-assets.test.ts
npm run typecheck
```

相关回归 82/82 通过；FIX-6 标题栏遮罩、主题恢复和原生通知回归通过。完整测试交本包 PR（拉取请求）的 CI（持续集成）。本包不改客户端接口，未重新制作安装包。

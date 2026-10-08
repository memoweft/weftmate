# FIX-5 弹出菜单完整留在窗口内

桌面使用 Playwright（界面自动化工具）启动真正的 WeftMate Electron（桌面程序框架）入口 `.`，随机端口、系统临时标记目录、合成账户与既有合成会话服务。手机使用 Chromium（浏览器引擎）390×844 网页与合成组件投影。没有调用模型、使用日用账户或读取凭据。MuMu 上已有其他测试包，本轮没有安装或操作模拟器应用。

改前静态资产取自 `2f1d60bc113c828bfc5019c939be96326fb62989`，改后为本分支代码。保留本人反馈之外的实际仓库基线：该基线模型菜单已有局部水平修正，但仍按右边对齐计算，各类菜单没有共用视口定位。截图均为合成内容，未将本人反馈图加入公开仓库。

## 定位与覆盖

`src/personal-access-ui/popovers.js` 是桌面与手机唯一的定位实现，手机文件由既有构建脚本生成。模型优先左对齐、向上展开，其他菜单按触发按钮指定方向；空间不足则翻转方向或对齐边，最后夹到可视区域内，保留8px边距。宽度收缩、最大高度按可用空间限制，内部可滚动。使用 top layer（顶层渲染层）避免父容器裁切，不移动按钮的 DOM（文档对象模型）归属。窗口缩放、滚动、内容大小与 visual viewport（可视视口）变化会重新定位。

插话 / 新任务保留原 `select` 的选择值、可访问名称和 `change`（变更）契约，指针和键盘展开时显示共用定位菜单，选中后仍走现有发送逻辑。会话“更多”沿用原生 `dialog`（对话框）及焦点机制，补充宽高限制。桌面附件直接打开系统文件选择器，无网页菜单；手机附件菜单纳入测量。手机成果与图片预览仍是规范要求的全屏页，不按锚点菜单处理。

| 菜单 | 1200×800 | 720×600 | 390×844 |
|---|---|---|---|
| 模型 | [改前](before-1200x800-model.png) / [改后](after-1200x800-model.png) | [改前](before-720x600-model.png) / [改后](after-720x600-model.png) | [改前](before-390x844-model.png) / [改后](after-390x844-model.png) |
| 审批模式 | [改前](before-1200x800-approval.png) / [改后](after-1200x800-approval.png) | [改前](before-720x600-approval.png) / [改后](after-720x600-approval.png) | [改前](before-390x844-approval.png) / [改后](after-390x844-approval.png) |
| 插话 / 新任务 | [改后](after-1200x800-message-mode.png) | [改后](after-720x600-message-mode.png) | [改后](after-390x844-message-mode.png) |
| 账户 | [改前](before-1200x800-account.png) / [改后](after-1200x800-account.png) | [改前](before-720x600-account.png) / [改后](after-720x600-account.png) | 手机沿用导航抽屉 |
| 会话更多 | [改前](before-1200x800-session.png) / [改后](after-1200x800-session.png) | [改前](before-720x600-session.png) / [改后](after-720x600-session.png) | [改前](before-390x844-session.png) / [改后](after-390x844-session.png) |
| 输出与来源 | [改前](before-1200x800-resources.png) / [改后](after-1200x800-resources.png) | [改前](before-720x600-resources.png) / [改后](after-720x600-resources.png) | 手机为全屏来源页 |
| 面板再打开一项 | [改前](before-1200x800-panel-menu.png) / [改后](after-1200x800-panel-menu.png) | [改前](before-720x600-panel-menu.png) / [改后](after-720x600-panel-menu.png) | 同全屏来源页 |
| 附件 | 系统文件选择器 | 系统文件选择器 | [改前](before-390x844-attachment.png) / [改后](after-390x844-attachment.png) |

原生窗口最小尺寸仅在测试进程中解除，以实际720×600内容视口验收；不改变生产窗口配置。[verification.json](verification.json)记录实际视口、每个菜单的 `getBoundingClientRect`（元素边界矩形）、滚动高度及前后共41次测量。改后所有菜单断言四边距≥8px；额外验证40项长模型列表、打开后缩至460×400 / 280×300、靠右上角触发时水平对齐翻转与向下展开。桌面两种尺寸共用同一460×400缩放截图文件。

## 验证

```powershell
# 真正的桌面程序与手机网页，生成前后截图与测量记录
node tests/integration/fix-5-popovers.mjs
# CI（持续集成）使用隔离 Electron 窗口验证相同行为，不依赖额外浏览器下载
node --test tests/personal-popovers.test.ts
node --test tests/personal-access-ui-interaction.test.ts tests/personal-access-ui.test.ts tests/personal-desktop-ui.test.ts
node tests/integration/desktop-ui-interactions.mjs
node --test apps/mobile-ui/tests/chat-interactions.test.mjs apps/mobile-ui/tests/approval-interactions.test.mjs tests/mobile-ui-core-assets.test.ts
npm run typecheck
```

相关桌面测试64/64、手机交互及生成资产101/101、共享核心39/39、新边界回归1/1通过。现有桌面语义交互覆盖浅色 / 深色、发送 / 排队、审批 / 提问、成果与来源、停止与快捷键。界面检测只报告手机既有步骤线样式，不属于本包改动。手机原生 WebView（网页容器）与真实系统键盘本轮未重新验收；完整测试由PR（合并请求）CI执行。

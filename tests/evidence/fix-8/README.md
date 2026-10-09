# FIX-8 · 日用界面回归

改前基线为 `f787c3c`；改后为本分支。本人提供的截图已逐张查看，没有复制进仓库。此目录仅包含临时目录、随机回环端口、合成账号与合成消息。

桌面由 Playwright（界面自动化工具）`_electron.launch` 启动生产 `main.mjs`，截图通过 Electron（桌面程序框架）`desktopCapturer` 捕获实际原生窗口，包含 Windows（视窗系统）标题栏和窗口按钮。界面请求连接隔离的真实个人宿主服务，DSH（助手运行时）事件由合成后端提供。手机网页视口为 390×844；另检查手机界面包的全局复制提示。

旧本地账号先在未配置云的宿主中建立对话，再关闭该隔离宿主并以同一目录开启云身份能力。合成云服务使用临时 RSA（非对称签名算法）密钥及签名令牌，走真实 `/cloud/claims`、`/cloud/binding` 校验与绑定；随后通过桌面的「离线使用这台电脑」以原账号密码登录。`before.json` / `checks.json` 均验证 ownerId（账号标识）、deviceId（设备标识）保留及绑定状态为 active（有效）。没有访问正式云账号、本人日用宿主或 18186 端口。

## 根因与修复

1. 新草稿入口只清除桌面会话 ID（标识），没有重置 `activeChatSource`、手机选择、输入区样式和历史分页。旧手机绑定响应还会重新绘制旧来源。现在新草稿完整切回桌面来源、保留原来源草稿、清除选择及分页，并关闭旧预览；绑定响应只在请求发起时的同一会话选择仍有效时自动切换。
2. 会话列表刷新会更新侧栏标题，却没有更新已选会话的主区标题。首条发送后侧栏出现新标题，主区仍显示「新对话」。现在刷新同时重绘当前桌面对话标题。
3. 创建会话的成功回执先于原 POST（提交请求）的 pending（待处理）快照到达时，首条消息可能留在「发送中」。现在保存较新的创建回执、沿用原请求编号，成功后继续发送首条；旧草稿的创建回执不会选中新开的另一份草稿。
4. 停止提示固定写「排队任务会继续执行」，且所有普通 toast（短暂提示）以主题正文色作底、固定白字，深色反而变成浅底白字。桌面与远程网页改为主题表面色搭配正文色，放在页面上方、原生标题栏下方；手机界面包普通提示同样配对主题色，原错误提示的深红底白字保持。停止读取当前对话实际队列：零条「已停止」，两条「已停止当前回复，还有 2 条排队消息会继续」。取消或结束的条目不计入。
5. 无会话的新草稿隐藏「本对话用量」；历史按钮仅在当前会话有真实更早内容和有效分页游标时显示。

## 图像与断言

32 张 PNG（图片文件），浅深各一套：改前 12 张、改后 20 张。代表性对照：

| 场景 | 改前 | 改后 |
|---|---|---|
| 手机来源切新草稿 | [深色](before-desktop-dark-new-from-phone.png) | [深色](after-desktop-dark-new-from-phone.png) |
| 首条后侧栏 / 主区标题 | [深色](before-desktop-dark-first-title.png) | [深色](after-desktop-dark-first-message.png) |
| 桌面无排队停止 | [深色](before-desktop-dark-stop.png) | [深色](after-desktop-dark-stop.png) |
| 桌面有两条排队 | — | [深色](after-desktop-dark-stop-queued.png) |
| 390×844 网页停止 | [深色](before-phone-web-dark-stop.png) | [深色](after-phone-web-dark-stop.png)、[两条排队](after-phone-web-dark-stop-queued.png) |
| 手机界面包复制提示 | [深色](before-mobile-ui-dark-copy-toast.png) | [深色](after-mobile-ui-dark-copy-toast.png) |
| 键盘新草稿与历史读完 | — | [新草稿](after-desktop-dark-keyboard-new.png)、[历史](after-desktop-dark-switch-history.png) |

`checks.json` 检查按钮和 Ctrl+N（新对话快捷键）、手机来源切新草稿、普通桌面新草稿、首条发送、切换会话、补读历史、用量入口、零 / 两条排队停止、手机界面包复制提示。操作按可见名称 / 角色；分页按钮用 Enter（回车）激活，避免滚动到顶部时既有自动补读先隐藏按钮。界面检查主题计算色、文字对比度及提示与输入框不相交。改前深色桌面提示对比度约 1.22:1；改后浅色约 13.14:1，深色约 10.72:1。手机界面包深色普通提示从约 1.27:1 提升至 11.83:1。完整实测值见 JSON（结构化数据文件）。

改前标题场景让已受理的创建回执在原响应中返回，以单独观察侧栏 / 主区标题不同步；创建回执与旧 pending 快照的竞态另由定向单测固定覆盖。改后不修改回执时序。

## 验证与重跑

```powershell
node tests/integration/fix-8-daily-ui.mjs --before
node tests/integration/fix-8-daily-ui.mjs
node --test tests/ui-core.test.ts tests/personal-access-ui-interaction.test.ts tests/mobile-ui-core-assets.test.ts
npm run typecheck
```

最终定向功能 / 语义交互 / 生成资产 112/112；新增 FIX-8 回归 5/5。既有桌面综合交互、动效、菜单和云账号回归通过；手机聊天 / 审批 / 排队 / 动效 98/98。桌面菜单另沿用原脚本的 MiMo（云模型）回归，7 次请求；本目录截图与停止 / 队列场景均不调用付费模型。完整测试交 PR（拉取请求）的 CI（持续集成）。

没有修改模型设置页、宿主模型路由或 `/personal/v1` 契约；没有发布安装包、更新日用程序或操作本人数据。

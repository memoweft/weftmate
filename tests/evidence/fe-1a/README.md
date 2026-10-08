# FE-1a 桌面分层验收

在真实 WeftMate 程序中，改前基线 `fc156ee85bb62d37c91818402aea91848186ee35` 与本包走同一组流程。`_electron.launch` 启动仓库的 `.`，使用新建的带标记隔离目录；请求转发到隔离的真实个人入口服务，后端读取合成 DSH（模型执行框架）日志。正常登录、CSRF（跨站请求伪造保护）、会话、审批、提问和来源接口均沿用既有契约。没有模型推理请求，也没有日用运行数据。

| 截图 | 流程 | 改前 / 改后差异 |
|---|---|---|
| `login` | 账户登录页 | 0像素 |
| `running-approval-question` | 运行中、三种审批按钮、提问 | 0像素 |
| `sent` | 运行中插话发送与回显 | 0像素 |
| `steps` | 步骤展开与按需读取原文 | 0像素 |
| `sources` | 输出与来源、来源使用摘要 | 0像素 |
| `memory` | 回复记忆标签与来源读取 | 0像素 |
| `completed` | 回合完成、步骤收起、发送状态 | 0像素 |
| `artifact` | 成果右侧预览 | 0像素 |
| `appearance` | 外观设置切换深色 | 0像素 |

每对图像都是1200×800，完整RGBA（红绿蓝与透明度通道）逐像素比较；没有裁剪、遮罩或忽略区域。合成记录时间和界面实时秒数采用相同固定时钟；拍摄前移开鼠标、等待已登录提示结束，并等待完成状态恢复为「发送」。机器可读结果见 `screenshot-comparison.json`。

真实程序额外处理「总是允许此类」和「拒绝」，核对实际接口回执及本对话类别范围；新目标排队、按钮停止和 Esc（退出键）停止也验证了请求与草稿保留。结果见 `before-verification.json`、`after-verification.json`。

`relocated-verification.json` 记录同组真实程序交互：测试拦截 `layout.js` 响应，在组装后把「输出与来源」按钮放到侧栏，按可见名称与角色找控件的流程继续通过。产品文件始终保留原布局。

## 复现

依照 `docs/SETUP.md` 准备 Windows（视窗系统）、Node（脚本运行环境）、Electron（桌面程序框架）与固定 DSH 依赖，然后运行：

```powershell
node tests/integration/fe-1a-ui-layers.mjs --before
node tests/integration/fe-1a-ui-layers.mjs
node tests/integration/fe-1a-ui-layers.mjs --relocated
python tests/integration/fe-1a-compare-screenshots.py
```

`--before` 通过 `git show` 读取记录的基线 HTML（网页结构标记）与原来的入口 / 呈现代码，拦截静态响应，不改工作树。比较脚本使用本机已有的 Pillow（图像处理库）；没有新增应用依赖。`--verify-only` 验证交互并关闭截图写入。

本包相关测试共82项：共享纯逻辑15、桌面领域交互59、静态资产2、记忆3、便携 Electron 呈现与交互3。便携套件在 CI（持续集成）使用隔离的最小 Electron 夹具；上面的截图与换位验收使用真实程序。Windows 夹具采用旧套件的显式退出方式，避免窗口清理延迟影响交互用例；模型、样式令牌和业务接口均保持原样。

手机共享功能层接线、Android（安卓）资产生成与手机设备验收由 FE-1b 完成。本包的记忆标签来源使用合成投影与合成来源，M2d 的记忆形成 / 纠正继续由独立工作包验证。完整测试结果以 PR（拉取请求）当前提交的检查为准。

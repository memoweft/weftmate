# UI-1b 输出与来源面板验收

使用 Playwright（自动化测试工具）`_electron.launch` 启动仓库的真实 `src/main.mjs`、固定 DSH（执行框架）运行时与独立个人宿主。账号、会话、模型服务、文本文件均为合成数据；数据目录在系统临时目录，每次新建，文件写在测试会话自己的工作目录。没有访问日用数据或付费模型，也没有修改开机设置。

程序截图经 Electron（桌面程序框架）`desktopCapturer` 按真实窗口句柄获取，包含原生标题栏与系统按钮。公开截图只包含合成账号、消息和匿名临时路径。浏览器使用已安装的 Edge（微软浏览器），访问同一个隔离宿主并通过普通账号表单登录，未注入原生桥。

| 场景 | 浅色程序 | 深色程序 |
|---|---|---|
| 标题栏浮层、输出与来源分组 | [浮层](light-list.png) | [浮层](dark-list.png) |
| 两个独立标签、来源使用摘要及调用内容 | [标签](light-tabs.png) | [标签](dark-tabs.png) |
| 全部资源列表、拖宽后的布局 | [全部](light-all.png) | [全部](dark-all.png) |
| 已处理提问一行记录 | — | [提问](dark-question.png) |

远程浏览器截图：[深色对话与下载入口](browser-dark.png)。全部机器断言见 [verification.json](verification.json)。

验证覆盖：打开浮层 → 成果预览 → “+”打开工具来源 → 查看使用摘要与具体内容 → 关闭一个标签 → “+”重新打开 → 真实鼠标拖宽 → 放大 / 还原 → 整体收起并恢复原标签 → 查看全部。程序与浏览器均跑浅色 / 深色；成果卡及“查看来源与成果”均打开面板标签。程序实际调用系统 `shell.openPath`、`shell.showItemInFolder`，并读取导出文件确认字节；浏览器只出现下载按钮，实际下载并核对字节。新对话显示空状态，不保留其他会话标签；真实审批 / 提问处理后只显示一行记录。

复现完整 Windows（视窗系统）程序验收：

```powershell
node tests/integration/desktop-ui-1b.mjs
# 只验证，不改写截图：
node tests/integration/desktop-ui-1b.mjs --verify-only
```

需要项目已有依赖、固定 DSH vendor（运行时生成依赖）和已安装 Edge。缺少依赖时复用主仓同版本生成依赖即可，无需重建环境。

相关自动检查通过：`npm run typecheck`；`tests/personal-access-ui-interaction.test.ts` 59 项、`tests/personal-desktop-ipc.test.ts` 8 项、`tests/personal-conversation-resources.test.ts` 3 项、`tests/personal-desktop-ui.test.ts` 3 项，共 **73 项**。最后一组使用隔离宿主与合成原生日志，另验证步骤文件链接打开来源标签、来源摘要 / 原始内容、标签关闭及新增。完整测试交 GitHub CI（持续集成），沿用既有例外清单。

未做项：记忆自动注入当前没有公开的逐条引用记录，因此未展示虚构记忆条目，也未新增引用存储或修改 M1-1c 的执行 / 工具接缝；需要记忆工作包补真实来源字段。任意二进制成果仍受现有 UTF-8（文本编码）成果契约限制；安装包、真实模型办事、长时间浸泡与其他原生平台不在本包。

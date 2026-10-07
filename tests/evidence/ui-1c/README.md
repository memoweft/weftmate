# UI-1c 程序验收

使用 Playwright `_electron.launch`（Electron 自动化启动）运行 `src/main.mjs` 的真实 WeftMate 程序、固定 DSH（工具执行运行时）、隔离账号和本机合成模型。所有文件写入独立系统临时目录；截图用程序窗口捕获，包含原生标题栏。连接器的两次调用和失败响应由合成来源模拟，无外部服务账号或付费请求。

复现命令（Windows，依赖与固定 vendor 已就绪）：

```powershell
node tests/integration/desktop-ui-1c.mjs
node --test tests/personal-conversation-resources.test.ts tests/personal-timeline-native.test.ts tests/personal-desktop-ui.test.ts
npm run typecheck
```

| 场景 | 断言与证据 |
|---|---|
| 输出去重 | `approval.txt` 和 `w1-result.txt` 各重复写出，浮层各一项；点开均预览最新字节。见 [浅色列表](light-list.png) / [深色列表](dark-list.png) |
| 来源先给人话 | 脚本来源默认一行「运行脚本：写入 approval.txt · 时间」，没有原始详情；`write` 来源显示三次调用，每次一行文件描述。见 [浅色摘要](light-summary.png) / [深色摘要](dark-summary.png)、[浅色多次调用](light-calls.png) / [深色多次调用](dark-calls.png) |
| 原始内容 | 再展开才读取参数和输出；等宽字体、可收起、复制到真实 Windows 剪贴板，内容一致（系统换行规范化）。见 [浅色详情](light-detail.png) / [深色详情](dark-detail.png) |
| 连接器 | 两次可读调用摘要；键盘 Enter 展开，第一次读取失败，收起再展开成功；只留一份详情并显示截断提示。见 [连接器](dark-connector.png) |
| 侧栏 | 「新对话」与收起按钮中心线一致、互不重叠，顶部没有空标题行；收起 / 重新展开有效。浅深截图均覆盖 |
| 会话隔离 | 新对话无旧输出或标签，显示输出空态 |

本包只修来源详情、输出列表与程序侧栏顶部。输入区、审批卡、记忆引用、手机端及原生 Apple 客户端未改；完整单测交 PR CI（持续集成）。现有成果契约只提供规范化 `fileName`，因此列表按同会话文件名选最新导出，历史成果仍保留原 ID 访问。

机器可读结果见 [verification.json](verification.json)。截图与结果只含合成数据。

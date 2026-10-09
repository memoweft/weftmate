# UI-P4 · 输入区与对话滚动

所有截图、账号、文件、消息和模型均为合成测试数据；本人参考图只在本机打开查看，没有复制进仓库或证据。未操作日用数据、模型密钥、LAN（局域网）服务或其他工作树。

## 发送时间与根因

在 `_electron.launch` 启动的生产 `createPersonalDesktop` 窗口中，用发送事件和 MutationObserver（页面变化观察器）测量到用户气泡 DOM（页面元素）出现的时间。改前合成宿主立即接收，但输入区等待命令回执、任务刷新，气泡等约 3 秒的下一次历史轮询。模型排队、记忆召回和模型生成不是这组延迟的原因。改后在任何网络等待之前插入「发送中」气泡，确认后按 receiptId（宿主接收编号）合并真实记录。

| 表面 / 主题 | 改前 | 改后 |
|---|---|---|
| desktop / light | 3179.4 ms | 5.3 ms |
| mobile-web / light | 本轮桌面基线见上；手机改前截图保留 | 3.0 ms |
| mobile / light | 本轮桌面基线见上；手机改前截图保留 | 14.1 ms |
| desktop / dark | 3157.9 ms | 4.1 ms |
| mobile-web / dark | 本轮桌面基线见上；手机改前截图保留 | 3.4 ms |
| mobile / dark | 本轮桌面基线见上；手机改前截图保留 | 23.9 ms |

数字是发送事件至 DOM 插入的测量，不包含操作系统输入分发与显示器刷新。另一个完整运行时验收启动真实 `main.mjs`、固定 DSH（助手运行时）与临时账号，使用随机端口上的合成 SSE（服务器发送事件）模型：

- 新对话首条 light：3.6 ms；真实宿主当前占用 713,111 / 828,000。
- 新对话首条 dark：2.3 ms；真实宿主当前占用 713,111 / 828,000。
- 共 4 次合成模型请求、74 个实际流式片段；没有付费模型请求，页面错误为零。

## 六条反馈的改前 / 改后

每个场景有浅 / 深色与桌面、390×844 远程网页、390×844 手机界面包。以下是浅色桌面入口；同前缀的 `desktop-dark`、`mobile-web-light/dark`、`mobile-light/dark` 为对应组合。

| 反馈 | 改前 | 改后 |
|---|---|---|
| 1. 即时发送 | [发送后尚无气泡](before-desktop-light-01-sending.png) | [发送中气泡](after-desktop-light-01-sending.png)、[失败与草稿](after-desktop-light-01-failed-draft-retained.png)、[同编号重试后只一条消息](after-desktop-light-01-retry-confirmed.png) |
| 2. 滚动 | [长回复](before-desktop-light-02-bottom.png)、[阅读历史](before-desktop-light-02-history.png) | [保持底部](after-desktop-light-02-bottom.png)、[有新内容且不拉走](after-desktop-light-02-history.png)、[返回底部](after-desktop-light-02-returned-bottom.png)、[展开进展](after-desktop-light-02-progress-expanded.png)、[实际延迟图片加载](after-desktop-light-02-image-loaded.png) |
| 3. 同一发送 / 停止按钮 | [独立停止](before-desktop-light-03-stop.png)、[运行中草稿](before-desktop-light-03-running-draft.png) | [停止回复](after-desktop-light-03-stop.png)、[运行中有文字变发送](after-desktop-light-03-running-draft.png)、[空闲发送](after-desktop-light-03-idle.png) |
| 4. 输入区顺序 | [原布局](before-desktop-light-04-layout.png) | [审批盾牌 / 上下文 / 模型 / 语音 / 主操作](after-desktop-light-04-layout.png) |
| 5. 真实上下文占用 | [原输入区](before-desktop-light-05-context.png) | [86% 提示](after-desktop-light-05-context-tooltip.png)、[已用但未知上限](after-desktop-light-05-unknown-limit.png)、[完整运行时宿主数据](runtime-light-02-real-context.png) |
| 6. 窄屏与手机 | [480px桌面](before-desktop-light-06-narrow.png)、[手机](before-mobile-light-06-narrow.png) | [480px桌面](after-desktop-light-06-narrow.png)、[手机](after-mobile-light-06-narrow.png)、[手机点按上下文](after-mobile-light-05-context-tooltip.png) |

## 行为断言与回归

`checks.json` 记录三个表面、两个主题的即时发送、贴底 gap（底部间距）≤2px、上翻位置不变、有新内容按钮、返回底部、进展展开 / 收起、真实图片 load（加载）事件、无横向溢出、按宿主回执只保留一条消息、失败草稿保留和同 requestId（幂等请求编号）重试。阈值为约48px；在历史里展开进展不触发跟随。未知上限不显示百分比，圆环不定；警示阈值80%。审批模式菜单、UI-P3审批条与真实等待阶段保留。参考图片没有进入任何产物。

- `node tests/integration/ui-p4-composer.mjs`：生产 Electron 窗口 + 两种手机网页表面浅深合成流，全部断言通过。
- `node tests/integration/ui-p4-runtime.mjs`：真实 main.mjs + 固定 DSH + 合成流式模型，首条消息和原生当前上下文投影通过。
- `tests/ui-core.test.ts`、`tests/personal-access-ui-interaction.test.ts`、`tests/p1-03-dsh-adapter.test.ts`、`tests/design-tokens.test.ts`、`tests/mobile-ui-core-assets.test.ts`、手机 `chat-interactions.test.mjs`：定向回归通过。
- 现有桌面语义交互（浅深 / 按钮停止 / Esc）、手机审批 / 队列 / 外观 / 动效四组通过。共用下拉改用 combobox（组合框）/ listbox（列表框）/ option（选项）断言；新的停止名为「停止回复」。
- `npm run typecheck`、`node scripts/generate-tokens.mjs --check`、ui-core（共享界面核心）生成资产检查通过。完整测试由 PR 的 CI（持续集成）运行。

开发验收暴露并修复了三项实际边界：404查询证明连接恢复后仍保留离线状态导致重试无法发出；旧 pending（待处理）POST快照覆盖后来的真实确认；展开进展的浏览器焦点滚动被误判为阅读历史。手机测试桥补齐已有的请求查询路由和网络错误回调，以验证同一条原请求。动效采样先完成首次渐进参数读取，避免异步替换节点使动画目标失效；减少动态效果和长列表断言保留。

## 契约与范围

`GET /personal/v1/sessions` 添加可选只读 `contextUsage:{usedTokens,contextWindow}`，来自 DSH 原生 contextPressure（当前上下文压力）投影：当前 projectedTokens（随有效上下文增减的占用），缺失时 pressureTokens（最近实际请求占用）；原生上限缺失为null，整个占用未知时省略字段。不用累计计费 tokens（令牌数），也不伪造上限。CLIENT_API 3.1 和 STATE「契约变更」已登记。Android（安卓）现有会话透传保留该字段，没有新增原生桥接或权限。

PF-1b提示词组装未改；Apple（苹果）原生界面接线、安装包 / 界面更新包发布与本人日用升级不在本包范围。文档范围外仅因客户端契约规则补齐 `docs/CLIENT_API.md`。全部新增图片是合成场景实际截图。

# 共享前端功能层

FE-1a 把桌面原 `app.js` 中的数据、请求、恢复和动作移到这里。这里是桌面与 FE-1b 手机 Web（网页界面）的唯一功能实现来源。使用原生 JavaScript（脚本语言），没有新增运行时依赖或框架。

## 分层规则

- 新功能、数据校验、身份与请求恢复、分页、增量和步骤合并写在 `src/ui-core/`。功能代码接收普通数据并调用动作；不接触 DOM（文档对象模型）、控件、焦点、滚动位置或 Electron（桌面程序框架）。
- 新界面与事件绑定写在 `src/personal-access-ui/components/`。组件从功能层读取数据，收集输入并调用动作；组件管理绘制、菜单、面板、表单输入、焦点与滚动。接口路径和写请求集中在功能层，组件使用命名动作和功能层提供的资源地址。
- 页面容器、组件摆放、动态面板与来源列表的挂载位置只在 `src/personal-access-ui/layout.js` 组装。`components/markup.js` 保存各组件的静态模板；`index.html` 只加载资产。移动「输出与来源」等控件时，保留控件名称和组件标识，只调整组装文件。
- 样式继续使用 `design/tokens/` 生成的值。桌面功能测试按可见名称 / 角色定位并断言行为；顺序相关断言验证事件时间线语义。组件内部 DOM 单测只验证投影、身份隔离、草稿和焦点恢复，不作为页面布局契约。

`desktop.js` 管理桌面的呈现能力（Markdown、侧栏交互、右侧面板和快捷键）；`timeline.js` 只协调时间线呈现，执行步骤和成果卡分别在 `components/steps.js` 与 `components/artifacts.js`。审批、提问、会话、输入区、记忆、设置及账户各有组件文件。共享投影、资源引用解析、可发送 / 停止状态和外观持久化都在功能层。

## 初始化与接口

`manifest.mjs` 是功能层资产清单与加载顺序，先加载 `store.js`，再按清单加载各领域注册文件。每次 `create()` 都创建独立的账户状态和缓存；不会共享某一桌面窗口的会话状态。

```js
const core = globalThis.WeftUiCore.create({
  fetch: (url, options) => fetch(url, options),
  storage: localStorage,
  crypto: globalThis.crypto,
  effects: presentation,
})
```

`fetch` 是注入的传输函数，返回具有 `ok`、`status`、`json()` 的响应；附件上传沿用 Blob（文件数据）请求体，`loadAttachmentHasher()` 由入口提供既有文件哈希模块。函数调用时应保留原网络实现需要的接收者，桌面入口用箭头函数调用浏览器 `fetch`。`storage` 提供同步 `getItem/setItem/removeItem`；`crypto` 提供 `randomUUID()`。连接宿主、CSRF（跨站请求伪造保护）和 `/personal/v1` 请求都在这里实现，不增加新的服务端业务接口。

`effects`（界面回调）是由每端提供的命名呈现接口：例如 `paintIdentity(payload)`、`paintHistoryMessages(events)`、`renderConversationApprovals()`、`renderConversationQuestions()`、`paintSystem(system, settings, catalog, token)`、`paintMemoryReceipt(message, requestId, action)`、`updateAvailability()`、`paintScreen(view)`、`toast(message)`。它们接收数据 / 状态或返回输入值，不向功能层传入 DOM 节点。`readMessageDraft()`、`memoryCommandText()`、`memoryFilterInput()` 返回普通输入值；旧流程的焦点、滚动锚点和原生面板全部保留在组件里。

桌面在 `app.js` 创建功能实例、装入组件、挂接各组件事件，最后启动账户与宿主读取。组件工厂只声明函数，挂接方法才产生界面副作用，功能与呈现可以先分别实例化再连起来。

| 领域 | 主要读取 / 动作 |
|---|---|
| 登录与连接 | `state.account/device/online/capabilities`；`load()`、`loginAccount(input)`、`setupAccount(input)`、`acceptSession(payload)`、`clearSession()`、`refreshStatus()` |
| 会话与历史 | `state.sessions/historyEvents/afterSeq/nextBeforeSeq/hasOlder`；`selectSession(id)`、`refreshHistory(reset)`、`loadOlderHistory()`、`appendHistory(events)`、`projectTimeline(events)`、`turnStatusViewModel()` |
| 发送、停止、插话、排队 | `composerState(text)`；`sendDraft(text)`、`stopCurrentTurn()`、`setMessageMode(mode)`、`composerInputMode(sessionId)`；手机来源的同一发送恢复流程在 `phone.js` |
| 审批与模式 | `conversationApprovals`、`approvalModes`；`refreshConversationApprovals()`、`submitApproval(context, row, outcome, scope)`、`refreshApprovalMode(id)`、`saveApprovalMode(mode)`、`saveDefaultApprovalMode(mode)` |
| 提问 | `conversationQuestions`；`questionDraft(context, row)`、`chooseQuestionOption(...)`、`setQuestionCustom(...)`、`submitQuestion(context, row)`；保留原问题顺序和完整选项文字 |
| 成果与来源 | `loadConversationResources()`、`readTimelineDetail(sessionId, seq)`、`readResource(path)`、`resourceReferences(text)`；资源页游标与调用去重、最新成果和捕获来源优先在功能层处理 |
| 记忆与标签 | `memory`；`readMemorySources(kind, id)`、`openMemory()`、`loadMemoryPage()`、`openMemoryDetail(kind, id)`、`submitMemoryAction()`、`recoverMemoryReceipt()`、`retryMemoryCleanup()`；保留账户身份、修订和迟到响应检查 |
| 设置 | `appearance.value/set(value)`、`refreshSystem()`、`restartService(key)`、`saveBackgroundModel(id)`、`saveAccountModelDraft(input)`；资料、项目和网页任务表单亦使用功能层动作 |

`state` 与各领域缓存用于读取当前快照和范围信息；新交互修改功能状态时应调用领域动作。账户编辑的呈现状态仍与原有视图生命周期对接，组件不可把元素位置、父节点或 CSS（层叠样式表）状态当作功能请求条件。普通字段输入与头像预览由组件收集，校验、提交、回执核对与身份检查由共享动作处理。

## FE-1b 接入

下一包在手机现有构建 / 发布流程中导入 `uiCoreAssets`，把清单文件从本目录拷入 `apps/mobile-ui/www/ui-core/` 和 Android（安卓）打包资产；不要在手机 `app.js` 复制逻辑。加载顺序与桌面一致，在手机入口创建独立实例，并提供手机组件的 `effects`。构建副本是生成资产，母版始终是此目录。

手机壳现有原生桥接负责传输与登录凭据，桥接适配器把既有响应映射为同一账户 / 宿主 / `/personal/v1` 数据形状。屏幕、抽屉、原生权限提示和图片选择由手机组件 / 壳管理；功能层不导入 Electron 或 Android。手机接入、生成资产、原生桥适配与手机设备验收由 FE-1b 完成。

## 验证

- `node --test tests/ui-core.test.ts`：没有浏览器或 DOM 的纯逻辑测试。
- `node --test tests/personal-access-ui-interaction.test.ts tests/personal-access-ui.test.ts tests/personal-access-memory-ui.test.ts tests/personal-desktop-ui.test.ts`：领域回归及按名称 / 角色定位的可移位交互。
- Windows（视窗系统）真实程序：`node tests/integration/fe-1a-ui-layers.mjs`。脚本通过 Playwright（界面自动化工具）`_electron.launch` 启动 `.`，使用隔离目录、真实个人入口服务和合成日志；截图位于 `tests/evidence/fe-1a/`。
- `node tests/integration/fe-1a-ui-layers.mjs --relocated`：只在测试响应中改 `layout.js`，把输出按钮移到侧栏；同一组名称 / 角色定位的流程继续通过。产品组装不被修改。
- `python tests/integration/fe-1a-compare-screenshots.py`：与记录的改前截图逐像素比较。

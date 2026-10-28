# 工作区界面

`layout.js` 组装左侧导航、中间对话和右侧面板；`components/` 绑定现有动作。`desktop.js` 管标签、侧栏与键盘，`workspace.css` 管三块布局和输入区外层，`design/tokens/tokens.json` 是颜色、字体、尺寸、圆角与动效的唯一来源。消息、步骤、提问、审批内容仍由各自组件呈现。

桌面对话统一由 `components/main-chat.js` 按可视区和相邻一屏挂载消息；同一帧的历史、审批和输入区更新合成一次呈现。折叠的过程先画摘要，展开再建步骤。切换只保留最近八段对话的尺寸、展开状态和阅读锚点，原文仍重新读取，身份变化即清空这些位置。输入框尺寸跟随内容与宽度变化，隐藏的建议栏不测布局。回归与同条件帧采样见 `tests/integration/perf-switch.mjs`。

## 面板

`index.html` 在 `desktop.js` 后加载 `panels/<kind>.js`。每个脚本调用：

```js
WeftPanels.register('terminal', {
  title: '终端', icon: 'tool',
  create(ctx) {
    // Create one tab's view and owned resources.
    return { el, show() {}, hide() {}, update(ctx) {}, dispose() {} };
  },
});
```

六个 `kind` 为 `review`、`terminal`、`browser`、`files`、`chat`、`subtasks`。空面板入口与加号菜单从同一登记生成；标题和图标由内容适配器提供，自有图标名见 `design/icons/`。内容只创建自己的根节点 `el`，不另建右侧容器。

`ctx` 字段：

| 字段 | 含义 |
|---|---|
| `conversationId` | 当前逻辑对话 ID；旧会话使用 session ID，新草稿使用 `draft:<id>`，手机记录使用 `phone:<id>` |
| `sessionId` | 当前执行会话，未创建时为空；不要把它当作永久逻辑对话 ID |
| `mode` | `chat` 或 `work` |
| `computerId` | 当前执行电脑 |
| `workDir` | 经原生桥读取的当前项目完整目录；未选项目或远程不可读取时为 `null`，异步读到后再次调用 `update` |
| `projectId` | 当前项目登记 ID；无项目时为 `null` |
| `ownerId`、`identityGeneration` | 账号及身份代次；切账号时容器释放全部标签 |
| `tabId` | 本标签稳定的键；同一资源再开时复用这个键 |

`WeftPanels.open(kind, trigger?, { key?, title? }?)` 打开或激活标签；默认每种内容一个标签，需要多个实例的适配器可传稳定的资源键。`show(trigger?)` / `hide()` 展开和收起，`close(key)` 永久关闭指定标签，`reset()` 释放全部。`entries` 返回登记清单，`context` 返回当前上下文副本。旧资源入口 `WeftDesktop.openPreview()` 沿用同一容器；这些快照标签切对话即移除，避免旧内容泄漏。

切标签和收起调用 `hide()`，DOM（文档节点）、滚动和输入保留；显示调用 `show()`。关闭标签调用 `dispose()`，只释放该标签拥有的资源；最后一个关闭回到入口页。切对话调用 `update(ctx)`，内容适配器必须递增自己的请求代次，丢弃旧请求结果；`hide` 不取消任务。身份重置会销毁标签，重开再创建。

审查与文件调用 `WeftPanels.services.workspaceRequest(ctx, action, body)`，通过当前 `computerId` 的既有通道访问 `/workspaces/:sessionId/review/*` 和 `/workspaces/:sessionId/files/*`。宿主按执行会话绑定的项目授权解析相对路径；`workDir` 只作异步补齐的目录信息，从 `null` 更新为真实路径时保留选择与编辑稿。尚未创建执行会话的工作草稿显示下一步提示，不把逻辑对话 ID 当作 `sessionId` 请求。

文件成果/来源仍通过无参数的 `WeftPanels.services.resources()` 读取，并用 `previewResource(item, content)` 在同一文件面板复用 `components/resources.js` 的预览；`openResource(item, trigger)` 保留原资源入口。子任务订阅 `composer-subtasks.js` 的 `weftmate:subtasks` 事件与快照，状态来自 `ui-core/subtasks.js`，点击回到原步骤。后续面板替换对应登记脚本即可。

过程文件卡的“审阅”从该次工具记录读取改动前后内容，保留历史已应用的改动证据；右侧“审查”入口读取当前工作目录的实时 Git 差异。文件面板默认展开本对话的成果与来源，已有报告可直接打开。

浏览器由 `panels/browser.js` 登记，桌面通过预加载桥使用宿主 `personal-browser/desktop.mjs` 的真实 `WebContentsView`，Agent 的 `browser` 工具使用同一对话实例。`workDir` 异步补齐、执行段变化均复用原逻辑对话标签；切换上下文使旧命令响应失效。切账号仍由容器 `dispose()` 全部标签。手机和远程网页显示在电脑打开的说明。真实入口验收见 `tests/integration/desktop-browser-panel.mjs`。

终端使用 `panels/terminal.js` 和现有宿主登录通道。`workDir` 为 `null` 时仍由宿主按对话的项目登记解析真实目录，异步目录更新不会重开已运行的 shell；草稿与手机原话未绑定电脑执行会话时显示说明。面板以 `ownerId`、`identityGeneration`、逻辑对话和稳定 `tabId` 隔离状态，旧结果只归属原视图。创建响应交付一个仅能关闭该终端的随机凭据，保存在实例内存中；切账号或关标签用它调用同源 `/terminals/:id/release`，不依赖新账号的 Cookie（登录会话），不授予输入或读取能力。`dispose()` 等待在途创建交付后再释放；请求断开而响应尚未交付时，宿主直接收回终端。

## 尺寸与键盘

默认界面字号为 14，显式保存的字号继续沿用。侧栏为 256px，品牌与搜索、动态通知在同一区域；导航行 38px，项目与最近对话同时显示并可分别折叠，最近对话右侧菜单保留类型筛选。新对话的模式选择在输入区，触屏网页则保留在欢迎语下方。

Windows 的中间页头、右侧标签和原生窗口按钮共用顶部一行，左侧保留拖动与收栏区域；系统更新提示位于账号入口上方。原生按钮颜色跟随主内容与当前弹层。输入区最大外宽 790px、左右内边距 28px，工作电脑/目录/权限收在输入框内一行。右侧入口图标 20px、字号 14、每行内边距 14×16px、行间距 10px；这些都是外壳尺寸，不改变消息和面板内容。

宽窗口为三列；1100px 以下只保留最后明确打开的左侧或右侧，右侧保持至少 420px 中间阅读空间。720px 以下面板为全屏子页，收起回到对话。放大占用正文区域，拖宽受中间最小宽度限制。

快捷键在 `src/ui-core/shortcuts.js`：`Ctrl/⌘ Alt P` 开合右侧，`Ctrl/⌘ Alt 1–6` 打开六项。标签支持左右、Home/End、Delete，拖宽分隔条支持左右、Home/End；Esc 优先关闭浮层或收起面板。收起恢复外部触发点，不停止后台任务。

## 项目与验证

项目置顶是当前账号在本设备的侧栏偏好；归档使用原会话归档接口，可在设置恢复。更改文件夹位置通过系统选择器与原生桥，对原 `/projects/:id` 执行 `PATCH`；宿主验证原生身份、目录、修订号与运行状态。只更改登记，文件不会搬动。公开网页响应仍不暴露完整路径。

面板真实操作检查为 `tests/integration/ui-01-shell.mjs`，通过 `tests/ui-01-shell.test.ts` 纳入测试。使用独立 Electron 身份、临时资料与随机服务端口。生成手机副本运行 `node apps/mobile-ui/src/build-ui-core.mjs`；令牌运行 `node scripts/generate-tokens.mjs`。截图和包清单留在外部证据目录。

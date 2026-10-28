# 工作区界面

`layout.js` 组装左侧导航、中间对话和右侧面板；`components/` 绑定现有动作。`desktop.js` 管标签、侧栏与键盘，`workspace.css` 管三块布局和输入区外层，`design/tokens/tokens.json` 是颜色、字体、尺寸、圆角与动效的唯一来源。消息、步骤、提问、审批内容仍由各自组件呈现。

桌面对话统一由 `components/main-chat.js` 按可视区和相邻一屏挂载消息；同一帧的历史、审批和输入区更新合成一次呈现。折叠的过程先画摘要，展开再建步骤。切换只保留最近八段对话的尺寸、展开状态和阅读锚点，原文仍重新读取，身份变化即清空这些位置。输入框尺寸跟随内容与宽度变化，隐藏的建议栏不测布局。回归与同条件帧采样见 `tests/integration/perf-switch.mjs`。

流式正文持续使用原生变化等待；不支持等待的通道按 16ms 读取，呈现由 `ui-core/reply-motion.js` 按动画帧合并、小步追加，以完整字素为边界，暂存尾部约 32ms 来合并跨包的 emoji 与组合字符。普通长列表只解析当前条目，已完成条目和选区保持原节点。每帧文字写入和虚拟行调整后同步跟随，消息外边距与空过程行的实测零高度都计入虚拟列表；往上翻后保持阅读锚点。回归见 `tests/integration/perf-stream.mjs`。

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

设置沿用 `ui-core/settings-registry.js` 的 21 类，搜索按关键字定位行，分类保留已挂载控件并按身份代次重载。页面加载失败在当前分类重试；模型偏好独立于系统诊断读取。设备偏好使用原 `createAppearance`，保存失败恢复原值；动态效果沿用 `WeftReplyMotion`。字号在失焦时取整并限制到 10–24，空值恢复默认。

能力页复用连接器配置、模型目录与当前执行会话的 DSH 工具、技能、命令清单。工具描述来自 DSH 的 `systemPrompt.assemble({scope:agent}).tools`，不返回工具参数 schema。搜索、筛选和标签切换保留浏览状态；工具规则和凭据仍走原接口。审查面板读取外观的 `diffMarkers: color | sign`，监听 `weftmate:appearance` 原地更新标记。

设备页通过 `/devices/sync` 读取当前账户的同步摘要，只含条数、接收时间、整理状态及副本提供时间。收到原话和完成记忆整理分别显示，副本时间明确标注“电脑已提供”，未知历史不计作零；配对沿用已有核对数字弹窗。验证入口为 `tests/integration/ui-03-settings.mjs`，截图留在外部证据目录。

自有功能继续从侧栏的记忆、动态、健康、目标、成果库，以及账号菜单里的数据、帮助和设置到达原业务。目标页以“进行中 / 提醒与定时任务 / 长期目标”切换，分类保留已挂载内容，搜索只筛选当前已读取的数据。电脑从现有 `/commands` 的分页记录补齐任务的手机离线来源，按身份缓存来源信息，进度与取消仍使用 `/tasks` 和原停止接口；不新增离线任务接收或调度能力。

记忆页和设备页显示遗忘清理状态。`/devices/sync` 的可选 `sync.cleanup` 只含 `state: waiting_device | acknowledged` 和 `requestedAt`；宿主发出新副本后仍等待，直到设备在后续同步中带回当前副本代次。该状态与电脑本地的记忆删除、存储清理回执分别显示。未知、读取失败与已确认分开，失败可检查状态重试。真实 Electron 验证入口为 `tests/integration/ui-08-own-features.mjs`。

项目置顶是当前账号在本设备的侧栏偏好；归档使用原会话归档接口，可在设置恢复。更改文件夹位置通过系统选择器与原生桥，对原 `/projects/:id` 执行 `PATCH`；宿主验证原生身份、目录、修订号与运行状态。只更改登记，文件不会搬动。公开网页响应仍不暴露完整路径。

面板真实操作检查为 `tests/integration/ui-01-shell.mjs`，通过 `tests/ui-01-shell.test.ts` 纳入测试。使用独立 Electron 身份、临时资料与随机服务端口。生成手机副本运行 `node apps/mobile-ui/src/build-ui-core.mjs`；令牌运行 `node scripts/generate-tokens.mjs`。截图和包清单留在外部证据目录。

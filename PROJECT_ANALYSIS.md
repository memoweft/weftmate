# WeftMate 项目全景分析与交接上下文

> 生成时间：2026-07-14 16:41（Asia/Shanghai）
> 分析基线：本地仓库 `main`，`HEAD = 894026e`，工作树在生成本报告前干净
> 用途：把本文件直接交给新的 ChatGPT / Codex，使其快速建立对产品、代码、历程、真实进度、风险和下一步的完整认识
> 性质：这是一次“代码事实快照”，不是持续更新的当前任务板
> 2026-07-15 补充：owner 已通过“项目方向定位问题”对话重新拍板产品边界；结论已写入 `docs/PRODUCT.md`，少量大阶段已写入 `docs/ROADMAP.md`，当前执行状态以 `CURRENT.md` 为准。本报告正文仍保留 2026-07-14 / `894026e` 的审计结论，不把历史快照伪装成实时状态。

---

## 0. 给下一位 ChatGPT 的最短开工指令

接手时按这个顺序读：

1. `AGENTS.md`：红线和工作纪律。
2. 本文件：当前代码事实、进度和风险全景。
3. `CURRENT.md`：唯一“现在做到哪里、下一步做什么”看板。
4. `docs/ROADMAP.md`：五个大阶段、模块范围和退出标准。
5. 本报告其余章节：2026-07-14 的代码事实、历史、风险和完整交接证据。
6. 最后以源码、测试和 Git 历史核实，不要把规划文案当成已经实现。

必须遵守：

- 不修改 MemoWeft 库源码。WeftMate 只把它当依赖，并只经 `src/memoweft.ts` 这一层接入。
- 守 MemoWeft 的 naming 口径：不吹“真正理解你”；记忆不等于相信；用户侧不显示 0–1000 原始把握度；慢活诚实说需要时间；MemoWeft 能力层文案不用“她”；第一人称人格只属于星瑶/Aria 等体验层。
- 工具定义延迟加载；主动打断只报 P0/P1；observed 默认不上云；API key 不得明文落盘。
- 改完至少跑 `npm run typecheck`、`npm test`，并验证 Electron 能启动。
- 当前有一个最高优先级的可复现安装问题：`memoweft` 被改成了本地文件依赖。不要在没处理它前宣称 CI 或干净克隆可用，详见第 11 节。

---

## 1. 一句话结论

WeftMate 已经是一个“本机开发环境中功能相当完整、但还不能独立交付”的 Electron 桌面 AI 伴侣：阶段 1 的桌面产品骨架和记忆三件套已基本成形，阶段 2 的感知、统一 Agent、MCP、工作区与多模态附件也已经真实接线；M0–M2 的大部分工程安全工作和 M3 的应用内双语已经落地。但它仍是开发态内部 Alpha：没有可安装包、签名、自动更新或 Release；公开 GitHub 仓库不存在；当前本地 `memoweft@0.5.1` 文件链接让干净克隆的 typecheck/测试直接失败；营销站仍只有中文；历史搜索/重命名/恢复与跨设备接力尚未完成。

最准确的状态不是 `CURRENT.md` 顶部写的“下一块=历史接力”，而是：

- 产品内核：阶段 1 基本完成，阶段 2 前四块完成，历史接力只完成了多会话/软归档/工作区分组等地基。
- 发布路线：M0–M2 大体完成但有验收回退/漏项；M3 应用内 i18n 与英文人格完成，I2 双语站点/文档未完成；M4–M5 尚未开始。
- 当前真正的 P0：先恢复可复现依赖与干净 CI，再决定完成 M3 后进 M4，还是把历史接力提前。

---

## 2. 产品是什么，三层如何分工

### 2.1 三层不能混

| 层 | 名称 | 当前职责 |
|---|---|---|
| 产品层 | WeftMate | 这个仓库；Electron 桌面常驻 App、UI、会话、Agent、MCP、感知、配置、隐私和交付 |
| 人格/体验层 | 星瑶、Aria、普通助手 | 系统提示、语气和身份；切换人格不切换底层记忆 |
| 能力层 | MemoWeft | 独立依赖；负责证据、经历、认知、召回、画像更新、图谱、导入导出等长期记忆能力 |

产品名是 **WeftMate**，星瑶只是内置人格之一。MemoWeft 不是产品 UI，也不应被人格化。

### 2.2 核心价值循环

产品希望形成：

`相处（聊天/干活） → 感知（用户在忙什么） → MemoWeft 整理为事实与推测 → 画像更丰富 → 回答和执行更贴合用户 → 继续相处`

当前这个循环已经真实连通到如下程度：

- 普通聊天或 Agent 任务前会召回相关记忆。
- 普通消息会作为用户证据写入；真正使用工具的任务会把“任务 + 完成摘要”写回。
- 后台调度器按批量/空闲节奏调用 `core.updateProfile()`。
- 新认知会在聊天流中织成记忆气泡，画像和来源可见、可失效、可删除。
- 桌面活动可选择性采集为 observed 证据。
- 还没有“主动关怀/克制通知”这一环，也没有手机/穿戴数据源。

### 2.3 产品的三样独有肌肉

1. **记忆与画像可视**：事实/推测、来源、有效把握度、图谱与溯源可看。
2. **记忆气泡，管理即对话**：新理解在对话现场出现，可标不再有效或删除。
3. **人格是可切换能力包**：目前完成的是系统提示/语气与同记忆切换；形象、声音、默认模型仍未形成完整能力包。

---

## 3. 项目演进过程与关键决策

本地仓库共有 37 个提交，开发集中在 2026-07-07 至 2026-07-14。

### 3.1 2026-07-07：S0/S1 与阶段 1

- S0：验证 Electron 43 / Node 24 的 `node:sqlite` 可用，不需要 `better-sqlite3`。
- S1：Electron 主进程直接导入 `.ts`，启动 loopback server 和 MemoWeft core，再由 BrowserWindow 加载 `127.0.0.1` 页面。
- 完成托盘常驻、单实例锁、关窗收托盘、退出收尾、自绘标题栏。
- 模型配置改为多档，并用 Electron `safeStorage` 加密密钥；切换模型时进程内热重建 core。
- 完成 Claude Desktop 风格对话壳、暗/亮主题、Markdown/代码块安全渲染、响应式布局。
- 完成画像来源分组、记忆气泡、星瑶/普通助手人格切换。

### 3.2 2026-07-07 至 07-09：阶段 2 前四块

- 感知：活动窗口采集、空闲跳过、换窗去重、observed 默认不上云、语言设置、反编造人格护栏。
- Agent：Host 自建文字 JSON 工具协议、三档自主度、工作区路径沙箱、审批、步骤可视、快照撤回。
- MCP：官方 SDK、stdio 服务、服务管理、工具命名空间、延迟加载、默认逐工具审批与显式信任。
- 附件：文本/代码按需读取；后来扩展到图片 vision content parts、拖拽、粘贴、会话资源落盘。

### 3.3 2026-07-13：从功能开发转向发布安全网

- 引入 `tsconfig`、`npm run typecheck`、正式 `tests/` 和三平台 GitHub Actions 配置。
- 新增 `src/memoweft.ts` adapter，把 MemoWeft 直接 import 收拢到一个文件。
- 加 LICENSE、README、落地页、dogfood runner/协议。
- 修 MCP 自报只读绕审批、symlink/junction 沙箱逃逸、命令超时孤儿进程、第三方服务安装警示和逐工具信任。
- 当天曾把 MemoWeft 精确固定为 `0.5.0`。

### 3.4 2026-07-14：M2 收口、M3 i18n 与统一协作路径

- M2：Agent 完成摘要回写、附件截断明示、二进制安全撤回、感知跨重启去重、崩溃日志、无 keyring 警示、隐私文档、Issue 模板。
- M3：新增英文人格 Aria；应用 UI 加中英字典和 MutationObserver 动态翻译。
- i18n 曾引发两个真机严重问题：观察器自触发导致卡死，以及元素级 `textContent` 翻译摧毁 DOM 导致按钮全死；都已在后续提交修复。
- 最新大提交把统一 Agent 变成默认聊天路径，加入最近会话上下文、人格、会话工作区、图片历史资源，并修复“模型普通说人话却被误报 JSON 格式错误”。
- 该提交同时把 `memoweft` 从精确 npm 版本回改为 `file:../memoweft`，造成干净克隆回归，这是当前最重要的工程问题。

---

## 4. 当前技术架构

### 4.1 总体数据流

```text
Electron main（src/main.mjs）
  ├─ 设置 userData / PORT / 默认人格 / MemoWeft 语言
  ├─ safeStorage 解密当前模型配置并注入 env
  ├─ import src/server.ts
  │    ├─ createMemoWeftCore（只经 src/memoweft.ts）
  │    ├─ node:http loopback 127.0.0.1:7788
  │    ├─ 会话/记忆/Agent/MCP/设置 API
  │    └─ serve src/web/index.html
  ├─ BrowserWindow 加载 loopback 页面
  ├─ Tray / 单实例 / 窗口 IPC
  └─ 可选启动活动窗口 collector
```

### 4.2 为什么仍用 loopback 而不是 Electron IPC

这是早期已拍板的 D6：复用原 Host 前端几乎不改，先以 `node:http` 同源 API 跑通。优点是简单、网页层可复用；代价是本机无鉴权 HTTP 面、需要额外考虑 Origin/CSRF，见风险节。

### 4.3 MemoWeft 边界

所有 MemoWeft 依赖只从 `src/memoweft.ts` re-export：

- 值：`createMemoWeftCore`、`config`、`OpenAICompatClient`、`loadLLMConfig`
- 类型：`MemoryBundle`、`Observation`、`ChatMessage`、`MemoWeftPlugin`

上层不直接摸 MemoWeft store；记忆管理走 `core.memory.*`，图谱走 `core.graph.*`，导入导出走 `core.portable.*`。这个边界是当前架构中最干净、最应该保留的部分。

### 4.4 默认聊天已经是统一 Agent

这是理解当前代码的关键：

- 前端 `AG.mode` 固定为 `true`，所以发送按钮默认走 `/api/agent/start`。
- `/api/chat` 仍存在，但当前 UI 正常路径基本不会调用它，属于兼容/旧链路。
- 统一 Agent 可自然聊天，也可按需调用工具；首轮模型直接返回自然语言时被当成合法普通回答。
- 没调用工具：走 `recordChat`，只把用户原话作为证据写入 MemoWeft。
- 调用了工具：走 `record`，写入“让 WeftMate 帮我干活的任务 + 最终摘要”。
- 两类都会把用户/助手消息写入 Host 会话历史，并触发后台画像整理。

---

## 5. 数据落盘与隐私语义

默认都在 Electron `<userData>`：

| 数据 | 路径/形式 | 保护与语义 |
|---|---|---|
| MemoWeft 记忆/画像 | `weftmate.db` | SQLite，本地；由 MemoWeft 管理 |
| 对话历史 | `sessions/<conversationId>.jsonl` | Host 自管；一行一条消息/元数据 |
| 归档会话 | `*.jsonl.archived` | 软归档，不删除 |
| 会话图片 | `sessions/assets/<conversationId>/img-<uuid>.<ext>` | 与 JSONL 引用分开；检查 MIME 签名、大小、路径和符号链接 |
| 模型配置 | `weftmate-model.enc` | 整份 safeStorage 加密；公开 API 只返回 `hasKey` |
| MCP 配置/env | `weftmate-mcp.enc` | 整份 safeStorage 加密；前端只见 env key 名 |
| 非机密设置 | `weftmate-settings.json` | 明文；语言、感知、MCP 工具信任 |
| 崩溃日志 | `weftmate-crash.log` | 本地滚动到约 1 MB；不自动上传 |

重要语义：

- 感知默认关闭；observed 在 server 清洗时会剥掉插件带来的授权位。
- 只有用户显式开启 `cloudAllowed` 后，新摄入的 observed 才会被加 `allowCloudRead=true`。
- 工作区文件、命令输出、附件、绝对工作区路径会被送到用户配置的模型端点；这是用户主动发起 Agent 任务后的数据外发面。
- “清空全部记忆”只清 MemoWeft 三层记忆、审计和索引，并把会话软归档；不会删除会话 JSONL、图片、模型/MCP 配置、设置或崩溃日志。它不是完整的“删除全部本地数据/恢复出厂”。

---

## 6. 源码地图

仓库当前 45 个 tracked files。核心规模：`src/` 约 10,613 行；测试约 1,345 行。最大文件是 `src/web/index.html`（6,956 行、约 432 KB），其次是 `src/server.ts`（1,142 行）与 `src/agent.ts`（782 行）。

### 6.1 运行时核心

- `src/main.mjs`
  - Electron 生命周期、托盘、单实例、无边框窗口、IPC、崩溃日志。
  - 启动时注入模型 env 和语言，再导入 server。
  - 当前用固定 800ms 等 server，再开窗口；不是基于 listen ready 事件。

- `src/preload.cjs`
  - 只暴露最小窗口控制：minimize、toggleMaximize、close、最大化状态监听。
  - `contextIsolation: true`，没有把 Node 或完整 ipcRenderer 暴露给页面。

- `src/server.ts`
  - 整个 Host 编排中心：loopback、core、会话、记忆 API、配置、设置、Agent、MCP、导入导出。
  - 持有当前会话、已激活会话、切人格后会话等进程内状态。
  - 功能集中但已经过大，是后续拆分的主要技术债。

- `src/memoweft.ts`
  - 唯一 MemoWeft adapter；升级内核的爆炸半径收拢点，也为未来非 Electron 运行时留接缝。

### 6.2 会话与记忆编排

- `src/chatHistory.ts`
  - JSONL 会话、软归档、工作区元数据、图片资源保存/读取。
  - 损坏行跳过、UTF-8 明确、conversationId/assetId 校验。
  - 当前没有会话标题字段、重命名、全文索引、归档列表/恢复 API。

- `src/scheduler.ts`
  - 画像更新调度：达到 batchSize 立即整理，否则空闲 idleMinutes 后整理。
  - 单飞锁避免同一用户并发 consolidate；前台“立即整理”共用同一锁。
  - 向前端提供 `newCognitions`，用于记忆气泡。

- `src/confBand.ts`
  - 用衰减后的 `effectiveConfidence` 映射定性档位；冲突优先。
  - 避免向用户暴露 0–1000 原始分。

### 6.3 Agent、工作区与附件

- `src/agent.ts`
  - 使用 JSON 文字协议兼容任意 OpenAI-compatible 模型，不依赖原生 tool_use。
  - 内置 `list_dir`、`read_file`、`write_file`、`run_command`、`read_attachment`。
  - 最多 20 步；解析连续失败 3 次停；命令 60 秒超时；结果/读取/上下文都有上限。
  - 工作区路径做字符串边界 + realpath/symlink/junction 复核。
  - `write_file` 首次修改前以 Buffer 快照；撤回可原样恢复二进制。
  - `run_command` 永远要批准，且超时杀进程树；命令副作用不可撤回。
  - 图片绕过 MemoWeft 纯文字接口，Host 直接发送标准 `image_url` content parts。
  - 会带入当前会话最近 16 条上下文，以及当前人格和最多 6 条相关召回。

- `src/agent-workspace.ts`
  - 为未配置会话创建 `<Documents>/WeftMate` 默认工作区，避免开放整个 Documents 或 userData。

### 6.4 MCP

- `src/mcp.ts`
  - 官方 `@modelcontextprotocol/sdk` 客户端；当前只支持 stdio。
  - 连接/列工具 20 秒超时；单服务失败不拖累其它服务；收 stderr 给用户可读错误。
  - 给模型只放 `fqName + 一句话 + 顶层参数签名`，完整 schema 留本地，符合延迟加载红线。

- `src/mcp-store.ts`
  - MCP 服务配置及 env 加密存储。
  - 支持增改删、开关、公开脱敏视图。

- `src/settings.ts`
  - 除感知/语言外，还保存 `trustedMcpTools`。
  - MCP 默认一律强制批准；用户对具体工具显式信任后才免批。

### 6.5 感知与模型配置

- `src/collector.ts`
  - 每 20 秒采样活动窗口；空闲 60 秒跳过；窗口变化才写。
  - 可只采 App 名或 App + 标题。
  - originId 使用窗口键 + 小时桶，跨重启同小时去重。

- `src/config-store.ts`
  - 多模型档；对话模型必配，写模型/嵌入模型可选。
  - 密钥 safeStorage 加密；空 key 更新时沿用旧 key。
  - 切档前清除全部相关 env 再注入，避免旧模型残留。

- `src/genEnv.ts`
  - 旧配置向导的 `.env` 文本生成器。现有桌面 UI 已改走 safeStorage，多数属于兼容/遗留路径。

### 6.6 人格与前端

- `src/experiences/xingyao.ts`
  - 中文陪伴人格；有强反编造记忆护栏。

- `src/experiences/aria.ts`
  - 英文一等人格；英文版反编造/naming 护栏。

- `src/experiences/plain.ts`
  - 克制的普通助手；当前中文系统提示，英文 UI 下仍可能不是完全英文一等体验。

- `src/experiences/index.ts`
  - 注册表唯一事实源；当前三个体验共享同一份记忆。

- `src/web/index.html`
  - 单文件 HTML/CSS/JS；当前绝大多数产品功能都在这里。
  - 包含自绘壳、会话列表、工作区分组、统一 Agent、附件/图片、MCP 管理、模型设置、感知、主题、人格、记忆画像、图谱、导入导出、i18n。
  - Markdown 使用 createElement/textContent 白名单式渲染；模型输出不走字符串 innerHTML。
  - 有大量后加 CSS 覆盖、旧向导死代码和旧 `/api/chat` 路径，维护成本较高。

---

## 7. 已实现功能：以代码可达为准

### 7.1 桌面产品骨架

| 功能 | 状态 | 当前事实 |
|---|---|---|
| Electron 常驻 | 已实现 | 托盘、关窗隐藏、单实例、第二实例唤前台、优雅退出 |
| 自绘标题栏 | 已实现 | 无原生菜单/边框；最小化、最大化、关闭、双击最大化 |
| 深/浅主题 | 已实现 | localStorage 持久化，图谱颜色同步，支持 reduced motion |
| 响应式 UI | 已实现 | 多档窄屏媒体查询；聊天/输入/设置/图谱适配 |
| 安全 Markdown | 已实现 | 标题、列表、引用、链接、行内代码、代码块/复制；HTTP(S) 链接白名单 |
| 首次模型配置 | 已实现 | 未配模型时弹设置；safeStorage 保存后热重建，不重启进程 |
| 多模型档切换 | 已实现但不等于蓝图全量 | 支持自定义多档、对话/写/嵌入模型；没有内置供应商目录、倍率、Max/推理档 |
| 单一“＋”入口 | 已实现 | 文件/图片、工作区、查看上下文 |
| `/` 命令 | 未实现 | 产品文档写为 MVP，但代码没有 command palette/slash command |
| 主隐私开关/无痕/留存期 | 未实现 | 有感知开关和数据操作，但没有统一主开关、无痕模式、留存策略 |
| 用量 UI | 未实现 | 后端 `/api/usage` 已有，前端无看板 |
| 语音输入 | 占位 | 按钮只提示“即将支持” |
| 桌面形象 | 占位/当前隐藏 | DOM 和旧样式存在，但最新 CSS `#pet { display:none !important; }`；无 Live2D/情绪同步 |

### 7.2 会话与历史

| 功能 | 状态 | 当前事实 |
|---|---|---|
| 多会话 | 已实现 | 新建、列表、切换、重启后续上最近会话 |
| 续聊上下文 | 已实现 | `seedTurns` 重建最近工作记忆窗口；切人格后只种用户历史，避免旧人格带偏 |
| 会话绑定工作区 | 已实现 | JSONL 内写 session_meta；前端按完整路径分组 |
| 图片历史 | 已实现 | data URL 入 Agent，落独立资源，历史重载可显示/放大 |
| 软归档 | 已实现 | `.archived` 保留数据；当前会话归档后自动切换/新建 |
| 归档恢复 UI | 未实现 | 后端 read/append 有恢复能力，但 `/api/sessions` 不列归档，前端无恢复入口 |
| 会话重命名 | 未实现 | 标题仍由首条用户消息 preview 产生 |
| 会话/全文搜索 | 未实现 | 只有画像内容的前端筛选，不是历史搜索 |
| 跨设备接力 | 未实现 | 仅 memory bundle 导入导出，不含会话/账号/同步 |
| 单会话导出 | 未实现 | 记忆包不含聊天记录 |

### 7.3 记忆与画像

| 功能 | 状态 | 当前事实 |
|---|---|---|
| 证据/经历/认知底座 | 已接入 | 由 MemoWeft 依赖提供；Host 不直接摸 store |
| 画像列表 | 已实现 | 类型筛选、文本筛选、有效/失效状态、定性把握度 |
| 来源分组 | 已实现 | 对话、感知、用户改删等来源分开呈现 |
| 记忆气泡 | 已实现 | 新认知织入聊天；可标不再有效、永久删除、自动淡出 |
| 内容直接编辑 | 未实现 | 目前是 invalidate/delete，不是原地改写内容 |
| 证据授权 | 已实现 | 每条 evidence 可控制 cloud read / inference |
| 证据安全删除 | 已实现 | 默认先显示 blockers；确认后 force 断链删除 |
| 记忆图谱 | 已实现 | Canvas 力导向图、节点/关系/范围筛选、搜索、缩放、详情 |
| 立即整理 | 已实现 | 与后台整理共用单飞锁；会诚实显示需要等待 |
| 记忆包导出/导入 | 已实现 | dry-run 校验/试算 + merge；不含密钥和聊天历史 |
| 清空记忆 | 已实现但语义有限 | 清 MemoWeft 数据并软归档会话；不是删除所有本地用户数据 |
| 周报/变淡标签/时间线 | 未实现 | M9 规划项；底层有效把握度会衰减，但无完整产品化呈现 |

### 7.4 人格

- 已注册：星瑶、Aria、普通助手。
- 切换后当前会话下一句生效；Host 缓存和 Core conversation 缓存都会清。
- 三个人格共享同一份记忆，验证了“换人设不失忆”。
- 星瑶/Aria 都有“没有召回就绝不声称记得”的提示护栏。
- 仍未实现人格专属形象、声音、默认模型、技能包；所以“人格=能力包”目前只完成了 prompt/语气这一层。

### 7.5 感知

- 已实现一个桌面源：活动窗口 + 活动节奏。
- 默认关闭、用户手动 opt-in；可选 App-only 或 App+标题。
- 空闲/锁屏时不采，同一窗口不重复采。
- observed 默认不上云；上云需要二次确认。
- observed 会在画像里归入“感知来的”。
- 未实现主动关怀、P0/P1 通知、手机、穿戴、更多设备状态。

### 7.6 Agent、MCP 与附件

- 统一 Agent 默认开启，默认自主度是 `auto`（界面显示“完全访问”）。
- 默认工作区是 `<Documents>/WeftMate`，不是整个 Documents，也不是 userData。
- 三档：只建议、每次确认、完全访问。
- `auto` 可在工作区内自动读写文件；命令和未信任 MCP 始终要批准。
- 每步状态、参数摘要、结果、批准/拒绝/停止、撤回都可见。
- MCP 支持 stdio；Windows 预置用 `cmd /c npx`。
- 预置：filesystem、memory、sequential-thinking、everything。
- 文本/代码附件按需读取；图片支持 PNG/JPEG/WebP/GIF 和 OpenAI-compatible vision。
- 前端限制：文本文件读取前上限 512 KB；图片单张约 6 MB、每轮最多 4 张、合计约 18 MB。
- 后端再次限制：最多 20 个附件、文本每个 200,000 字、图片 data URL/总量有限制，请以后改上限时保持前后端一致。
- 未实现：原生 tool_use、流式输出、逐行 diff、HTTP/SSE MCP、工具搜索元工具、任务重启恢复。

---

## 8. Loopback API 全表

### 8.1 基础/聊天

- `GET /`、`GET /index.html`：前端单文件。
- `GET /api/health`：MemoWeft health + `encryptionAvailable` + `uiLang`。
- `GET /api/usage`：LLM/embed 累计用量原料；无 UI。
- `POST /api/chat`：旧/兼容普通聊天链路；当前默认 UI 走 Agent。
- `GET /api/chat-history`：当前会话历史。
- `GET /api/bg-status`：画像后台整理状态和新认知。
- `POST /api/refresh`：立即整理记忆。

### 8.2 会话与人格

- `POST /api/reset`：新建会话并继承当前工作区。
- `GET /api/sessions`：未归档会话 + 工作区信息。
- `POST /api/session/open`：切换/续聊。
- `POST /api/session/archive`：软归档。
- `GET /api/session-image`：读取安全图片资源。
- `GET /api/experiences`、`POST /api/experience`：列/切人格。
- `GET /api/plugins`：代码注册插件的只读视图。

### 8.3 模型和设置

- `GET /api/model-config`
- `POST /api/model-config/profile`
- `POST /api/model-config/active`
- `POST /api/model-config/delete`
- `GET /api/settings`
- `POST /api/settings/language`
- `POST /api/settings/perception`
- `POST /api/gen-env`：遗留 `.env` 生成能力。

### 8.4 记忆管理

- `POST /api/observe`
- `GET /api/cognition`、`GET /api/cognition/count`
- `POST /api/cognition/invalidate`、`POST /api/cognition/delete`
- `GET /api/evidence`
- `POST /api/evidence/authorization`、`POST /api/evidence/delete`
- `GET /api/memory-graph`
- `GET /api/export-bundle`
- `POST /api/import-bundle`
- `POST /api/factory-reset`

### 8.5 Agent 与 MCP

- `GET /api/agent/workspace`
- `POST /api/agent/pick-workspace`
- `POST /api/agent/start`
- `GET /api/agent/status`
- `POST /api/agent/decide`
- `POST /api/agent/stop`
- `POST /api/agent/undo`
- `GET /api/mcp/servers`、`GET /api/mcp/catalog`
- `POST /api/mcp/server`
- `POST /api/mcp/server/toggle`
- `POST /api/mcp/server/delete`
- `POST /api/mcp/server/reconnect`
- `POST /api/mcp/tool/trust`

---

## 9. 验证结果（2026-07-14 本次实测）

### 9.1 环境

- Windows / PowerShell
- Node `v24.15.0`
- npm `11.12.1`
- Electron `v43.0.0`
- TypeScript `5.9.3`
- `@modelcontextprotocol/sdk 1.29.0`
- `get-windows 9.3.0`
- 当前本地 MemoWeft：`0.5.1`，junction 到 sibling `../memoweft`
- npm registry 上的 MemoWeft latest：`0.5.0`

### 9.2 本机开发树

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | 47 tests / 9 suites，47 通过、0 失败 |
| 前端内联脚本语法 | 2 个 `<script>` 均可被解析 |
| Electron 隔离 userData 启动 | 通过 |
| loopback `/api/health` | 200；干净实例 `llmReady=false`、`embedReady=false`、`encryptionAvailable=true`、`uiLang=zh` |
| 首页加载 | 200，返回当前 432,521 bytes HTML |
| BrowserWindow | 日志确认“窗口加载完成” |
| 感知默认值 | 日志确认默认关闭 |

本次没有使用作者真实模型密钥，因此没有重新做真模型聊天/视觉/MCP 全链 dogfood。历史文档记录过真 npx filesystem MCP 和感知端到端验证，但应与“本次自动验证”区分。

### 9.3 测试覆盖了什么

当前自动测试覆盖：

- Agent 普通回答/工具回答回写差异、人格动态读取、最近会话上下文。
- 三档自主度、命令审批、批准/拒绝/停止。
- 附件上限、无工作区护栏、图片 content parts、视觉自然语言兜底。
- 路径逃逸、跨盘、symlink/junction、二进制撤回。
- 默认工作区。
- 会话工作区元数据、归档/恢复语义、图片资源签名与路径。
- Aria/星瑶/plain 注册。
- MCP 极简签名、延迟加载、默认强批、信任免批。

### 9.4 明显测试空白

- 没有 server API 端到端测试。
- 没有 config-store/mcp-store safeStorage 自动测试。
- 没有 collector、scheduler、main 生命周期自动测试。
- 没有 UI 自动化或 i18n 字符串/DOM 完整性回归测试；而 i18n 最近已经造成过卡死和全按钮失效。
- 没有打包、安装、签名、更新测试。
- `tsconfig` 只 include `src/**/*.ts`，不检查 `main.mjs`、`preload.cjs`、前端 JS 和测试 TypeScript。
- 没有覆盖 loopback Origin/CSRF、MCP 重名、长时间任务内存回收等边界。

---

## 10. 里程碑真实状态

### 10.1 原阶段路线

| 阶段 | 真实状态 |
|---|---|
| S0 SQLite | 完成，node:sqlite 已跑通 |
| S1 Electron 骨架 | 完成，本次隔离启动再次通过 |
| 阶段 1 立身之本 | 基本完成；但隐私主开关/无痕/留存期、完整人格能力包、完整内置模型体验仍不足 |
| 阶段 2 感知 | 已接线；主动关怀未做 |
| 阶段 2 Agent | 已接线，且已成为默认聊天路径 |
| 阶段 2 MCP | stdio 版本已接线；HTTP/SSE 未做 |
| 阶段 2 附件/工作区 | 已接线，图片也已完成 |
| 阶段 2 历史接力 | 部分：多会话、工作区分组、软归档、续聊已做；搜索、重命名、恢复 UI、跨设备未做 |
| 阶段 3 陪伴/完整度 | 只零散提前做了主题/视觉壳；桌面形象、情绪、主动通知、快捷键等未做 |

### 10.2 M0–M9 发布路线

| 里程碑 | 报告结论 |
|---|---|
| M0 安全网/建仓 | **部分完成**。本地 typecheck、47 tests、adapter、CI 文件、LICENSE、dogfood、README/site 都有；但公开 repo 不存在，CI 未激活，且当前本地依赖让干净 CI 会失败 |
| M1 P0 安全 | **大部分完成但有回退**。审批、symlink、进程树、安装警示、工具信任已做；MemoWeft 精确 pin 在最新提交被回退成 file dependency |
| M2 收口/隐私 | **大部分完成**。代码中的 C1/C4/C5/C6/C7、日志、隐私文档、导出/清记忆都在；路线验收要求的“应用内一键带日志报告”没有前端入口 |
| M3 双语 | **部分完成**。Aria 和应用 UI i18n 已做；动态逐屏真 App 验收不足；营销站只有中文；README 只有英文摘要；release notes 不存在 |
| M4 打包 | **未开始**。无 electron-builder、esbuild 打包链、图标资产、NSIS/dmg/AppImage、装机冒烟 |
| M5 发布 | **未开始**。无签名、公证、Release workflow、自动更新、tag/release |
| M6 历史接力 | **地基已提前完成一部分**，核心搜索/重命名/归档恢复/跨设备仍未做 |
| M7 Agent 信任深化 | **部分基础已有**，但密钥扫描、操作审计、可读 diff、任务级授权范围未做 |
| M8 产品完整度 | **主题已提前做**，其余全局热键、离线重发、完整引导、克制通知、开机自启、完整无障碍、单会话导出未做 |
| M9 记忆护城河 | **只有画像/图谱/失效删除等基础**；周报、反证闭环、变淡标签、时间线、规模优化未做 |

---

## 11. 最高优先级问题与风险

### P0-1：干净克隆不可用，CI 当前必红

最新 `package.json`：

```json
"memoweft": "file:../memoweft"
```

本机 `node_modules/memoweft` 是指向 sibling `../memoweft` 的 junction，版本为 0.5.1。这个 sibling 不在 WeftMate 仓库里。

本次用临时目录做了干净本地 clone：

1. `npm ci --ignore-scripts --offline` 返回 0，但生成了指向不存在的 `<temp>/memoweft` 的 junction。
2. `npm run typecheck` 随后报 `Cannot find module 'memoweft'`。
3. `npm test` 随后因 `ERR_MODULE_NOT_FOUND` 失败。

这意味着当前 `.github/workflows/ci.yml` 即使仓库创建并推送，也不能在 GitHub runner 独立运行。Git 历史显示 M1 曾正确固定为 `"memoweft": "0.5.0"`，最新大提交又改成了本地文件依赖。

需要 owner 选择：

- 如果 WeftMate 只依赖已发布 API：恢复精确 `memoweft@0.5.0` 并重跑全部测试。
- 如果当前代码必须依赖本地 0.5.1：先正式发布 MemoWeft 0.5.1，再把 WeftMate 精确 pin 到 0.5.1。
- 不建议把 sibling file dependency 带入独立公开仓库或发布流水线。

### P0-2：公开仓库不存在，README/站点 CTA 是死链

- 本地 `git remote -v` 为空，无 remote、无 tag。
- `https://github.com/memoweft/weftmate` 当前返回 404；`git ls-remote` 也确认 repository not found。
- README 和营销站都把 CTA 指向这个地址。
- `https://weftmate.com` 当前可访问且是中文落地页，但 GitHub 按钮指向不存在的仓库。
- 因此 CI、Issue 模板、公开协作、Release 都没有真正激活。

### P0-3：三份“当前状态”文档相互冲突

- `CURRENT.md` 仍说“下一块=历史接力”。
- 更新的 `docs/ROADMAP.md` 把历史接力移到发布后 M6，当前应先完成 M3，再做 M4/M5。
- 2026-07-13/14 的实际提交确实在按 ROADMAP 做 M0–M3，而不是历史接力。
- 所以实际执行优先级已由 Git 历史证明发生变化，但 `CURRENT.md` 没同步。

在 owner 重新拍板前，最合理的推断是：先修可复现依赖，然后完成 M3 I2，再进 M4；历史接力按 ROADMAP 留到 M6。但这仍应明确确认，不能由接手模型擅自永久改路线。

### P1 安全与隐私风险

1. **无鉴权 loopback**：服务只绑 127.0.0.1 是好事，但没有 session token、Origin/Host 校验或 CSRF 防护。大多数 JSON POST 会被浏览器 preflight 挡住，但 `/api/reset`、`/api/refresh`、`/api/agent/pick-workspace` 等无 body 的简单 POST 仍可能被恶意网页触发副作用/弹窗。
2. **感知 UI 关闭不等于摄入端点关闭**：`/api/observe` 只检查 env 总开关 `MEMOWEFT_HOST_COLLECTOR`，不检查用户的 desktop perception setting。内置 collector 会停，但任意本机进程仍可向端点灌 observed。
3. **默认“完全访问”**：统一 Agent 默认 `auto`，模型可在专用默认工作区内自动写文件。命令/MCP 仍强批，边界不算失控，但这是需要 owner 明确确认的默认信任姿态。
4. **MCP 信任按 fqName 存**：fqName 由“服务名 slug + 工具名”生成，服务名没有唯一约束。两个同名/同 slug 服务可能发生路由或信任碰撞；显式信任可能错误继承给另一个同名工具。
5. **任务内存不回收**：`agent.ts` 的 `tasks` Map 不删除完成任务；图片 data URL、消息、步骤、备份都可能在进程生命周期内持续保留。大图片多任务会形成明显内存增长。
6. **完整数据删除未实现**：当前“清空全部记忆”不是完整恢复出厂/GDPR 全数据删除；会话和附件仍留盘，模型/MCP 密钥与设置也保留。
7. **工作区绝对路径发给模型**：系统提示包含绝对工作区路径。UI 隐私文案主要强调文件/输出，建议把路径也明确列为可能外发的元数据。

### P1 可靠性与维护风险

1. `src/web/index.html` 单文件 6,956 行，CSS 多轮覆盖、旧向导和旧聊天路径共存，修改容易产生远距离回归。
2. i18n 依赖运行时 DOM 翻译和大字典，最近已有两次严重回归，但没有自动 UI/i18n 测试。
3. 统一 Agent 的任务状态只在内存；应用退出/崩溃后不能恢复，历史可能只剩已落盘用户消息。
4. 配置/设置文件直接覆写，不是临时文件 + 原子 rename；写入中断可能导致整份配置回落为空。
5. 主进程用固定 800ms 等待 server，而不是等待 listen ready；慢机/打包环境存在竞态。
6. `electron: "latest"`、MCP SDK/get-windows 用 caret，重装可能得到不同版本；在发布线应固定并由升级 PR 管理。
7. 当前开发运行依赖 Electron/Node 的 TypeScript type stripping；打包前必须按 ROADMAP 做预编译和原生模块资源处理。

---

## 12. 文档漂移清单

### `AGENTS.md`

- 写“CURRENT 当前=阶段 1”，实际早已进入阶段 2 和 M0–M3 发布线。
- 写库仓库在 `../DLA_rebuild`，本机该路径不存在；实际依赖目标是 `../memoweft`。
- 写 `memoweft@^0.5.0`，当前 package 是 file dependency，roadmap 又要求精确 pin。

### `CURRENT.md`

- 顶部“历史接力是下一块”与新 ROADMAP 冲突。
- 没完整记录最新统一 Agent、会话工作区分组、图片历史、47 测试、M0–M3 的当前状态。
- 末尾复用说明仍写 `web/index.html` “待重做”，实际已经重做多轮且膨胀到 6,956 行。
- 附件段写“无工作区也可开工”，底层 `agent.startTask` 仍支持，但 server 现在总会给当前会话绑定默认工作区；产品实际路径已经变化。

### `docs/ROADMAP.md`

- 第 0 节仍描述“测试在 scratchpad、无 typecheck、无 repo”，前两项已经过时。
- M0 注释写 site 尚未进 git，实际 `site/` 已 tracked 且 `weftmate.com` 已在线。
- 测试数写 28/30/32/34，当前是 47。
- M1 写 MemoWeft 精确 pin 已完成，最新提交已回退。
- M2 写全部完成，但验收项中的应用内日志报告入口没有实现。
- M3 对 I1/I4 的描述基本正确；I2 仍确实未完成。

### `README.md`

- 写“图片/多模态待后续”，实际已支持。
- 写完整 i18n 在 M3 未来落地，实际应用 UI/Aria 已落地，只是 site/文档未收口。
- 写阶段 1 + 阶段 2 前四块，没有反映统一 Agent/工作区分组/M0–M3。
- GitHub 链接当前 404。
- 写 CI 尚未就绪是事实，但更准确的原因不仅是未激活，还包括 file dependency 会让干净 CI 失败。

建议在修依赖后一次性同步四份文档，建立一份明确的“当前优先级唯一事实源”。

---

## 13. 推荐下一步顺序

### 立即 P0

1. **恢复可复现依赖**：决定 MemoWeft 0.5.0 或先发 0.5.1；去掉 sibling `file:`；重建 lock；在没有 sibling 的干净目录验证 `npm ci && npm run typecheck && npm test`。
2. **建立公开仓库并激活 CI**：创建 `memoweft/weftmate`、配 remote、push；确认三平台 CI 真绿；修 README/site CTA。
3. **统一状态文档**：让 owner 明确 CURRENT 与 ROADMAP 谁代表下一步；同步 AGENTS/CURRENT/ROADMAP/README 的版本、路径、测试数和功能事实。

### 发布线 P1

4. **完成 M3 I2**：给 `site/index.html` 做中英切换；补完整英文 README/发布说明；在真 Electron 中逐屏验证中文和英文动态面板。
5. **补 M2 验收漏项或改口径**：实现应用内查看/复制/打开 Issue 的崩溃日志入口，或从“已完成”标准中明确移除。
6. **补最小安全防护**：loopback session token/Origin 校验；perception setting 关闭时拒绝 `/api/observe`；处理 MCP fqName 唯一性；为 Agent 完成任务做回收。
7. **加回归测试**：server API 集成、i18n DOM 完整性、config safeStorage、collector/scheduler、统一 Agent 刷新/切会话、干净克隆测试。

### 然后进入 M4/M5

8. electron-builder + esbuild 预编译 `.ts`。
9. 正确处理 `get-windows` 原生 `.node` 的 asarUnpack 和三平台差异。
10. 品牌图标、空 userData 装机冒烟、高记忆量冒烟。
11. 签名/公证、tag release、更新前备份、自动更新。

### 发布后或 owner 明确提前

12. 历史搜索/重命名/归档恢复/跨设备接力。
13. Agent diff、危险命令高亮、任务级授权、外泄/密钥扫描、操作审计。
14. 桌面形象、主动但克制的 P0/P1 通知、快捷键、开机自启、完整无障碍、记忆周报/时间线。

---

## 14. 仍需 owner 拍板的问题

1. **依赖版本**：WeftMate 当前是否必须使用未发布的 MemoWeft 0.5.1？若不是，是否立即恢复 0.5.0 精确 pin？
2. **真实下一块**：继续 ROADMAP 的 M3 I2 → M4/M5，还是恢复 CURRENT 的“历史接力优先”？
3. **默认权限**：统一 Agent 首次进入就“完全访问”是否是最终产品决策，还是应默认“每次确认/只建议”？
4. **恢复出厂语义**：只清记忆、保留归档会话是否足够，还是要另做“删除所有本地数据和密钥”？
5. **公开仓库**：是否确定使用 `github.com/memoweft/weftmate`，何时创建并开放？
6. **普通助手国际化**：英文 UI 下 plain 是否也要提供英文系统提示，而不只依赖 Aria？
7. **MCP 预置版本**：继续 `npx` 拉最新 + 警示，还是给官方预置直接锁具体版本？

---

## 15. 接手后常用命令

```bash
npm install
npm run typecheck
npm test
npm start
node dogfood/run.mjs
```

注意：在当前 `file:../memoweft` 状态下，前三条只有 sibling `../memoweft` 存在时才真正有效。修复依赖前，任何“测试全绿”都必须注明是在带本地 sibling 的开发机上跑的。

核对边界：

```bash
rg "from 'memoweft'|from \"memoweft\"" src
git status --short --branch
```

第一条正常应只命中 `src/memoweft.ts`。

---

## 16. 最终交接判断

这是一个已经证明核心产品想法、也已积累大量真实工程细节的项目，不是空壳 Demo。最有价值的部分已经存在：记忆/画像可视、记忆气泡、同记忆人格切换、感知、统一聊天与 Agent、MCP、附件/图片、工作区、安全撤回和本地隐私边界。当前主要矛盾已经从“功能有没有”转为“开发机上的能力能不能被稳定、独立、可信地交付给外部用户”。

因此下一位 ChatGPT 不应继续无边界堆新功能。先修可复现安装、激活真实 CI、统一状态文档、收完 M3，再进入打包发布，最符合现有 owner 在 2026-07-13 确认的“尽早发一个薄但真的 v1.0”战略。历史接力和更深护城河不是不重要，而是应在工程地基能让陌生用户真正装起来之后继续。

---

## 17. 2026-07-15 产品方向对话后的状态设计补充

owner 随后通过“项目方向定位问题”对话补充并确认了产品边界。该对话没有改变上文的代码事实，但改变了仓库应该如何描述当前阶段与后续路线。

### 17.1 新确认的产品边界

- MemoWeft 是完全开源、社区驱动的个人 AI 记忆能力层；WeftMate 是面向普通用户的官方产品。
- WeftMate 的第一入口是聊天，第一价值是“比普通聊天助手更了解我”；Agent 是增强，不是第一句卖点。
- 人格是可以创建、选择、导入、导出和分享的外壳/能力配置，不拥有独立用户记忆，也不是数字生命。
- 人格共享同一份 MemoWeft；用户可以禁止某个人格读取记忆。人格导出包绝不能包含用户记忆、聊天、密钥或路径。
- 新用户应通过可跳过的聊天式采访建立低把握度初始假设；MBTI 类测试只能作为证据之一。
- 用户拥有最高修改权。产品要区分“修改当前画像”和“指正错误推断”，不能只提供删除。
- 执行自主度和陪伴主动度是两个设置；所有扩权来自用户明确授权。
- 当前只做单 Agent 和基础工作流，不做多 Agent。
- 长期形态是一个 MemoWeft 核心连接 PC、手机和手表；官方云同步优先但具体数据范围尚未决定，observed 仍默认不上云。

### 17.2 新的阶段判断

仓库不再沿用容易混淆的“M0–M9 当前进度”或“阶段 2 下一块=历史接力”作为主状态，而改成五个大阶段：

1. **核心 Alpha 闭环**：本机技术验证已完成。
2. **可交付产品 v1**：当前阶段；先解决可复现、安全与发布地基，再完成首次认识、画像修改/指正、人格包和桌面角色切换。
3. **可靠桌面伴侣与协作工作流**：任务恢复、diff/审计、历史深化、桌面形象、克制主动提醒和基础单 Agent 工作流。
4. **官方云同步与多终端**：PC、Android、iOS、watchOS 共享一个用户记忆核心。
5. **开放生态与代理能力演进**：人格/工具/工作流生态和受控长期代理。

### 17.3 当前最准确的结论

```text
功能内核：Alpha 闭环完成
产品体验：部分完成
工程交付：被本地 MemoWeft 依赖和缺失发布链阻塞
外部验证：尚未开始
当前大阶段：可交付产品 v1
```

这比单一完成百分比更准确，也解释了为什么“人格切换已经有了”和“人格系统尚未完成”可以同时成立：前者指三个硬编码内置提示词的切换，后者指 Persona Manifest/Store、持久化、创建编辑、导入导出、权限和能力配置。

### 17.4 文档治理已经调整

- `docs/PRODUCT.md`：只维护产品定义和 owner 已拍板边界。
- `docs/ROADMAP.md`：只维护五个大阶段、模块范围和退出标准。
- `CURRENT.md`：唯一当前执行状态源，记录当前阶段、模块状态、阻塞和严格下一步。
- `AGENTS.md`：只保留开工入口、文档职责、红线和验证纪律。
- 本报告：保留为 2026-07-14 / `894026e` 的完整审计快照，并用本节记录后续状态设计变化。

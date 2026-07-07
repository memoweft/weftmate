# CURRENT.md · WeftMate 当前任务白板

> 唯一的"现在做什么"看板。产品定义看 `docs/PRODUCT.md`(活文档·中途可调),历史看 git 提交。

## 当前:阶段 2「懂你 & 帮你」(阶段 1 立身之本四块已齐)

阶段 2 分五块、分开推、作者定入口(作者拍板**按序做**)。**「感知→画像」「agent 干活」已做完**。剩下:**MCP 一键装 / 上下文附件 / 历史接力**,按序**下一块 = MCP 一键装**。
(注:~~「换窗口给提示词」~~ 是误记——作者当时是说旧会话上下文满了要换新会话接力,**不做**这功能。)

### ✅ 感知→画像 + 一串 dogfood 修(commit 18a7153/afbbda3/1e99e3f/2a58260/7a26dc8/bb1cf80)
- **感知采集**:依赖 `get-windows`(N-API 预编译·**实测 Electron 免 electron-rebuild**;破"零原生模块"·作者拍板)。`src/collector.ts`(main·powerMonitor 空闲跳过+get-windows 取窗+换窗才记 → POST /api/observe 审核层)、`src/settings.ts`(非密明文设置)。
- **感知设置(多源·作者反馈丰富)**:`perception.sources.desktop{enabled,capture}`(架构留位手机/穿戴)+ 全局 `cloudAllowed`。**采集内容** app_title/app_only;**上云红线口子**:sanitize 剥授权(插件不能自授权),仅用户开 cloudAllowed 时 server 给 observed 显式加 allowCloudRead(默认关=不上云)。设置弹窗「感知」节:桌面源开关+采集内容+上云开关(默认只留本机·警示·允许要二次确认)+后续来源占位。
- **语言设置**:memoweft 0.4.0 缺省 en → 认知出英文(dogfood 逮到)。`settings.language` auto/zh/en(auto 跟 app.getLocale);main 建 core 前设 MEMOWEFT_LANG;server `POST /api/settings/language` 运行期改 `config.language`(不重启;consolidate 调用时读共享单例)。设置「外观」加语言选择。
- **星瑶反编造(红线)**:dogfood 发现星瑶脑补"我记得你提过X"(认知=0·纯编)。`experiences/xingyao.ts` 记忆唤起段加硬:只复述真召回的记忆·没召回绝不说"我记得"/绝不凭空说未说过的。**注:prompt 强缓解非 100%;MemoWeft 只存有据记忆的结构保证未破(是人设层嘴快)。**
- **z-index 修**:二次确认框 #memConfirm 50→70(原被设置弹窗 55 盖住)。
- **验**:真机端到端(感知开→observed 证据·cloud 默认 false·开全局→true·仅App 只 App 名)+ 前端各面板 preview 读写翻转 + 语法门/复查 Agent。observed 证据进画像「感知来的」组。真"感知来的"认知需真模型 updateProfile 消化。

### ✅ agent 干活(阶段2·帮你干活①·方案B:Host 自建循环)
- **为什么 Host 自建**:memoweft 是纯记忆底座——聊天是文字进文字出的黑盒(`LLMClient.chat→string`,无 tool_use 口子),插件只能"交观察/读记忆"不能执行工具;库 README 写死"宿主决定怎么用(回话/调工具/agent)"。所以 agent 循环整个在 Host,库源码一行不碰(红线守住)。
- **不挑模型的工具调用**:文字协议——系统提示教模型每轮只回一个 JSON(`{action:{tool,args}}` 或 `{done:{summary}}`),Host 解析去执行、结果当"观察"喂回,循环到 done。LLM 复用库导出的 `OpenAICompatClient`(读当前激活模型·env 已 injectEnv 保持最新·temperature=0),agent 中间对话不进 memoweft 记忆。
- **`src/agent.ts`**(新):循环 + 内置四工具(`list_dir`/`read_file` 只读、`write_file` 改动、`run_command` 改动+永远要批准)+ 沙箱(`safeResolve` 路径锁死工作区、逃逸/跨盘/`..` 全拒)+ 快照撤回(改文件前备份原内容,撤回还原/删新建;`run_command` 副作用撤不回→`ranCommand` 如实标注)+ 三档自主度(suggest 只出计划不执行 / ask 每个改动先批 / auto 自动跑但命令仍批)。审批用可挂起的 gate,`decideStep`/`stopTask` 唤醒。记忆接线:`core.recall` 喂背景 + `core.ingestUserMessage` 回写。测试注入口 `__setClientFactory`。
- **`server.ts` 端点**:`POST /api/agent/{start,decide,stop,undo}` + `GET /api/agent/status`(前端轮询)+ `POST /api/agent/pick-workspace`(Electron dialog 选工作区)。记忆接线闭包注入(引用模块级 core,热重建自然跟随)。
- **前端**(`web/index.html`):🔒沙箱 从占位改成开合「干活模式」条(选工作区 + 三档自主度 + 隐私说明);干活模式下输入框发的是"任务"→ `/api/agent/start` → 轮询渲染步骤卡(徽章/参数摘要/结果/批准·拒绝/叫停/一键撤回),全 createElement+textContent 防注入。
- **隐私口径**:工作区文件/命令输出会发给用户配置的模型(可能云端)——由用户主动发起任务视同意(界面写明),与"observed 默认不上云"两码事。
- **验**:① 后端安全冒烟 15 断言全过(假模型确定性驱动·对临时文件夹)——正常写+撤回删新建 / 沙箱逃逸被拒(工作区外不留文件)/ 命令 auto 下也停 awaiting·拒则不跑·批才跑 / 撤回还原旧文件 / ask 下写文件也要批;② 前端 preview:零 JS 报错、干活条开合、完整流程 3 张步骤卡+批准+撤回渲染对、配色对(工具名金色等宽)。真模型端到端待作者亲验。
- **未做(留后)**:MCP 外部工具(下块)· 工作区/附件富 UX(第③块)· 模型原生 tool_use(先文字协议)· 逐行 diff · 流式(先轮询)。

## 阶段 1 · 立身之本 ✅ 已基本齐(S0 / S1 已通)

- **S0 · sqlite** ✅ node:sqlite 在 Electron 43 / Node 24.17 可用 —— **走 node:sqlite,零原生模块**(未装 better-sqlite3、能跑就是它)。
- **S1 · Electron 骨架** ✅ `src/main.mjs` 设 userData 库 + 默认星瑶 + 单实例锁 → `import './server.ts'`(起 127.0.0.1:7788 loopback + 建 core) → 开窗加载。现有 Host 能力已在桌面跑;**Electron main 直接跑 .ts、免编译链**。

### 阶段 1 · 立身之本(作者拍板开工顺序 = 下面 ①→②→③→④;配置生效见 [[weftmate-config-apply]])

- **① 桌面化收尾** ✅ 已做:托盘常驻 + 左键唤窗 + 菜单(显示/退出)、**关窗收托盘不退**、`before-quit` 调 server 导出的幂等 `shutdown()`(scheduler.dispose + core.close + 强断连接关 loopback·带超时兜底)、第二实例唤前台;DB 落 userData(✅)、单实例锁(✅)。托盘图标内嵌 data URL(免打包路径)。**启动冒烟过**;before-quit→shutdown 运行时路径需 GUI 点"退出"才能验(代码复查过)。
- **② 配模型 + safeStorage** ✅ 已做(作者亲验后二次迭代成【多模型档 + 进程内热重建】,见 [[weftmate-config-apply]]):`src/config-store.ts` = `{profiles:[{id,name,llm,write?,embed?}],activeId}`,key safeStorage 加密落盘(**明文绝不落盘/不 log**),`readPublicView()` 剥掉所有 key,重配留空 key 沿用旧的,`injectEnv()` 先清后设=当前 active 档。`server.ts`:`core` 改 `let` + `rebuildCore()`(改配置/切档【进程内重建 core、不重启不闪】),端点 `GET /api/model-config` + `POST /profile|active|delete`(全热重建)。main 删原生菜单 + 端口尊重 `PORT` env。**验:多档隔离冒烟全绿(增/切/删/injectEnv清设/无明文泄露)+ 真机热重建端到端(建档→health 翻 true、切/删正确、无泄露)。**
- **③ 产品级对话界面** ✅ 已做(Claude Desktop 深色金调):`src/web/index.html` 重做外壳(2331→2528 行)——左对话记录 + 侧栏底部功能区(记忆与画像/能力与感知/设置/人格·带切换动画)、精简顶栏(对话标题+记忆胶囊)、底部工具栏(＋文件/工作区 · 模型选择器显真模型名 · 技能 · 沙箱 · 发送;＋/技能/沙箱=占位点弹"近期")、输入框**无 placeholder**、桌面形象 🧵 浮角落、记忆面板改**右滑入层**。**JS 逐字保留**(图谱 400+ 行字节级未动、82 个 id 引用全命中、24 个 API 全可达——独立 diff + 复查双证)。**验:node --check 过 + preview 真实渲染(body 深色 #191a1e / 无控制台报错 / 全结构在位)。** 复查揪出并已修:图谱选中环/标签深色对比度、图谱详情把握度**露分**(改定性档 CRED_CN)、恢复出厂警示字对比度、节点色对齐图例。
  **作者亲验后二次迭代(已做)**:① 删 Electron 原生菜单条;② 设置做成**模态弹窗**(左导航 模型/外观/关于 + 右内容·多模型档增删改切);③ **日夜主题切换**(暗/亮两套 CSS 变量·图谱色改 getComputedStyle 读变量随主题走·localStorage 持久·head 预置防闪白);④ 底部**模型选择器改下拉**(列档+当前高亮+管理入口·切档走 /active 热重建·不重启);⑤ 首启改"填完 reload 进聊天"(不再"重启")。旧全屏向导 `#wizard` 成隔离死代码(进不去/打不到 404,日后可清)。**验:2 路复查(JS 接线/保全 + 双主题对比度/naming 全过)+ 真机渲染两主题(设置弹窗/下拉/主题翻转)+ 已修亮色对比漏网(toast.danger/内联 code/faint/accent/ready 全变量化)。**
- **④ 三样立身之本做扎实** ✅ 基本齐(MVP):**画像可视** ✅ 已做(④-1 按来源分组·commit 78e89e9·种子渲染+dogfood 验过)、**记忆气泡** ✅ 已达标(weaveMemNote 织"记住了:X·把握度档·这条不对/删"+误删二次确认+就地反馈,PRODUCT.md 口径满足)、**人格切换** ✅ MVP 已达标(切人设+反馈+后端保留同记忆;更丰富能力包=形象/声音/默认模型属后续)。评估:剩两样本就到 MVP 水位,不造 polish。**阶段1 立身之本(①桌面化/②配模型/③外壳/④三样肌肉)四块基本齐。**
   守克制纪律:少而准、不吹大、工具定义延迟加载。

> **✅ 作者第二次亲验反馈(2026-07-07·已做并三重验证)** —— 第三轮外壳打磨(下面 5 点):亮色改金/琥珀统一(压深一档达标)、顶栏与侧栏顶同高同底连贯、模型下拉重做(加宽/标题/金点/淡入)、加响应式媒体查询(≤900/700/440·窄窗无溢出)、**助手消息平铺 + 手搓 markdown/代码块渲染器**。markdown 渲染器 **XSS 三重验证安全**(我逐行读 + 真机注入 script/img/js链接全中和 + 复查 Agent 28 条对抗输入 0 高危);双复查 + 真机渲染两主题 + 缩放全过。"越用越懂你"撞 naming.md §2 但=作者产品 slogan → **作者裁决保留**。
>
> **✅ 作者第三次亲验反馈(2026-07-07·已做并验证)** —— 第四轮外壳:① **去 Windows 原生标题栏 → 自绘无边框标题栏**(main frame:false + `src/preload.cjs` 暴露 window.wmWindow{min/max/close/onMaximizeChange} + 前端 #titlebar 可拖拽+三键随主题上色+双击最大化;布局下移 38px 不重叠);② 内容列 max-width 改 `clamp(720px,68vw,1040px)`(最大化不留大白边、封顶可读);③ 全局滚动条随主题上色(暗色不再白底)。验:preview 渲染(标题栏/下移/宽度/滚动条/无报错)+ 真机无边框+preload 启动无错 + 复查 Agent 0 问题(核心逐字未动)。补:启动即最大化时图标初始态推送。
> 1. **界面不统一**:设置弹窗(深色)与聊天页(浅色态)风格对不上;各页视觉要统一。
> 2. **顶栏不统一**:header 与其余部分风格不搭,要统一。
> 3. **模型下拉别扭**:#modelMenu 弹层位置/样式要重做好看。
> 4. **对话框不自适应窗口**:输入区/聊天布局要随窗口大小自适应(现在固定/不伸缩)。
> 5. **学 Claude 聊天排版**(最大):用户消息=气泡;**Agent 消息不用气泡、平铺文字 + 正确 markdown 渲染**(标题/列表/粗体/内联码);**代码块像 Claude**(语言标签 + 复制按钮 + 等宽块,可选轻量高亮)。零依赖单文件 → 需手搓极简 markdown/代码块渲染器,守 textContent 防注入(markdown 转 HTML 要自己白名单转义)。

## 复用(已在 `src/` · 从 `../DLA_rebuild/apps/memoweft-host` 搬 · 只经 import memoweft 用门面不碰库)

`experiences/`(星瑶/plain 人格 + 注册表) · `scheduler.ts`(后台整理) · `chatHistory.ts` · `confBand.ts`(把握度分档) · `server.ts`(loopback + core + chat 编排,切人格清双缓存那段必须原样保留) · `web/index.html`(前端 · **待重做**)。

## 下一块 = MCP 一键装(阶段2·帮你干活②)

作者拍板阶段2 剩下的块**按序做**:agent 干活 ✅ → **② MCP 一键装** → ③ 上下文附件 → ④ 历史接力。
**② MCP 一键装**(PRODUCT.md §帮你干活):像装扩展一样装能力(如 Claude CLI 写代码),不手改配置;**工具定义延迟加载**(生死线)。天然接上①——agent 循环已留好"工具"这层抽象(`src/agent.ts` 的 `TOOLS` 表),MCP 来了就是往同一个循环塞更多工具、复用同一套信任框架(审批/沙箱/每步可视/撤回)。动手前守三纪律:工具定义延迟加载、主动打断只报 P0/P1、隐私(observed 默认不上云)。

(澄清:「换窗口给提示词」是误记,不做——见文首。)

## 待作者手动

- **建 GitHub repo `weftmate`**(本机没装 gh):建好后配 remote 推送(本地已 `git init` + 提交若干)。命名口径见 MemoWeft 的记忆 [[memoweft-naming-positioning]]。
- **dogfood 实例**:`scratchpad/dogfood-ud5`(隔离 userData·含作者真模型配置)可能还在跑(7899)/或已关;新会话要 dogfood 自己重起。scratchpad 里 static-serve.mjs 是 preview 用的 mock。

## 参照

- 产品定义 = `docs/PRODUCT.md`(**活文档·中途可调**)。
- 可视化蓝图 = `docs/blueprint.html`(浏览器打开)。
- 开工规矩/红线 = `AGENTS.md`。

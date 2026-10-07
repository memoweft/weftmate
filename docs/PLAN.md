# WeftMate 整体规划（2026-10-07 起，当前有效）

> 本文件是唯一的路线与工作包来源。愿景见 `VISION.md`；进度只写 `STATE.md`。
> 规划：Claude（整体规划与审查）。执行：Codex（Windows 侧一个，Mac 侧一个）。拍板：本人。

## 1. 为什么重做规划

愿景是「同一个账号、跨设备跨对话、能自主办事、越用越懂你的助手」。此前执行偏离在四点：

1. **流程压过产品**：任务卡合计约 490KB、`CURRENT_STATE` 868 行、多窗口互发消息与线程登记；一个真实会话的续验做了数天的 token 取证。
2. **工具写死**：个人入口给模型的是 `personal_open_notepad`、`personal_save_document`、`personal_browser_*` 等窄工具并按回合限次，与「不为任务写死方案」相反。DSH 已自带 `bash/shell/read_file/grep/web_fetch/todo/compaction/goal/schedule/subagent/mcp`。
3. **过度防御**：到处是回执、哈希、窗口上限、guard。真实失败反而是朴素问题（预算写死 32768/8192 → `max-tokens` 空结束；历史每页从尾部倒扫 → 长会话打不开）。
4. **验收方式**：靠单个长会话取证，而不是一组可重复的真实目标。

## 2. 已确认决定（2026-10-07 本人）

| # | 决定 |
|---|---|
| D1 | **五端联合开发，不冻结 Apple**。各端围绕同一份客户端契约并行，按同一组里程碑交付。 |
| D2 | 电脑端给模型**完整 shell/文件/浏览器能力**，只在危险操作时审批。 |
| D3 | 旧治理文档整体归档，换精简版。 |
| D4 | **主力模型：本地 Qwen3.8 27B**。MiMo 只作测试与对照（同场景 MiMo 过、Qwen 不过 → 归为模型能力，不当代码 bug 追）。 |

## 3. 工作原则（写进新 AGENTS.md）

- **用 DSH，不重造**：工具、上下文压缩、子任务、调度、审批优先用 DSH 原生能力；WeftMate 只做账号、记忆、界面、跨端与本机执行。
- **契约先行**：所有客户端（桌面 Web UI、Android、macOS、iOS、Watch）只依赖 `/personal/v1` 客户端契约（`docs/CLIENT_API.md`）。改契约 = 改这一份文件 + 通知另一侧，向后兼容优先。
- **场景集是验收**：每个工作包完成时跑相关场景，结果写成表。不再为单个会话做 token 取证。
- **只为真实失败加限制**：没有出现过的失败，不加白名单、限次、guard、审计层。
- **小步提交**：一个工作包 = 一个分支（或一组提交），完成即提交；工作树不长期堆积未提交改动。
- **文档最少**：`AGENTS.md`（≤1 页）、`PLAN.md`（本文件）、`STATE.md`（≤1 页）、`CLIENT_API.md`、各模块 README。不写过程日记；证据放 `Runtime/`，文档只链接。

## 4. 分工与并行方式

| 轨道 | 执行 | 负责 |
|---|---|---|
| 核心（W-Core） | Codex · Windows | 个人宿主、DSH 接线、工具与审批、记忆接入、本地模型服务、场景集 |
| Windows/Android 端（W-UI） | Codex · Windows（同一个或第二个会话，文件不重叠） | 桌面 Web UI / Electron、Android 原生壳 |
| Apple 端（A-UI） | Codex · Mac | macOS、iOS、Apple Watch 原生客户端 |
| 规划与审查 | Claude | 路线、工作包卡、代码审查、场景结果判断 |

- 同一里程碑内三条轨道并行；W-Core 先出契约（或契约草案 + 假数据），两侧 UI 不等后端完成。
- 契约变更流程：W-Core 改 `CLIENT_API.md` 并在 `STATE.md`「契约变更」一栏记一行；A-UI / W-UI 下次开工先读这一栏。
- 交接：Codex 完成工作包后推送分支并开 PR 到 `main`，PR 描述写做了什么 / 怎么验证 / 遗留；同时更新 `STATE.md`。本人把 PR 链接交 Claude 审查，通过后合并。
- **Git 与 GitHub**：`memoweft/weftmate`（私有）是唯一主仓，五端代码都在里面（Apple 在 `apps/apple`）。Windows 与 Mac 各自 clone，按工作包开分支 `wp/<编号>-<短名>`，经 PR 合入 `main`；开工前先 `git pull` 拿最新 `main`。不再在本地复制目录或手工搬运代码。

## 5. 里程碑总览

| 里程碑 | 用户得到什么 | 预估 |
|---|---|---|
| **M0 重置** | 能稳定打开长会话、长任务不再空结束、有基线通过率、文档三份可开工 | 约 1 周 |
| **M1 自主办事（A）** | 在任一端提目标，电脑上的助手用通用工具自主完成，进度/审批/停止在各端可见可控 | 2–3 周 |
| **M2 同一个助手（B）** | 从日常对话形成和纠正理解；新对话、换模型仍然记得 | 约 2 周（可与 M1 后半并行） |
| **M3 同一现场（C）** | 各端接着聊接着做；Mac 也能作为执行设备；手机断网可独立对话、联网接回 | 2–3 周 |
| **M4 陪伴与精灵（D）** | 主动程度可调；精灵跨端；iOS/Watch 获准健康数据；完成震动 | 待 M3 后细化 |
| **M5 共同空间（E）** | 共养、共享对话与任务、退出后记得过去 | 待细化，开工前需本人确认退出规则 |

## 6. M0 重置（详细工作包）

### M0-1 现有改动落盘 · ✅ WeftMate 已完成（`1f922a5`）
- WeftMate 已 checkpoint 提交。其余仓库（AIGame、MemoWeft/Core、WeftLearn、DeepSeekHarness 本地修改）待同样处理。

### M0-1b 代码瘦身（原 C3）· W-Core
每项单独提交，删除前用 `grep`/测试确认无引用，删后 `npm run typecheck && npm run test:unit` 通过。
- **死代码**：`src/alpha2-electron-main.mjs`、`src/plugins/weftmate-alpha2-*` 及对应 `scripts/*alpha2*`、`package.json` 中 `dsh:alpha2*` 脚本——确认不在 `main.mjs` 加载链与打包中后删除。
- **一次性脚本**：`scripts/stage14r3-*`、`scripts/stage3-*` 与对应 `tests/stage14r3-*`、`tests/stage3-*` 移到 `scripts/archive/`（解开 `build-windows-candidate.mjs`、`windows-package-policy` 的依赖）。
- **测试/观测代码移出生产加载链**：`synthetic-*-fixture-policy.mjs`、`personal-model-observation/`（`stage14R2ObservationProfile`）由 `main.mjs` 直接加载；改为只在测试或显式开关下加载。
- **模型切换四层合一**：`route-mutation-journal`、`route-mutation-queue`、`model-mutation-transaction`、`model-profile-guard`、`stage2-session-guards` 评估合并为一个简单的「保存配置 → 重载路由」流程，保留真实需要的并发保护。
- **拆分 `src/personal-access/index.mjs`（6160 行）**：按 认证/设备、会话与历史、命令与任务、审批、成果、记忆代理 拆成模块；行为不变，测试不改断言。
- **仓库根杂物**：`TEMP/`、`test-output.txt` 删除；`tools/` 中仅测试用的预览/证据脚本移到 `tests/tools/` 或归档。
- 完成：`src` 不再引用任何 `stage*`/`alpha2`/`synthetic` 模块；`personal-access/index.mjs` < 1500 行；全部单测通过。

### M0-2 模型预算从实际服务读取 · W-Core
- 删除任何写死的 `contextWindow=32768 / maxTokens=8192`（见 CURRENT_STATE 10-07 预算记录）。
- `modelCapacityFor`（`src/harness-model-routes.ts`）：对 OpenAI 兼容的本地服务，优先读取服务端实际上下文（llama.cpp `/props` 的 `n_ctx` 或等价接口），读不到再用配置值；**未知模型默认值不得高于实际服务**。
- 输出预算按「上下文 − 已用 − 安全余量」动态计算，不固定。
- 完成：本地 Qwen 上跑一个需要 10+ 步工具调用的场景，不以 `max-tokens` 空结束；单测覆盖读取失败回退。

### M0-3 历史读取改正向分页 · W-Core + W-UI
- `src/runtime/dsh-adapter/sessions.mjs` `historyPage`：现在每页都从尾部倒扫最多 24×50 条，长会话必然 `history-window-limited`，且总成本 O(n²)。
- 改为：首屏只取**尾部最近 N 条**（向前翻页用 `beforeSeq`），增量用 `afterSeq` 正向取；不要求一次扫到会话开头。优先用 DSH `session-query` 若其已支持按 seq 范围读取。
- UI（`src/personal-access-ui/app.js` 约 2437 行起）：打开会话先显示最新内容，上滑加载更早历史；删除「请在电脑查看完整会话」提示路径。
- 完成：现存长会话 `session-6846f2c1-…` 在桌面与 Android 都能打开并看到最新回复；单测覆盖 2000+ 事件会话。

### M0-4 文档重置 · ✅ 已完成（Claude，2026-10-07）
- 旧文档、任务卡、证据移入 `docs/archive/2026-10-07/`；新 `AGENTS.md`、`README.md`、`docs/VISION.md`、`docs/STATE.md`、`docs/SETUP.md`。全局 `~/.codex/AGENTS.md` 已去掉「主助手不编码、必须派子 Agent」。

### M0-5 客户端契约文档 · W-Core（A-UI 审阅）
- 从现有 `/personal/v1`（`src/personal-access/index.mjs`、`src/personal-access-backend.mjs`）整理出 `docs/CLIENT_API.md`：认证/设备、会话列表、历史分页（按 M0-3 新语义）、发送消息、事件流、停止、审批、任务进度、成果下载、记忆、模型选择、版本更新。
- 每个接口：路径、请求、响应示例、错误码、哪些端已使用。
- Mac 侧 Codex 对照现有 Apple 客户端标出不一致与缺口，写进 `STATE.md` 契约栏。
- 完成：三条轨道都只引用这一份文档。

### M0-6 本地 Qwen 服务稳定 · W-Core
- 现状：8080 NInfer/MTP + 8081 切换代理，曾多次 OOM；WeftLearn 另有 18080 llama.cpp 92K 单槽配置。
- 定一个**唯一**日用启动方式（一个脚本、一个端口、一份参数），健康检查接口给 WeftMate 读；把 stage14r3 等一次性脚本移入 `scripts/archive/`。
- 单槽并发：标题生成、记忆形成等后台请求进队列，在主对话空闲时执行，不与主循环抢槽。
- 完成：重启电脑后一键起模型，WeftMate 显示就绪；连续 2 小时日用不 OOM。

### M0-7 场景评测集 · W-Core
- `eval/scenarios/*.yaml`：每条 = 目标文本 + 前置条件 + 检查方式（文件存在/内容包含/回复包含/记忆被采用/LLM 评判）。首批 12 条：
  - 办事 6：整理指定目录的文件；搜网页并总结成文档保存；读项目代码回答问题；多步：查资料→写脚本→运行→汇报；中途停止再继续；需要审批的删除操作（批准一次、拒绝一次）。
  - 记忆 4：告诉偏好→新对话里被采用；纠正一条理解→后续按纠正走；换模型后仍记得；提到某人→之后提到时能联系上。
  - 跨端 2：电脑发起、手机查看进度并审批；手机发起、电脑执行、手机看结果。
- `scripts/eval.mjs`：通过个人 API 驱动、隔离测试账号与数据目录、输出 Markdown 结果表；`--model qwen|mimo` 切换。
- 完成：Qwen 与 MiMo 各跑一次基线写入 `STATE.md`（预计 M0 时很多不过，这正是基线）。

### M0 Apple 轨道（并行）
- A-UI：对照 M0-5 草案核对 macOS/iOS/Watch 现有调用；接入 M0-3 新历史分页；构建可在真机安装。

## 7. M1 自主办事（A）

| 工作包 | 轨道 | 内容 | 完成标准 |
|---|---|---|---|
| M1-1 原生工具接入 | W-Core | `personal-remote` 预设直接启用 DSH 原生工具（bash/shell、读写文件、grep/glob、web_fetch、todo、subagent）；浏览器保留一个通用浏览器工具。删除 notepad、save_document 专用工具与 `MAX_*_CALLS_PER_TURN` 限次（`weftmate-personal-desktop-preset.mjs`）。成果保存改为「模型写文件 + 登记为成果」。 | 办事类 6 个场景用到的都是通用工具 |
| M1-2 统一审批策略 | W-Core | 一处策略：危险类（删除/覆盖用户文件、系统设置、安装软件、对外发送/发布、花钱）→ 审批；其余放行。用户可在设置里把某类改为「总是允许」。复用 DSH 审批机制，删各工具自带 guard。 | 审批场景：批准、拒绝、超时三路都正确；无多余弹窗 |
| M1-3 长任务 | W-Core | 接通 DSH `compaction`；`goal`/`todo` 让模型维持计划；Qwen 下工具描述精简、工具数量受控以保证调用准确。 | 10+ 步场景在 Qwen 上完成 |
| M1-4 停止与续做 | W-Core | 停止立即生效且回执清楚；同一对话里说「继续」能接着做，不重复已完成的副作用。 | 停止/继续场景通过 |
| M1-5 进度与结果呈现 | W-UI | 桌面与 Android：执行过程折叠展示（每步工具 + 简述）、审批卡片、停止按钮、成果卡片（打开/下载）。 | 两端走完办事场景无需看日志 |
| M1-6 Apple 端同步 | A-UI | macOS/iOS 同 M1-5；Watch：当前任务简进度、审批通知可直接批准/拒绝、完成震动。 | 三端走完「电脑执行、苹果端看进度并审批」 |
| M1-7 本人日用 | 本人 | 用 Qwen 日常使用一周，问题直接说。 | 本人认可 |

M1 出口：办事类场景 Qwen 通过 ≥ 4/6（MiMo 对照列出），跨端审批场景在 Android 与 iOS 各过一次。

## 8. M2 同一个助手（B）

| 工作包 | 轨道 | 内容 |
|---|---|---|
| M2-1 自动召回 | W-Core | 每轮前用 MemoWeft Recall 按当前消息召回，注入上下文（预算受 M0-2 约束）；不再需要手动「采用」。 |
| M2-2 自动形成 | W-Core | 对话结束或空闲时后台形成记忆（走 M0-6 队列，用本地 Qwen），不弹确认。 |
| M2-3 自然纠正 | W-Core | 用户在对话中纠正 → 形成 correction，旧理解失效；下一次行为改变。 |
| M2-4 经验复用 | W-Core | 完成过的任务做法（脚本/步骤）沉淀为可复用经验，下一次同类目标优先使用。 |
| M2-5 记忆页面 | W-UI + A-UI | 各端：查看「它记得什么、从哪来」、纠正、停用、删除。 |

M2 出口：记忆类 4 个场景 Qwen 通过 ≥ 3/4；账号间隔离单测保留。

## 9. M3–M5（M2 结束前细化成工作包）

- **M3 同一现场**：多执行宿主（Windows、Mac 都可作为执行设备，输入区选设备）；设备离线时的明确提示与接回；手机独立对话（手机直连模型/端侧模型），联网后合并；断线续传。
- **M4 陪伴与精灵**：主动程度设置；跨端精灵状态；iOS/Watch HealthKit 授权读取；约定提醒；无数据/撤权状态。
- **M5 共同空间**：共享对象与关系状态；开工前请本人确认：退出后共享对话的访问规则、共同任务收尾方式。

## 10. 现在不做

- 新的审计/证据/回执框架；为假设风险加的限制。
- 自研替代 DSH 已有能力的模块。
- 官网分发、自动更新的新功能（现有保持可用即可）。
- WeftLearn、AIGame 独立功能推进（AIGame 作为 WeftMod 仅在 M3 设备执行需要时接入）。
- 会员计费。

## 11. 需本人后续确认（不阻塞 M0/M1）

- M1 审批「危险类」清单是否需要增减。
- M3 手机独立工作用哪种模型（手机直连云模型 / 端侧小模型 / 连回家里 Qwen）。
- M5 退出规则。

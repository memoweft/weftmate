# EX-2 · M2 出口的可重复桌面验收

Windows-4，2026-10-09。验收依据是 `docs/PLAN.md` 第 8 节和 MemoWeft `PROJECT-MAP.md` 第 7 节的王小明八步。脚本通过 `_electron.launch` 启动真实 Electron（桌面程序框架）、个人宿主、固定 DSH（助手运行时）和真实 MemoWeft Core（记忆核心）。每批使用独立合成账号、随机端口和 `C:/Temp/weftmate-m2-exit-*` 下的 userData（应用数据目录）。没有直接种入记忆，没有修改产品代码，也不使用日用宿主数据。

## 检查定义

| 步骤 | 确定性通过条件 |
|---|---|
| ① 原话 | 在程序输入框发送完全相同的“王小明打游戏挺厉害，是我好兄弟。”；用户事件原文一致，非空回复，回合完成。 |
| ② 提议与确认 | 第一条回复主动提出以后组队找他／提醒，并带邀请确认语气；再在同一对话发送固定确认句，核对用户事件与完成状态。没有提议时仍发送确认以收集后续证据，但②保持失败。 |
| ③ 正式形成与来源 | 等待真实形成任务终态，按 `/personal/v1/memory/items` 分页读取四类正式记忆；检查当前人物、好兄弟关系、游戏评价和组队决定；每项通过正式来源接口找到对应完整用户原话。只出现在回复里、只出现在关系原话里而没有独立评价，均不能代替完整形成。保存只读 SQLite（嵌入式数据库）快照查询，包括形成任务结果，便于定位。 |
| ④ 改写与换模型 | 程序新建另一模型的会话；仅发送“我们之前说组队可以找谁？”，不复制旧背景。回复包含王小明，回合完成，`memoryUsed`（回复采用的记忆）指向③的正式相关条目。MiMo 与 LAN（局域网）`local-quality` 双向切换各验一次。 |
| ⑤ 自然纠正 | 新会话说“更正一下：王小明是我的表弟，不是好兄弟。以后组队还是找他。”；随后两个模型各开新会话询问关系与组队。两者回复采用最新表弟关系；旧好兄弟条目有失效时间、旧来源仍能查看；来源标为不再支持当前理解；正式取代链有原因并指向新关系；两模型都不采用旧条目。 |
| ⑥ 重启 | 完整退出宿主，复用同一隔离目录重新启动，随机端口重新发现、合成账号重新登录、测试密钥重新在内存中输入；核对新进程、当前正式关系、回复与采用标识。 |
| ⑦ 真正遗忘及导出 | 在记忆页打开正式条目并显示原文来源；对所有曾见到王小明事实的合成会话，逐个在程序确认框勾选“同时忘掉从这段对话形成的记忆”并永久删除。核对真实遗忘数量、会话和正式记忆清除；生成 BK-1 本地备份，用生产校验器解包；检查每个文件字节和数据库中不能恢复王小明；新会话既不采用记忆，也不回答姓名。专用记忆导出页面／接口目前没有，单独记录此缺口。不把保留聊天造成的恢复误报为记忆删除失败。 |
| ⑧ Core 故障 | 仅杀本次宿主拥有的真实 Python（编程语言）Core 子进程，同时让测试引导中的后续 Core 启动失败，持续模拟不可用。生产召回、错误处理与对话代码保持原样。核对状态不可用、普通问候非空完成、无记忆注入，以及对话页和记忆页的清楚提示。仅记忆页有提示时，普通对话可用子项仍记录，但整步不通过。 |

每项回复检查另记录可选 `llm_judge`（模型语义评判），复用现有 `scripts/eval.mjs` 的 `checkOne`，通过 `--judge-model same` 或 `--judge-model mimo` 启用。默认不另调用评判模型；未启用明确标为 skipped（跳过）。启用后评判失败也使对应步骤失败，同时保留所有确定性存储、来源及采用检查。本批未启用语义评判。

其余两项出口：

- 原始 `memory-01..04` 场景原文、检查和 600／900 秒总预算均不改。新隔离账号运行 LAN `local-quality`，仅原 `memory-03` 换到 MiMo；四个固定场景各计一次，passed（通过）≥3 才满足 3/4。留出场景不计入分母；unsupported（不支持）、缺失和重复均不增加通过数。
- 同一对话先创建 `triangle.py`、计算 n=8 得 36 并保存 `经验.md`，再自然要求用已有方法计算 n=12 得 78。第二次请求没有明说“复用脚本，不要重写”。记录 `step.started`（工具步骤开始）数量与从实际发送到回合终态的耗时；核对结果、运行命令与脚本内容未变。预先固定“明显更快”为少至少一个工具步骤，或第二次耗时≤第一次的80%。两次成功与实际复用均为必要条件。

## 基线结果

正式批次使用 WeftMate `0199ef148950e1322433ccbae1de318054895d1d`（开跑时 main）和 Core `ea1d9d11aca0f839c76026b89ec46c9f85d439fd`（主仓 main），没有使用 M2f 在途工作树。MiMo 八步 **1/8**、LAN 八步 **2/8**；原四场景 **4/4**，速度两组都通过。**M2 出口整体未通过**，不能以原四场景通过替代完整闭环。

| 八步 | MiMo 起始，换 LAN | LAN 起始，换 MiMo |
|---|---|---|
| ① 原话 | 通过，真实程序输入、事件原话一致、回合完成 | 通过 |
| ② 提议／确认 | 失败；未主动提议；确认后 `ask_user_question` 要求选定时频率，保存问题后取消 | 失败；未主动提议；用户确认回合完成 |
| ③ 四类理解／来源 | 失败；人物、关系有，独立评价和决定没有；人物直接来源为空 | 失败；人物、评价、决定有，正式好兄弟关系没有；人物直接来源为空 |
| ④ 改写／换模型 | 失败；LAN 完成但不知道组队对象，未采用相关记忆 | 失败；MiMo 多次查找文件，600 秒后仍未完成，无最终回复 |
| ⑤ 纠正／失效解释 | 失败；表弟已形成、旧关系有失效时间、两模型都采用最新关系；旧来源仍标当前，无正式取代原因链 | 失败；表弟已形成且两模型采用，但③未形成前项，无法证明前项失效与解释 |
| ⑥ 重启 | 失败；存储和采用仍是表弟，回答也写明表弟；组队部分再发澄清问题，回合未完成 | 通过；重启、存储、回复和采用均符合最新关系 |
| ⑦ 界面来源／遗忘／导出 | 失败；来源实际显示，勾选遗忘后删除接口 503，对话保留；关闭宿主后生产备份引擎补查仍可恢复姓名 | 失败；同样 503，来源已显示；关闭后备份补查也可恢复姓名 |
| ⑧ Core 故障 | 失败；真实 Core 子进程已停、状态不可用、普通问候回合完成且无记忆注入；记忆页有提示，对话页没有清楚提示 | 同左 |

原始结构化结果：[baseline-mimo.json](baseline-mimo.json)、[baseline-lan.json](baseline-lan.json)、[four-lan.json](four-lan.json)。截图：`mimo/lan-sources.png`、`mimo/lan-forget.png`、`mimo/lan-core-unavailable-chat.png`、`mimo/lan-core-unavailable-memory.png`。回复及完成状态取正式 `/personal/v1` 事件，截图只证明相应界面状态，不把终态后即时截图当作回复完整呈现的证明。

| 原四场景 | LAN 结果 | 总耗时 |
|---|---|---|
| memory-01-preference | 通过 | 68.424s |
| memory-02-correction | 通过 | 216.828s |
| memory-03-switch-model | 通过，LAN → MiMo | 75.428s |
| memory-04-person | 通过 | 127.503s |

| 同对话经验 | 第一次 → 第二次工具步数 | 第一次 → 第二次耗时 | 结论 |
|---|---|---|---|
| MiMo | 4 → 1 | 32.492s → 14.107s | 通过；少3步，耗时减少56.6% |
| LAN | 8 → 1 | 88.631s → 40.647s | 通过；少7步，耗时减少54.1% |

两次输出36／78都正确，第二次实际运行原 `triangle.py`，基线核对内容哈希未变和工具命令未重写；最终复跑脚本另核对修改时间未变。此处只证明所选三角数同类任务，不外推所有任务的速度。

开发运行也保留：[development-initial-mimo.json](development-initial-mimo.json) 只完成前三步、在 LAN 锁等待处终止；[development-full-mimo.json](development-full-mimo.json) 尝试八步，但⑦／⑧忘记先打开账户菜单，不能计为产品失败。第二次还保留了完整600秒定时频率问题等待。修正了测试密钥重启时的正式路由引用、账户菜单入口和字面检查把“不是好兄弟”误判成旧说法的问题，再跑上述正式批次。两次开发运行和未开始八步的 LAN 隔离根均计入费用／清理，未抹掉原始失败。

## 产品缺口和定位

1. **完整形成不稳定**：MiMo 把游戏评价并进关系原话，没有独立评价；确认引发定时频率提问而不是条件性的组队决定。LAN 形成评价／决定，遗漏关系。定位数据是③的正式条目与 `memory_world_job.model_result_json/world_result_json`；接入边界在 `src/plugins/weftmate-personal-memory.mjs`，模型解释／提交在 Core 的形成流水线。未改形成提示、测试原话或产品代码。
2. **人物页无可见来源**：两个模型形成的王小明实体 `sourceCount=0`，正式 entity 来源接口返回空；相关关系或评价仍能查原话。定位 `src/personal-memory/http.mjs` 的 `query_provenance` 映射和 Core 实体来源投影。
3. **纠正解释缺口**：MiMo 旧关系失效，但旧来源返回 `currentnessState=current`，界面同时出现“已失效／当前来源”；本基线未读到 `relationship_transitions` 的正式原因链。LAN 缺初始关系，不能验旧项失效。当前表弟采用与失效原因解释分开计，不把最新答案正确当作整步成功。
4. **改写召回／模型行为**：MiMo 起始时确认未完成，LAN 不知道组队对象；LAN 起始虽有组队决定，换 MiMo 后仍进入文件查找并超时。只能确认本闭环失败，不能从一次基线将全部归因为模型能力或纯召回实现；正式条目、采用标识、原生日志和请求时刻保留供 M2f 对比。
5. **重启后会话删除失败**：两组勾选遗忘后都返回503 `SERVICE_UNAVAILABLE`。LAN 测试引导仅观测异常栈，定位到 `src/personal-access/sessions.mjs:236` → `src/personal-access-backend.mjs:183` → `src/main.mjs:401` 的原生 DSH 删除请求失败；该层把非2xx概括成无 `.code` 的 `gateway request failed`，未观测到原生具体HTTP状态，不猜测最终根因。诊断见 [deletion-diagnostic.json](deletion-diagnostic.json)。
6. **不可恢复未达标／导出功能边界**：专用记忆导出页面／接口没有；BK-1备份引擎存在。由于删除失败，在线导出段被删除确认框阻断；离线补查在关闭的隔离宿主上调用同一生产备份引擎、完整校验并解包，两组均能从保留会话压缩日志、投影缓存、个人存储及Core数据库恢复王小明，见 [audit.json](audit.json)。这不是“已成功遗忘后仍泄漏”的证明；成功遗忘后的不可恢复仍须修复删除再复跑。最终脚本已改为失败时取消确认框、保留错误并继续实际在线导出检查。
7. **Core 故障的对话提示缺口**：普通问候事件为 completed（回合完成），无采用记忆；记忆页明确不可用，对话页无清楚提示。定位 `src/personal-memory/index.mjs` 的不可用状态与桌面会话呈现，未修UI（界面）。

Windows 导出补查首次使用过长暂存路径时 SQLite 拒绝打开目标；仅缩短测试导出目录绕过，生产备份代码未改。最终复跑脚本使用原子创建的短随机隔离根，以免把夹具路径长度算成产品失败。

定向检查 **8/8** 通过；覆盖后续 Zstandard（压缩格式）帧、JSON（结构化数据）转义／UTF-16（字符编码）导出的可恢复内容、纠正否定句、正式形成缺失、最新采用／旧项排除、速度前提、重复／缺失场景分母。6个隔离根实际文件扫描 **2056** 个，公开证据扫描0私密命中；已记录进程剩余0，测试凭据文件已清除，LAN锁已释放。未停止8081、未切换其他模型或停止共享服务。最终提交完整CI结果见 [PR #100](https://github.com/memoweft/weftmate/pull/100/checks)。

全包 MiMo **85** 个真实上游请求，**84** 笔有用量，**1** 笔取消时未返回用量；输入992,508 token（令牌），其中缓存544,192，输出14,401。按下方官方价目计算已知费用 **¥0.48800184，下界**；包含两次开发运行、正式八步、后台调用和四场景的MiMo对照。`usage.json`是正式批次小计，`audit.json`是含开发运行的全包合计。

## 复跑

```powershell
# 默认：MiMo 八步 + LAN 八步 + 独立 LAN 原四场景；每个八步后测速度。
node tests/integration/m2-exit-desktop.mjs --out C:/Temp/weftmate-m2-exit-replay

# 单独完整闭环（仍真实换到另一模型，仍需要 LAN 锁）：
node tests/integration/m2-exit-desktop.mjs --model mimo --out C:/Temp/weftmate-m2-exit-mimo-replay
node tests/integration/m2-exit-desktop.mjs --model lan --out C:/Temp/weftmate-m2-exit-lan-replay

# 单独原四场景统计：
node tests/integration/m2-exit-desktop.mjs --four --out C:/Temp/weftmate-m2-exit-four-replay

# 作为门禁使用；任一八步／速度／3-of-4（四项中三项）失败时退出码1：
node tests/integration/m2-exit-desktop.mjs --require-pass --out C:/Temp/weftmate-m2-exit-gate

# 可选语义评判及指定合入后的 Core 源码：
node tests/integration/m2-exit-desktop.mjs --judge-model mimo --memory-core-source D:/AIProjects/MemoWeft/Core/py/src --out C:/Temp/weftmate-m2-exit-after-m2f
node --test tests/integration/m2-exit-checks.test.mjs

# 完成或中断后的离线费用／凭据扫描（参数用该批打印的隔离根）：
node tests/integration/m2-exit-audit.mjs C:/Temp/weftmate-m2-exit-mimo-<id> C:/Temp/weftmate-m2-exit-lan-<id> --out C:/Temp/weftmate-m2-exit-replay
# 删除失败后，关闭宿主并用生产备份引擎补查导出：
node tests/integration/m2-exit-audit.mjs C:/Temp/weftmate-m2-exit-mimo-<id> --export-check --out C:/Temp/weftmate-m2-exit-replay
```

环境沿用本机已安装 Electron、固定 DSH 和 Core Python 虚拟环境；Core 默认路径可用 `--python`／`--memory-core-source` 覆盖。MiMo 密钥从 Machine（系统环境变量）读取；LAN 地址与密钥从 User（用户环境变量）读取，只留在父进程内。LAN 用既有串行桥接、只请求 `local-quality`；首次使用前原子创建编排目录的 `lan.lock`，已占用每五分钟尝试一次，期间不请求 LAN；取得后每分钟更新时间，完整批次结束即释放。没有请求8081、切换其他 LAN 模型或重启共享模型服务。

测试引导只提供观测和生命周期接缝：密钥保管库改成进程内 Map（映射）、请求时刻／用量和Core进程编号、HTTP（网络请求）失败栈观测、杀掉本宿主 Core 后阻止重新启动。正常记忆存储、模型请求、形成、召回、纠正、遗忘、备份和桌面界面均使用产品实现；错误观测不更改HTTP响应。完整产品测试交 PR（拉取请求）的 CI（持续集成）。

费用按 2026-10-09 核对的 [MiMo 官方价目](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)，缓存输入 ¥0.02、未缓存输入 ¥1、输出 ¥2／百万 token（令牌）计算。只统计真实 MiMo 上游请求，不重复计算本机调度代理；包含开发失败、中断、后台推理和正式批次。缺失用量单列，已知金额为下界，不能当账户账单。

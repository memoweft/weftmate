# MF-2 · 跨对话省略主题纠正

QA2-01 已在真实 Electron（桌面程序框架）/ DSH（助手运行时）/ MemoWeft Core（记忆核心）/ MiMo 中复现：第③轮实际注入只含阳台盆栽的 300 毫升，纠正原话没有进入请求。见 `before-mimo/memory-requests.jsonl` 与 `progress.json`。不是模型在已看到纠正的情况下选错值。

修复：Core 的近期原话桥接识别报大、作废、改到、写错、以……为准等纠正信号；跨会话按同账户最近四个接受回合、五分钟内的明确量纲/重复来源关联。唯一来源成对返回；多个候选整组返回并标明待确认，不根据当前问题挑选一个候选。沿用每组完整原话、四组/800字符和权限、遗忘边界。宿主将较早原话与随后纠正成对呈现，明确纠正优先于旧正式项。

五题及语义判据在运行前固定于 [fixture（固定题集）](../../fixtures/mf2-elliptical-corrections.json)，各批 `protocol.json` 保存相同 SHA-256（内容摘要）。每题独立合成账户，三段各为新对话；默认模式仅间隔一秒，不等待形成。等形成模式在下一轮前额外等后台接受回合结算。每批保存实际模型请求、Core 召回快照、逐回合回复和正式形成结果；不植入记忆、不代答。

`automaticPass` 只是无旧值提及的便捷筛选。若回复明确说旧值已作废，按固定语义判据单独裁定；不会因为正确解释了旧值就判错，也不会仅因包含新值就算通过。正式对象是否采用与回答是否正确分列。

运行器准备错误保留在 `before-mimo-five`（缺少场景 notes）、`before-mimo-default`（合成账号未使用评测要求的 eval- 前缀）；均未发起对话模型请求，不计入题目成绩。`initial-launch-argument-error` 保留原运行器参数错误后终止的额外请求用量，亦不计入记忆成绩。改前有效五题在 `before-mimo-default-valid` 和 `before-lan-default`。

| 新增五题 | 改前 | 改后回答 |
|---|---:|---:|
| MiMo 默认，不等形成 | 2/5 | 5/5 |
| LAN 默认，不等形成 | 2/5 | 5/5 |
| MiMo 等形成 | 未跑改前对照 | 5/5 |
| LAN 等形成 | 未跑改前对照 | 5/5 |

逐题原回复与裁定见 `adjudication.json`；实际注入、正式形成与当前项见 `injection-and-formation.json`。初次 MiMo 等形成批次的人名作业结算为 `no_change`，其回答仍靠近期原话。该原件保留；`name-formal-mimo-default` / `name-formal-mimo-settled` 的独立新账号复验才证明姓名已正式纠正。LAN 初次默认批次也有字段错误，保留首轮与重写；随后 `after-lan-settled` 五题均回答正确，人名正式 `name_corrected` 链成功。

形成侧按实证最小修复：数值纠正原已能形成 `correct` 链，未加新的推理或回答过滤层；人名识别原来漏了“人名／姓名……写错”，同时明确姓名纠正应是 `correct + alias`、用 `alias_of` 指旧姓名，不能带 `corrects_cognition_id`。继续用既有一次重写与原始检查点，解析器不猜字段、不更改模型返回内容。

真正遗忘见 `forget-pair/results.json`：真实宿主删除来源与观察对话后，新备份 **104 个文件 / 38 张表**，字节、Unicode（字符编码）文本、所有 Zstandard（压缩格式）帧及数据库文本均零命中；新对话回复不知道旧规定，实际召回上下文也没有 150／300。Core 专项还覆盖未完成形成时删除两条证据，确认原数据库字节与回放召回均不恢复。

原 MF-1 四题：MiMo **4/4**、LAN **4/4** 回答行为通过；各自三条原语义判据均通过，换模型题沿原检查。见 `four-mimo/direct-semantics.json`、`four-lan/direct-semantics.json`。原运行器的正式项要求和裁判入口 503 失败保留在原文件，近期原话不冒充正式对象。已修复运行器后续执行时的裁判路由，使其沿用 MF-1 的直接 MiMo 裁判；输入题目和判据完全不改。

王小明 MiMo→LAN **8/8**，见 `eight-mimo-to-lan/baseline-mimo.json`：原话、提议与确认、正式来源、换模型、自然纠正、重启、界面遗忘／新备份、Core 真进程停止与降级均通过。开发中未提交改动及排队前版本快照的口径见 `run-revision-notes.json`；不冒称整轮始终在一个无改动的提交上执行。

本地仅运行相关测试：Core 73 项、变更模块严格类型检查；宿主纠正／即时召回集成 5 项、类型检查。完整测试交 CI（持续集成）：Core 最终提交 **1,892 项通过、216 模块严格类型检查通过**，宿主检查以 [WeftMate PR #135](https://github.com/memoweft/weftmate/pull/135) 的最终提交为准；[Core PR #97](https://github.com/memoweft/memoweft/pull/97) 由 Claude squash（压缩合并），合入宿主前将 pin（固定提交）更新到 squash 提交。本包没有合并或部署。

MiMo 全包 **243 请求，239 笔有完整用量、4 笔缺用量**；输入 **479,900**、缓存 **240,000**、输出 **43,977 token（词元）**。按已核对的[官方价格](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)，已知费用下界 **¥0.332654**；含失败、取消、形成重写、裁判与复跑，缺用量不算免费，非账单。详见 `usage-total.json`，按实际外部请求去重，不重复计算宿主代理。

已清理进程：**10**（显式终止的精确 PID 数；其余由运行器正常关闭，未编造总数）。最终匹配残留 **0**、LAN 锁释放、未启动模拟器，见 `cleanup.json`。48 个合成根目录、11,509 个实际文件扫描，模型密钥／私有 LAN 地址 **0 命中**；跳过 vendor（依赖）符号链接。公开证据另有 `privacy-scan.json`，不含运行数据库、凭据或本机用户目录。未触碰日用18186、8081或 `Runtime/UnifiedAssistant` 数据。

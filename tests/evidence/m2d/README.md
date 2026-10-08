# M2d · 自然纠正与来源

2026-10-08，隔离 Electron（桌面程序框架）个人宿主、固定 DSH（执行框架）、真实 MemoWeft Core（记忆核心）。本地只请求 `http://127.0.0.1:8081/v1` / `qwen3.8-27b-original`；云端只请求官方 MiMo `mimo-v2.6-flash`。合成账号与运行目录在仓库外，密钥仅在进程中引用。

## 真实缺口与修复

修复前 MiMo 的 `memory-02` 已形成 `correct`（纠正），周三旧条目写入 `invalid_at`，来源仍在。但新条目原话为“现在固定空出来的是周五晚上……”时没有“锻炼”，第三轮锻炼问题没有找到它；`memoryUsed`（回复采用的记忆）只有此前的表达偏好，最终推荐周三。错误在召回，不能用“库里已经纠正”代替后续行为验收。

Core [PR #88](https://github.com/memoweft/memoweft/pull/88) 沿已有 `cognition_transitions` 找纠正前的主题。前项只作为检索线索，最终选中和注入的文本／标识都是有效的新条目。每个前项仍检查账号、来源权限、删除、归档和停用；支持连续纠正。普通检索未命中长问题时，从问题与短前项共有的非通用原文字词定位，不生成新事实、不调用模型、不加另一份存储。当前偏好问题排除已取代值；显式历史问题与“某人是谁”的既有身份查询保留“记忆（过往）”行为。

第一版取代链检索仍暴露第二个输入形态：模型只保留“最近只能周三晚上锻炼”这个短前项。原场景文字检查过了，第三轮却只采用表达偏好；重复的桌面演示同样未采用纠正项，来源断言拒绝通过。补上短主题的定向回归后才得到最终周五采用证据。首轮／中途结果完整保留在 [verification.json](verification.json)，没有用最终结果覆盖。

WeftMate [PR #61](https://github.com/memoweft/weftmate/pull/61) 继续通过既有真人回合边界交给 Core；模型提示说明 MemoWeft 自动处理偏好与自然纠正，避免模型仅为记住而另写工作区备忘文件。没有限制用户明确要求的文件任务，也没有修改审批模式。

## 验证

相关宿主测试 10/10；真实 Core 纠正、健康与待交付队列批次 4/4，随后纠正三种输入定向补验另列最终结果。覆盖时间改口、咖啡否定与偏好演进、旧来源保留、新会话只用新理解、采用新条目标识、重启后不回退。合成测试只替换模型解释，摄取、编译、原子取代、权限、来源与召回均是实际 Core；不直接写记忆数据库。

Core 定向批次 91/91、短主题／历史演进补验 39/39（有重叠），严格 mypy（Python 类型检查）通过。最新完整 CI（持续集成）**1,728/1,728**、203 模块严格类型检查及其他门禁通过。`npm run typecheck` 通过，WeftMate 完整测试只交 CI，最终检查见两份 PR。

原场景文件未改，目标、检查及 **memory-01 600 秒／memory-02 900 秒**总时限不变；可选 LLM judge（模型评判）未启用。附加程序演示与原场景分开记。

| 场景 | 修复前 Qwen / MiMo | 最终 Qwen / MiMo |
|---|---|---|
| memory-01 表达偏好 | 超时 600.63s / 通过 68.94s | 待最终记录 / **通过 60.87s** |
| memory-02 自然纠正 | 超时 900.59s / 失败 114.25s，第三轮未采用周五 | 待最终记录 / **通过 144.80s，第三轮采用周五纠正项** |

中途 MiMo 为 61.81s / 99.56s，原检查过；独立的纠正条目采用断言未过，不能算 M2d 通过。追加开放式游泳演示触发模型长工具链，604.61s 时主动停止隔离宿主；这是追加演示的取消，不是更改原场景时限。其调用、用量与失败也保留。

真实程序采用新的独立合成账号，**三段独立对话 39.24s 通过**：周二游泳偏好 → 新对话纠正周六 → 再开新对话提问。演示消息明确要求简短答复、不调用工具；原 memory-01/02 没加这些要求。第三轮回答“周六晚上可以游泳”；“用到了 1 条记忆”只指向有效的新说法，来源展示纠正原话。旧周二理解标记失效，旧、新原话都可查；浅／深色来源均通过，审批数 0。

![浅色：新对话回复与纠正来源](memory-source-light.png)

![深色：纠正来源](memory-source-dark.png)

M1-1d 后本次修复前与最终原场景均未观测到未声明审批；没有自动放行任何审批。Qwen 超时轮次仍如实记为运行中／未完成，不把“零审批”当作第三轮完成证明。

## 复跑与边界

```powershell
node tests/integration/personal-scenario-baseline.mjs --memory-loop --memory-correction --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2d-correction/py/src
node tests/integration/personal-scenario-baseline.mjs --memory-loop --memory-correction --mimo --mimo-machine --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2d-correction/py/src
# 只验三段独立对话的程序来源：
node tests/integration/personal-scenario-baseline.mjs --memory-loop --memory-correction --desktop-only --mimo --mimo-machine --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2d-correction/py/src
```

Core 主工作目录仍是 `main`，修改位于独立工作树。**Core 只能由 Claude squash（压缩合并）**；本仓 CI 暂时固定公开候选 `561eb090eb009ce07d16b00fc441eeb6cd808c8b`，合并 Core 后须更新为实际 squash 提交。客户端契约无变更。D16 的真正遗忘、完整八步记忆出口与长时间稳定性另包。

费用与最终清理记录待补齐：按[官方价目](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)缓存输入 ¥0.02、未缓存输入 ¥1、输出 ¥2／百万 token（令牌）计算，包含首轮诊断和追加演示全部实际调用，不是账户账单。所有公开证据只有合成事实检查、时刻、用量及数量，不含完整模型回复、真实账号、凭据或临时路径。未读日用保管库、未自起模型、未停止或重启 8080；结束保留 8081 模型。

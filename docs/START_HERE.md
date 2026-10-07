# 从这里理解 WeftMate（当前有效）

> 2026-10-06 当前阶段：执行路线落地与现有候选接管。当前依据是下列产品定义、五阶段路线、状态和任务15最新范围；文档落地不表示功能已实现，不自动恢复旧测试或发布队列。具体实施由总代理派明确工作包，已授权范围自主接续。

总代理负责总路线、上下文、用户决定、范围/依赖、分派与基于报告的产品一致性结论；实际 GPT-6.1 Sol 承担实现、排错、代码审查、测试、GUI（图形界面）技术验收及执行操作，含前端。实现者与独立验收者分开；总代理不接管卡住的执行、不替本人体验。详细规则只读 `AGENTS` 与 `DEVELOPMENT_LOOP`。

唯一阅读顺序为：`AGENTS → 本文件 → PROJECT_DIRECTION → CURRENT_STATE → CURRENT_STATE 指定的当前任务卡 → DEVELOPMENT_LOOP`。

| 要找的内容 | 当前依据 |
| --- | --- |
| 用户决定、产品目标、废弃设计与建议路线 | [PROJECT_DIRECTION](PROJECT_DIRECTION.md) |
| 既有桌面/安卓界面规划 | [FRONTEND_PLAN](FRONTEND_PLAN.md)；与最新定义/路线冲突的旧安排只作历史 |
| 实现进度、候选、证据与用户验收 | [CURRENT_STATE](CURRENT_STATE.md) |
| 正式接口/协议定位 | [ARCHITECTURE](ARCHITECTURE.md) |
| 协作归属 | [collab/README](D:/AIProjects/WeftMate/collab/README.md)；只用其 `FRONTEND.md`、`BACKEND.md` |
| 每轮交付、修复预算和停止 | [DEVELOPMENT_LOOP](DEVELOPMENT_LOOP.md) |
| 目录、数据、依赖与跨仓定位 | [REPOSITORY_LAYOUT](REPOSITORY_LAYOUT.md)、[DSH_UPGRADE_POLICY](DSH_UPGRADE_POLICY.md) |
| 历史决定和过程 | [DECISIONS](DECISIONS.md)、[WORKLOG](WORKLOG.md) |

文件职责不重叠：`PROJECT_DIRECTION` 管目标与当前路线，`CURRENT_STATE` 管真实进度，`ARCHITECTURE` 管契约索引，`collab` 管跨侧归属，`DECISIONS/WORKLOG` 管历史。普通对话和统一 Weave 界面保留；旧星球图谱已废弃。技术验收与本人体验分别记录，本人体验不是每阶段强制停止点。开工与恢复先读当前状态顶部及任务卡最新范围；历史按具体问题查证。

旧 S 阶段导航已由当前状态替代。2026-09-14 路线归并、2026-10-05 连续交付与 Apple 并行授权，以及旧主助手亲自前端/验收分工，仅作历史；其依据保留在 `PROJECT_DIRECTION`、`CURRENT_STATE` 与 `WORKLOG`，不作为当前开工队列。

便于转交的 2026-09-27 静态材料：[实施交接 Markdown](../../References/Deliverables/WeftMate_Codex_实施交接与产品体验基线_2026-09-27.md)、[实施交接 DOCX](../../References/Deliverables/WeftMate_Codex_实施交接与产品体验基线_2026-09-27.docx)。资料包含愿景、数据边界、每阶段 UI/后端/验收/不做项和旧资料核对限制；后续进度仍只更新现有 `CURRENT_STATE` 与任务卡，不另建日记或第二套治理文件。

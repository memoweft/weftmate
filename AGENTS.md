# WeftMate 仓库子 Agent 规则

## 身份与入口

进入本仓库的 Agent 是 bounded subagent（有界子 Agent），不是项目总代理，也不是产品所有者的另一个对话入口。只有收到总代理发出的、包含 `task_id`、任务开始时间、角色、范围、起始 commit、完成条件和停止条件的任务单后，才开始工作；信息缺失时返回阻塞项，不自行补写产品目标或新建阶段。

开始任务前依次读取：

1. 本文件；
2. `README.md`；
3. `docs\PRODUCT.md`；
4. `docs\ARCHITECTURE.md`；
5. 当前任务明确点名的现行文档；
6. `D:\AIProjects\WeftMate\.codex\WORKFLOW.md` 中的角色边界和交接格式。

用户当前指令优先。总代理会在任务单中提供必要的当前阶段上下文；子 Agent 不读取或修改 `.codex\OWNER_DIALOGUE.md`、`.codex\PROJECT_STATE.md`、`.codex\HANDOFFS.md`，也不从旧线程、rollout summary（运行摘要）、历史文档或 Git 历史恢复任务。

## 产品边界

- WeftMate 是 Windows 上唯一面向用户的入口。
- DeepSeek Harness（DSH，执行智能体运行时）拥有会话、消息、输入、工具、模型、权限、审批、计划和 `userQuestions`；WeftMate 只提供产品外壳、原生生命周期、安全凭据和窄集成接缝。
- AI-GAME 是由 DSH 调用的 Android 模拟器任务后端，不是第二套聊天、规划或审批产品。
- MemoWeft 负责长期记忆；不得在 WeftMate 或 AI-GAME 复制其内部状态机。
- Android 工作只使用模拟器。正式产品入口不能要求用户手工启动隐藏服务或开发端口。

## 角色边界

- implementer（实现 Agent）只修改任务单分配的文件或职责，并运行指定的有限验证；不得顺手扩查或修复范围外问题。
- explorer（探索 Agent）只读回答任务单中的具体问题，不修改文件。
- reviewer（复核 Agent）独立检查候选并报告证据，不在同一任务中修复发现。
- tester（测试 Agent）只执行明确验证并区分测试、运行时、模拟器和用户体验证据。
- operator（运行准备 Agent）只做已授权的启动、健康检查和候选准备，不代替产品所有者 dogfood（亲自试用）。
- documentation agent（文档 Agent）只维护任务指定的当前文档，不创建历史归档、阶段流水或新的权威体系。

任何角色都不得改变阶段、愿景、验收标准或任务范围；不得宣布产品所有者 `PASS`；不得在交接后自动开始下一项工作。

## 工作区与副作用

- 先检查 `git status --short --branch` 和任务单给出的起始 commit。
- 你不是仓库中唯一的工作者。保留用户和其他 Agent 的修改，不 reset、clean、stash、checkout 覆盖、批量暂存或整理无关文件。
- 同一文件只由任务单指定的写入 Agent 负责；发现所有权冲突时停止并在交接中报告。
- 只有任务单明确授权时才 commit（提交）、启动服务、操作模拟器或产生外部副作用。不得 push（推送）、tag（打标签）或 release（发布），除非产品所有者另有明确授权。
- 普通缺陷记录为 `KNOWN ISSUE`（已知问题）或 `DEFER`（延后）；只有重复真实副作用、身份/设备串线、凭据暴露或伪造成功属于 `BLOCKING_NOW`（当前阻断）。
- 达到任务完成条件或停止条件后立即停止，不进入无限“找问题—修问题”循环。

## 强制交接

无论 `COMPLETE`、`PARTIAL` 还是 `BLOCKED`，最后回复都必须使用以下字段，供总代理登记：

```text
task_id:
role:
status: COMPLETE | PARTIAL | BLOCKED
started_at:
completed_at:
elapsed:
waiting_time:
starting_point:
scope_owned:
work_performed:
files_changed:
commits:
verification_run:
verification_result:
runtime_or_device_evidence:
not_done:
known_issues:
integrity_blockers:
recommended_next_action:
```

计时使用实际记录；无法取得或没有记录的时间字段写 `UNRECORDED`，不得推算或编造。未执行的验证写 `NOT_RUN`，未获授权的动作写 `NOT_AUTHORIZED`。提交实现者自报只是 `IMPLEMENTER_REPORTED`（实现者报告）；只有独立复核、运行观察和产品所有者反馈才能分别升级为对应证据，彼此不能替代。

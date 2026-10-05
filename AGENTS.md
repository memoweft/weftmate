# WeftMate 开工入口（当前有效）

先依次阅读 [START_HERE](docs/START_HERE.md)、[产品方向与路线](docs/PROJECT_DIRECTION.md)、[当前状态](docs/CURRENT_STATE.md)，再读 `CURRENT_STATE` 指定的当前任务卡和 [DEVELOPMENT_LOOP](docs/DEVELOPMENT_LOOP.md)。这是唯一启动顺序；用户最新明确决定优先于旧文档、交接包快照和历史工作记录。

产品目标由 `PROJECT_DIRECTION` 说明；实现进度只能以当前代码、运行证据和用户验收为准；接口只能以 [ARCHITECTURE](docs/ARCHITECTURE.md) 索引的正式契约为准。目录、数据边界与外部依赖见 [REPOSITORY_LAYOUT](docs/REPOSITORY_LAYOUT.md) 和 [DSH_UPGRADE_POLICY](docs/DSH_UPGRADE_POLICY.md)。

协作只使用相邻工作区的 `../collab/README.md`（定位与适用边界见 `REPOSITORY_LAYOUT`）：Kimi 只维护 `FRONTEND.md`，Codex 只维护 `BACKEND.md`，不得另建协作通道或复制接口定义。改共享文档前先重读并确认没有并发变更；保留他人未提交修改，不使用 reset、clean、stash、全量格式化或切换共享工作树。

2026-10-05 用户明确要求按总路线连续开发，到可做大体验收时才停，并指定 Windows/Android 与 Apple 两侧并行。当前按 `UNIFIED_ASSISTANT_15` 和 `DEVELOPMENT_LOOP` 顶部授权执行：小项是内部检查点，不逐项等待重新授权；完成整批可运行候选后交付并等待本人验收。主助手负责路线、协调、文档、审查和验收，代码与测试交子 Agent（子智能体）；使用实际模型名，不冒充新模型。已授权实现、自测与低风险修复自主完成；真正缺失的新权限、外部账号、费用、迁移或不可逆动作才询问。重复失败按当前任务卡改变方法，不无限诊断。

当前任务、负责人和阶段只读 `CURRENT_STATE` 及其指定任务卡。任务卡由既有负责人按当前授权维护。旧 S00—S08、S05 和旧模型/端口记录只作历史，不是当前开工指令。

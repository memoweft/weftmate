# WeftMate 开工入口（当前有效）

先依次阅读 [START_HERE](docs/START_HERE.md)、[产品方向与路线](docs/PROJECT_DIRECTION.md)、[当前状态](docs/CURRENT_STATE.md)，再读 `CURRENT_STATE` 指定的当前任务卡和 [DEVELOPMENT_LOOP](docs/DEVELOPMENT_LOOP.md)。这是唯一启动顺序；用户最新明确决定优先于旧文档、交接包快照和历史工作记录。

产品目标由 `PROJECT_DIRECTION` 说明；实现进度只能以当前代码、运行证据和用户验收为准；接口只能以 [ARCHITECTURE](docs/ARCHITECTURE.md) 索引的正式契约为准。目录、数据边界与外部依赖见 [REPOSITORY_LAYOUT](docs/REPOSITORY_LAYOUT.md) 和 [DSH_UPGRADE_POLICY](docs/DSH_UPGRADE_POLICY.md)。

协作只使用相邻工作区的 `../collab/README.md`（定位与适用边界见 `REPOSITORY_LAYOUT`）：Kimi 只维护 `FRONTEND.md`，Codex 只维护 `BACKEND.md`，不得另建协作通道或复制接口定义。改共享文档前先重读并确认没有并发变更；保留他人未提交修改，不使用 reset、clean、stash、全量格式化或切换共享工作树。

每轮按 `DEVELOPMENT_LOOP`：开发检查 → 固定可试用候选 → 交付后标记“待云验证”并停下 → 收到明确反馈只修本轮 → 用户明确通过才记通过。下一阶段必须有新的明确指令。已授权范围内的日常实现、自测和低风险修复可自主完成；涉及新权限、账号、费用、数据迁移、不可逆动作或扩大范围时才询问。遇到重复修复，先在任务卡声明修复预算和停止条件。

当前任务、负责人和阶段只读 `CURRENT_STATE` 及其指定任务卡。任务卡由既有负责人按当前授权维护。旧 S00—S08、S05 和旧模型/端口记录只作历史，不是当前开工指令。

# WeftMate

WeftMate 的目标是各种设备上统一的 AI Agent（智能体）助手：同一账户下接续对话与任务，使用设备能力、共享记忆和可维护的业务 Mod（扩展模块），并按约定持续跟进。Windows 与安卓先行，各端采用“织语 Weave”统一界面。当前已实现、待接入和未来能力分别以路线、代码、运行证据及用户验收说明。

新接手者从 [AGENTS](AGENTS.md) 开始：`AGENTS → START_HERE → PROJECT_DIRECTION → CURRENT_STATE → 当前任务卡 → DEVELOPMENT_LOOP`。

- [START_HERE](docs/START_HERE.md) 汇总准确阅读入口与文件职责。
- [PROJECT_DIRECTION](docs/PROJECT_DIRECTION.md) 是产品目标、完整能力规划、统一界面归属和依赖路线。
- [CURRENT_STATE](docs/CURRENT_STATE.md) 是唯一动态进度入口；规则归并已获用户接受，后续实施按其中的当前任务推进。
- [ARCHITECTURE](docs/ARCHITECTURE.md) 只索引正式接口依据；[REPOSITORY_LAYOUT](docs/REPOSITORY_LAYOUT.md) 说明仓库、数据和协作归属。
- [DEVELOPMENT_LOOP](docs/DEVELOPMENT_LOOP.md) 规定开发、运行验证与用户验收；本次合并优化按用户最新持续授权执行，具体范围见当前状态。
- [安卓客户端](apps/android/README.md) 说明原生应用的当前能力、构建与验证；安装候选和试用入口仍以当前任务卡为准。

唯一跨侧协作入口是相邻工作区的 `../collab/README.md`；Kimi 的前端记录在 `FRONTEND.md`，Codex 的后端记录在 `BACKEND.md`。本仓库不复制它们的状态或契约。

规则归并与后续功能实施分别记录在 [WORKLOG](docs/WORKLOG.md)，实际结果只看当前状态。运行和恢复操作按 [SETUP](docs/SETUP.md)；`python scripts/check-project-layout.py` 只检查仓库内文档与布局。

## 许可证

WeftMate 自有代码、二进制、视觉资产和文档遵循本仓库 LICENSE；DSH、MemoWeft、WeftMod 及其他依赖分别遵循其自身许可证。

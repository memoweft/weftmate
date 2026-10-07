# WeftMate · Agent 工作说明

WeftMate 是跨设备、跨对话的个人 AI 助手（Windows / macOS / Android / iOS / Apple Watch）。愿景见 [docs/VISION.md](docs/VISION.md)。

## 开工

1. 读 [docs/PLAN.md](docs/PLAN.md)（路线与工作包）和 [docs/STATE.md](docs/STATE.md)（现在做到哪）。
2. 找到分给你的工作包，直接开始。环境与命令见 [docs/SETUP.md](docs/SETUP.md)；做前端先读 [docs/UI_SPEC.md](docs/UI_SPEC.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `src/` | Electron 主进程、个人宿主（`personal-*`）、DSH 插件（`plugins/`）、网关（`runtime/`） |
| `src/personal-access-ui/` | 桌面 / 浏览器端 Web 界面 |
| `apps/android/` | Android 原生壳 |
| `apps/apple/` | macOS / iOS / watchOS 原生客户端 |
| `apps/mobile-ui/` | 手机端可更新的 Web 界面 |
| `tests/` | 单元与集成测试 |
| `docs/archive/` | 历史文档，只在查具体旧决定时看 |

## 规则

- **直接做**：读代码、改代码、跑测试、提交，都由你完成。日常技术选择自己决定。
- **用 DSH，不重造**：工具、上下文压缩、子任务、调度、审批优先用 DSH 原生能力。
- **只为真实问题加限制**：没出现过的失败，不加白名单、限次、guard 或审计层。
- **契约**：客户端只依赖 `/personal/v1`（`docs/CLIENT_API.md`）。改了接口，在 `docs/STATE.md` 的「契约变更」记一行。
- **测试**：跑与改动相关的测试和场景（`npm run test:unit` 可按文件过滤）。测试用隔离数据目录和测试账号，不碰本人日用数据（`D:\AIProjects\WeftMate\Runtime`）。
- **Git**：一个工作包一个分支（`wp/<编号>-<短名>`），完成即提交并推送到 GitHub，开 PR 到 `main`。不改写已推送的历史。不提交凭据、`.env`、证书或运行数据。
- **完成时**：把 `docs/STATE.md` 对应行更新为最新（整页覆盖，不追加日记），在 PR 描述里写：做了什么、怎么验证的、还有什么没做。
- **需要本人决定的**（新增权限、花钱、删除用户数据、产品取舍）：停下来在 PR 或对话里提出，其余不用问。

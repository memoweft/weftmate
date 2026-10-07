# WeftMate · Agent 工作说明

WeftMate 是跨设备、跨对话的个人 AI 助手（Windows / macOS / Android / iOS / Apple Watch）。愿景见 [docs/VISION.md](docs/VISION.md)。

## 开工

1. 读 [docs/PLAN.md](docs/PLAN.md)（路线与工作包）和 [docs/STATE.md](docs/STATE.md)（现在做到哪）。
2. 找到分给你的工作包，直接开始。环境与命令见 [docs/SETUP.md](docs/SETUP.md)；做前端先读 [docs/UI_SPEC.md](docs/UI_SPEC.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `src/` | Electron 主进程（Windows 桌面程序）、个人宿主（`personal-*`）、DSH 插件（`plugins/`）、网关（`runtime/`） |
| `src/personal-access-ui/` | WeftMate 界面：Windows 桌面程序窗口（主）与远程浏览器共用 |
| `apps/android/` | Android 原生壳 |
| `apps/apple/` | macOS / iOS / watchOS 原生客户端 |
| `apps/mobile-ui/` | 手机端可更新的 Web 界面 |
| `tests/` | 单元与集成测试 |
| `docs/archive/` | 历史文档，只在查具体旧决定时看 |

## 规则

- **直接做**：读代码、改代码、跑测试、提交，都由你完成。日常技术选择自己决定。
- **用 DSH，不重造**：工具、上下文压缩、子任务、调度、审批优先用 DSH 原生能力。
- **桌面以程序为主**（D27）：Windows 桌面是 WeftMate 程序（Electron 窗口），macOS 是原生 App；浏览器网页只用于手机和其他电脑远程访问。前端改动在真实程序里验收（Playwright 可直接驱动 Electron），不要只在浏览器里验证。
- **只为真实问题加限制**：没出现过的失败，不加白名单、限次、guard 或审计层。
- **契约**：客户端只依赖 `/personal/v1`（`docs/CLIENT_API.md`）。改了接口，在 `docs/STATE.md` 的「契约变更」记一行。
- **测试**：开发中只跑与改动相关的测试（`node --test <文件>`、单个 Swift 测试 / 单个 scheme）。**完整测试交给 CI**：推送后用 `gh pr checks` / `gh run watch` 看结果，不在本地反复跑全量单测。测试用隔离数据目录和测试账号，不碰本人日用数据（`D:\AIProjects\WeftMate\Runtime`）。
- **节奏**：一个工作包只做一件事，目标 1–2 小时内开 PR。长时间的稳定性 / 浸泡测试不放进开发包，另列。遇到环境问题（文件被占用、依赖缺失）先换最简单的绕法，别为它在隔离目录重建整套环境。
- **Git**：一个工作包一个分支（`wp/<编号>-<短名>`），完成即提交并推送到 GitHub，开 PR 到 `main`。不改写已推送的历史。不提交凭据、`.env`、证书或运行数据。
- **完成时**：把 `docs/STATE.md` 对应行更新为最新（整页覆盖，不追加日记），在 PR 描述里写：做了什么、怎么验证的、还有什么没做。
- **需要本人决定的**（新增权限、花钱、删除用户数据、产品取舍）：停下来在 PR 或对话里提出，其余不用问。

# WeftMate 项目地图

新会话从这一页开始。它只回答：这是什么、现在做什么、改哪一块看哪里。工作规矩见 [AGENTS.md](AGENTS.md)。

## 这是什么

围绕同一个人的 AI 助手。Windows 桌面程序是大脑：聊天、让电脑办事、形成和管理记忆（MemoWeft）。安卓、iPhone、手表是窗口：能单独聊天，存原话，读电脑同步来的记忆。一台轻量云服务器只管账号、连接和密文暂存，看不到内容。愿景见 [docs/VISION.md](docs/VISION.md)。

## 现在做什么（2026-10-30 收口与交接）

- **阶段**：交接前收口。暂停新功能、暂停旧 PR 续修、暂停自动发布；先清理执行规则、任务包、工作树和当前状态。
- **代码主线**：`main` = `08254179ab563b02bfaec9f3b2a0f27264d65c89`，最新 main CI 全绿。
- **已发布基线**：程序/界面 `0.2.0-preview.27`，标签 `v0.2.0-preview.27` = `d53202d9d`。
- **未发布差异**：main 在 preview.27 之后只多了 #758 的界面修复；UI28/后续发布任务暂停，不自动续跑。
- **交接**：2026-10-31 15:00（Asia/Shanghai）交给 Claude；私有交接页在 `Runtime/Orchestrator/HANDOFF-2026-10-31-1500.md`。
- **暂停中的 PR**：#716、#718、#723、#724（iOS）。没有本人新指令，不合并、不续跑、不重开。
- **执行原则**：小修走快速通道；不因怕漏而跑全量、做多轮审查或擅自扩项。详见 [AGENTS.md](AGENTS.md) 和 [docs/PLAN.md](docs/PLAN.md)。

## 分区：改哪一块，看哪里

一次只读要改的那一块的文档，然后读代码。

| 分区 | 代码入口 | 先读 |
|---|---|---|
| 桌面宿主：启动、窗口、托盘、执行、更新 | `src/main.mjs`、`host-mode.mjs`、`personal-desktop.mjs`、`personal-access-backend.mjs` → `src/runtime/`；DSH 进程 `dsh-web-runtime.ts`；更新 `src/personal-update/` | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 界面：桌面与手机网页共用 | 页面 `src/personal-access-ui/`；共用状态与动作 `src/ui-core/`；手机网页 `apps/mobile-ui/`；设计令牌与图标 `design/` | `src/personal-access-ui/README.md`，然后直接读代码 |
| 记忆 | `src/plugins/weftmate-personal-memory.mjs` → `src/personal-access/memory-ingestion.mjs` → `src/personal-memory/` → MemoWeft Core；随包运行时 `scripts/memory-runtime/` | [docs/MEMORY.md](docs/MEMORY.md) |
| 手机与同步 | 安卓 `apps/android/`；手机离线引擎 `src/ui-core/offline.js`；电脑一侧 `src/personal-offline/`、`src/personal-sync/`、`src/personal-access/history-import.mjs` | [docs/ANDROID_NATIVE.md](docs/ANDROID_NATIVE.md) |
| 宿主接口、云与中继 | `/personal/v1`：`src/personal-access/index.mjs`、`http.mjs`；`src/personal-cloud/`、`personal-relay/`；云服务 `services/cloud/` | 读路由代码 |
| 发布 | `scripts/release/`、`scripts/build-mobile-ui.mjs`；官网 `site/` | [docs/WINDOWS_RELEASE.md](docs/WINDOWS_RELEASE.md)；暂停期间不要自行发布 |
| 开发环境与 DSH | `package.json`；DSH 固定在 `tests/contract/dsh-pin.json`，生成到 `vendor/dsh-runtime/` | [docs/SETUP.md](docs/SETUP.md)、[docs/VENDOR-PACKAGING.md](docs/VENDOR-PACKAGING.md) |
| 苹果三端（冻结） | `apps/apple/` | 暂停期间不续跑 |

## 依赖

- **MemoWeft Core**：独立仓库 `memoweft/memoweft`；固定版本在 `scripts/memory-runtime/lock.json` 和 `.github/workflows/ci.yml` 的 `observed-core`。内核问题在内核修，合进它的主线后再换这里的版本。
- **DSH**：工具、压缩、子任务、调度、审批都用它自带的。

## 状态去哪查

| 想知道 | 看哪里 |
|---|---|
| 谁在做什么 | GitHub `memoweft/weftmate` 打开的 PR；暂停项见交接页 |
| 本人日用碰到的问题 | GitHub Issues |
| main 绿不绿 | main 最新一次 CI |
| 发出去的版本 | weftmate.com 的更新目录和下载页 |
| 已归档的任务与证据 | `Runtime/Orchestrator/_archive/2026-10-30/`；只当历史看 |

## 维护这一页

分区、入口或当前步骤变了，在同一个 PR 改这一页。只写现在，过程和旧结果交给 Git 标签和编排目录归档。

# WeftMate 项目地图

新会话从这一页开始。它只回答三件事：这是什么、现在做什么、改哪一块该看哪里。怎么干活见 [AGENTS.md](AGENTS.md)。

## 这是什么

围绕同一个人的 AI 助手。Windows 桌面程序是大脑：聊天、让电脑办事、形成和管理记忆（MemoWeft）。安卓、iPhone、手表是窗口：能单独聊天，存原话，读电脑同步来的记忆。一台轻量云服务器只管账号、连接和密文暂存，看不到内容。愿景见 [docs/VISION.md](docs/VISION.md)。

## 现在做什么

- **当前步骤**：[docs/PLAN.md](docs/PLAN.md) 第 1 节（2026-10-26 起：安卓做成窗口）。
- **本人提的改动**：[docs/OWNER_CHANGES.md](docs/OWNER_CHANGES.md)。**本人定下的产品规则**：[docs/DECISIONS.md](docs/DECISIONS.md)，按分区查对应那一节。
- **Windows 聊天 + 记忆**：本人日用中（程序 0.2.0-preview.17、界面 0.2.0-preview.18），碰到问题照修。
- **冻结**：PLAN 第 4 节列的功能，代码留着，本人用到再修。

## 分区：改哪一块，看哪里

一次只读要改的那一块的文档，然后读代码。

| 分区 | 代码入口 | 先读 |
|---|---|---|
| 桌面宿主：启动、窗口、托盘、执行、更新 | `src/main.mjs`、`host-mode.mjs`、`personal-desktop.mjs`、`personal-access-backend.mjs` → `src/runtime/`；DSH 进程 `dsh-web-runtime.ts`；更新 `src/personal-update/` | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 界面：桌面与手机网页共用 | 页面 `src/personal-access-ui/`；共用状态与动作 `src/ui-core/`；手机网页 `apps/mobile-ui/`（`www/ui-core/` 由 `build-ui-core.mjs` 生成）；设计令牌与图标 `design/` | [工作区与面板](src/personal-access-ui/README.md)，然后直接读代码；颜色动效只从 `design/tokens/` 取 |
| 记忆 | `src/plugins/weftmate-personal-memory.mjs` → `src/personal-access/memory-ingestion.mjs` → `src/personal-memory/` → MemoWeft Core；随包运行时 `scripts/memory-runtime/` | [docs/MEMORY.md](docs/MEMORY.md) |
| 手机与同步 | 安卓 `apps/android/`（`NativeActivity` 原生入口，聊天经隐藏网页调 `WeftPhone`）；手机离线引擎 `src/ui-core/offline.js`；电脑一侧 `src/personal-offline/`、`src/personal-sync/`、`src/personal-access/history-import.mjs` | [docs/ANDROID_NATIVE.md](docs/ANDROID_NATIVE.md) |
| 宿主接口、云与中继 | `/personal/v1`：`src/personal-access/index.mjs` 组装、`http.mjs` 分发全部路由；`src/personal-cloud/`、`personal-relay/`；云服务 `services/cloud/` | 读路由代码 |
| 发布 | `scripts/release/`、`scripts/build-mobile-ui.mjs`；官网 `site/` | [docs/WINDOWS_RELEASE.md](docs/WINDOWS_RELEASE.md) |
| 开发环境与 DSH | `package.json`；DSH 固定在 `tests/contract/dsh-pin.json`，生成到 `vendor/dsh-runtime/` | [docs/SETUP.md](docs/SETUP.md)、[docs/VENDOR-PACKAGING.md](docs/VENDOR-PACKAGING.md) |
| 苹果三端（冻结） | `apps/apple/` | — |

## 依赖

- **MemoWeft Core**：独立仓库 `memoweft/memoweft`，同样由总代理维护。WeftMate 用的固定版本在 `scripts/memory-runtime/lock.json` 和 `.github/workflows/ci.yml` 的 `observed-core`；内核的问题在内核修，合进它的主线后再换这里的版本。
- **DSH**：工具、压缩、子任务、调度、审批都用它自带的。

## 状态去哪查

| 想知道 | 看哪里 |
|---|---|
| 谁在做什么 | GitHub `memoweft/weftmate` 打开的 PR |
| 本人日用碰到的问题 | GitHub Issues |
| main 绿不绿 | main 最新一次 CI |
| 发出去的版本 | weftmate.com 的更新目录和下载页 |
| 完成的阶段、归档的旧文档 | Git 标签 `done/*`、`archive/*`（`git show archive/2026-10-26:docs/<文件>`） |

## 维护这一页

分区、入口或当前步骤变了，在同一个 PR 改这一页。只写现在，过程和旧结果交给 Git 标签。

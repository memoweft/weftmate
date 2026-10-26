# WeftMate 项目地图

新会话先读（D102）。只记目标、有效判断、能力层级、代码入口和状态查询位置；注明出处或日期，无证据写「未知」。

## 1. 这是什么

围绕同一个人、同一个账号的 AI 助手：Windows 桌面程序、安卓、iPhone、Apple Watch、macOS，加一台轻量云服务器。换设备、换对话、换模型，面对的都是同一个 WeftMate；它能用电脑办事，也越用越懂你。愿景见 [docs/VISION.md](docs/VISION.md)，全部决定见 [docs/DECISIONS.md](docs/DECISIONS.md)。

## 2. 现在做什么

- **2026-10-24 收窄**（D118–D122，优先于旧规矩和旧决定）：先做本人自己天天用的 Windows 聊天 + 记忆。三步（收摊 → 记忆换新做法 D120 → 本人日用）已完成，本人 2026-10-26 说「用的差不多了没什么大问题了」。见 [docs/PLAN.md](docs/PLAN.md)，规矩见 [AGENTS.md](AGENTS.md)。
- **现在：安卓做成窗口**（D119，2026-10-26 开始）：去掉手机自己的轻量记忆，改成存原话、读电脑同步来的记忆；之后 iPhone → 手表。Windows 继续本人日用，碰到问题照修。
- **其他功能冻结**：代码保留，不修不测（PLAN 第 4 节）。
- **前端已整体重做**（D123、D124）：2026-10-26 #677 全部页面重排、连续过渡，#679 一轮回复从发送起只有一个过程行；本人日用认可。
- **更新**：Windows 预览通道按用户安装、后台下载、装完自动重开；只改界面的修复只推界面包热更新，改到程序本体才发完整安装包。
- **分工**：本机 Claude 为总代理，派 Codex 执行（D112）；记忆也由总代理派包（D108）。

## 3. 实时状态去哪查

实时状态**不抄进文档**，用时现查：

| 想知道 | 去哪看 |
|---|---|
| 做到哪一步 | [docs/PLAN.md](docs/PLAN.md) 第 1 节 |
| 在做什么、谁在做 | GitHub `memoweft/weftmate` 上打开的 PR |
| 本人日用碰到的问题 | GitHub Issues 里 2026-10-24 以后新开的单；更早的旧单不再逐条看 |
| main 是不是绿的 | main 最新一次 CI |
| 发出去的版本 | 官网下载页与发布清单 |

## 4. 各项做到哪一步

到哪一步：**代码已合并** → **已打进安装包** → **本人用过认可**（AGENTS「做完与文档」）。**Windows 聊天 + 记忆：本人用过认可**（2026-10-26，程序 `0.2.0-preview.17`、界面 `0.2.0-preview.18`）；其他各项都还没到这一步。

最后一轮按旧场景表的候选包验收（2026-10-22，源码 `a410bd9d`，Windows `0.1.1-preview.102201`、安卓 `0.8.49/code62`）：Windows 25 项过 18，聊天问事、让电脑干活大多通过，没过的是离线交任务和记忆（改口、记忆页删除、手机记的事电脑知道、对话里忘掉）；安卓 27 项过 19。之后不再整轮跑（D118）。

已有代码能力（未逐项安装验收）：

- **Windows 桌面**：自配模型；对话/工作（D92）、项目、附件、流式、排队、引导、审批、提问；文件、命令、浏览器、子任务及成果展示；记忆形成/召回/纠正/遗忘；临时对话、历史导入、定时任务、动态、目标、成果库、更新、加密备份、诊断、用量、设置。
- **安卓**：原生聊天、侧栏、输入区、目标、动态、成果库、模型服务，部分仍为网页；独立配云模型聊天（D61），连电脑交任务/批准/看成果；离线任务、记忆副本、文件预览；运行时接通知，后台补发可能延迟（D41）。
- **iPhone / 手表 / macOS**：原生对话、审批、记忆、设置、离线聊天、本机提醒；iPhone 接 HealthKit，手表看投影/提醒，Mac 试用版带运行时。免费签名（D38）；本人 iPhone、手表未装（2026-10-14）。
- **云服务**：账号、邮箱验证、设备目录、中继、离线任务暂存、加密备份接口。
- **记忆**：Windows 默认完整语义层（D106、D110），无显式配置时自动接入随包 Python/Core；详见 [组件说明](scripts/memory-runtime/README.md)、[docs/MEMORY.md](docs/MEMORY.md)。

## 5. 已知的大缺口

- **记忆用的是 E2 内核**（D120）：MemoWeft #143 已合入 `1f01aaa1a44524f7c9b9e851a8f2ca106ac3ec67`，WeftMate 的 CI 和随包清单固定此版，0.2.0-preview.12 起随安装包日用；形成按原则判断，召回语义优先并附本人档案和原话，宿主保留 `evidence` 来源依赖供遗忘级联。剩余形成短板先不追；MemoWeft #144（召回门槛改回 0.87）等本人定。
- **现在有三套记忆**：电脑上的 MemoWeft、安卓和手机网页自己的轻量记忆（[PHONE_MEMORY.md](docs/PHONE_MEMORY.md)）、苹果端的一套；跨端的记忆失败大多出在它们之间对不齐。按 D119 只留电脑一套，安卓阶段去掉手机那套。
- **CI 有偶发失败**：直接重跑，不追（D121）；同一条连续三次挡合并才修。
- **三套客户端技术栈**：网页共用层（`src/ui-core/`，桌面、手机网页、安卓网页部分共用）、安卓 Kotlin、苹果 Swift。改 `src/ui-core/` 会影响手机网页，要重新生成（AGENTS）。
- **自动办事的真实模型表现不稳定**：复杂审批、多轮和长任务，不能只凭合成测试说可靠。
- **苹果端没有推送和 TestFlight**（D38、D47）；安卓进程被挂起后通知会延迟（D41）。
- **大文件**：`src/main.mjs`、`src/dsh-web-runtime.ts`、`src/personal-access/http.mjs`、安卓 `HybridActivity.kt`、苹果 `AppleAppModel.swift`。改到哪里就按职责拆哪里，不整文件重写。
- **仓库里还有约 300MB 苹果端证据**（`apps/apple/Tests/Evidence/`），有两个脚本在读，迁走输入之前不能删（`later`）。
- 精灵陪伴、共同空间、公开发布等已冻结（PLAN 第 4 节）。

## 6. 接手时要保留的判断

| 判断 | 现行口径 |
|---|---|
| 同一个助手 | 换对话、换模型、换设备都不用重新介绍自己；账户之间完全隔离（D80） |
| 产品结构 | 「对话／工作」两种模式（D92）：对话不动电脑；工作绑定一台电脑和一个文件夹，原审批照常生效 |
| 旧主对话 | 取消置顶和旁聊菜单，手机历史只读；`kind:main`、`/chats/main`、历史分段及后台投递目的地为旧端兼容保留，不能随界面入口删除 |
| 模型与运行时 | 模型由用户自带（D45）；DSH 提供通用工具、压缩、子任务、调度和审批，优先用它自带的（D2、D87）；WeftMate 组合账号、记忆、界面、设备与权限 |
| 记忆 | 一个大脑、多个窗口（D119）：只有电脑上的 MemoWeft 形成、召回、纠正、遗忘；其他端存原话、读同步来的记忆。手机轻量记忆是旧做法，安卓阶段去掉 |
| 删除语义 | 新旧请求均核对完整原话，成功只认回执；详见 [MEMORY](docs/MEMORY.md)（D16、D33） |
| 本地与云 | 对话、记忆、健康原文留在个人设备；云只做身份、连接、密文暂存和备份，看不到内容（D20、D25） |
| 界面基准 | 现在的界面是基准，原生不能更差（D64）；深色用中性灰磨砂，不用墨绿（D65）；图标自己画（D90） |

## 7. 代码地图

| 想理解或修改 | 入口 |
|---|---|
| Windows 启动、生命周期与桌面能力 | `src/main.mjs`（组装运行时、个人服务、记忆、更新与窗口）、`src/host-mode.mjs`、`src/personal-desktop.mjs`；安装版配置 `src/desktop-config.mjs` |
| 客户端访问电脑 | `/personal/v1`：`src/personal-access/index.mjs` 组装，`http.mjs` 分发；契约 [docs/CLIENT_API.md](docs/CLIENT_API.md)；安卓白名单 `apps/android/.../Network.kt::validBusinessPath` |
| 执行与原生会话 | `src/personal-access-backend.mjs` → `src/runtime/gateway/` → `src/runtime/dsh-adapter/`；`src/dsh-web-runtime.ts` 管 DSH 进程、配置与插件接线 |
| 电脑权限与模式 | `src/plugins/weftmate-personal-desktop.mjs`、`personal-work-mode.mjs`、`personal-approval-policy.mjs`；模式与项目绑定在 `src/personal-access/work-and-chat.mjs` |
| 桌面和远程网页 | 界面 `src/personal-access-ui/`；共用的状态、请求、历史与动作 `src/ui-core/` |
| 安卓 | `apps/android/`：`NativeActivity` 是原生入口，继承 `HybridActivity` 的现役接线；`NativeChatModel` 管原生聊天 |
| 手机网页与安卓内置网页 | `apps/mobile-ui/www/`：手写页面和生成副本混在一起；`ui-core/` 等由 `apps/mobile-ui/src/build-ui-core.mjs` 从 `src/ui-core/` 复制，改源头再生成 |
| 苹果三端 | `apps/apple/UI/` 共用界面与模型；`iOS/`、`macOS/`、`watchOS/` 放平台行为；`Packages/WeftMateCore/` 是共享协议、存储与逻辑 |
| 记忆 | `src/plugins/weftmate-personal-memory.mjs` → `src/personal-access/memory-ingestion.mjs` → `src/personal-memory/` → 独立的 MemoWeft Core。详见 [docs/MEMORY.md](docs/MEMORY.md) |
| 跨端、离线与云 | `src/personal-sync/`、`personal-offline/`、`personal-cloud/`、`personal-relay/`；云服务 `services/cloud/` |
| 健康、连接器、备份与更新 | `src/personal-health/`、`personal-connectors/`、`personal-backup/`、`personal-cloud-backup/`、`personal-update/` |
| 设计母版与发布 | `design/tokens/`、`design/icons/` 是唯一来源，各端生成；发布脚本 `scripts/release/`、`scripts/build-mobile-ui.mjs`；官网 `site/` |
| 测试与检查 | `tests/`、`tests/contract/`、`eval/`；CI 在 `.github/workflows/`；仓库卫生检查 `.github/scripts/public-hygiene.mjs` |

## 8. 仓库外的东西

- **本机**：编排目录（任务书、现状页、交接记录）、各执行者的工作目录、测试数据和证据输出。这些地方只放机器事实（路径、会话、锁、设备）；产品决定和工作规矩以仓库为准，冲突时改本机文件。
- **依赖**：DSH 的固定提交见 `tests/contract/dsh-pin.json`，生成物在被忽略的 `vendor/dsh-runtime/`；MemoWeft Core 是独立仓库 `memoweft/memoweft`，同样由总代理维护（D111），CI 用的固定版本见 `.github/workflows/ci.yml` 的 `observed-core`，内核修好合进主线后再换这里的版本；WeftMod 独立。主仓单独通过不等于整套系统通过。
- **控件规范**（按钮和选择控件）：在 claude.ai 上的一个页面，链接见本机 `MACHINE.md`。

## 9. 怎么维护这一页

- 目标、判断、能力层级或大缺口变了，在**同一个 PR** 更新本页；决定变了同时改 DECISIONS。
- 不写过程、日记和实时状态。含 Windows 换行不超过 16,000 字节，保留判断和指路。

# WeftMate 项目地图

新会话先读（D102）。只记目标、有效判断、能力层级、代码入口和状态查询位置；注明出处或日期，无证据写「未知」。

## 1. 这是什么

围绕同一个人、同一个账号的 AI 助手：Windows 桌面程序、安卓、iPhone、Apple Watch、macOS，加一台轻量云服务器。换设备、换对话、换模型，面对的都是同一个 WeftMate；它能用电脑办事，也越用越懂你。愿景见 [docs/VISION.md](docs/VISION.md)，全部决定见 [docs/DECISIONS.md](docs/DECISIONS.md)。

## 2. 现在做什么

- **先收稳四条日用主路**（D100）：聊天问事、让电脑干活、记住我的事、健康与提醒。暂缓新功能扩张。
- **2026-10-18 重置**（D113–D116，优先于旧规矩和旧决定）：基线 → Windows 日用版（10-21）→ 安卓（10-24）→ iPhone 与手表 → 最后考试；**进度只看 PLAN 第 2 节的场景过了几个**。工作包见 [docs/PLAN.md](docs/PLAN.md) 第 3 节，规矩见 [AGENTS.md](AGENTS.md)。
- **分工**：本机 Claude 为总代理，派 Codex 执行（D112）；记忆也由总代理派包（D108）。macOS 本阶段不排入。

## 3. 实时状态去哪查

实时状态**不抄进文档**，用时现查：

| 想知道 | 去哪看 |
|---|---|
| 进度、逐场景验收结果和要本人定的事 | 本人的控制台页面（链接见本机 `MACHINE.md`） |
| 在做什么、谁在做 | GitHub `memoweft/weftmate` 上打开的 PR，对照 PLAN 第 3 节 |
| 已知问题、不稳定的测试 | GitHub Issues；本机文件里不记 |
| main 是不是绿的 | main 最新一次 CI；偶发失败记在「偶发失败总账」issue |
| 发出去的版本 | 官网下载页与发布清单 |
| 本人验收过什么 | 本页第 4 节，只记已经验收的结论 |

## 4. 各项做到哪一层

层级：**① 代码已合并** → **② CI 通过** → **③ 候选安装包按 PLAN 场景验收通过** → **④ 本人日用认可**。这里只记每条主路到哪一层；逐场景的结果（版本、设备、日期、证据）在本人的控制台，问题在 GitHub Issues。

| 主路 | Windows | 安卓 |
|---|---|---|
| 聊天问事 | ②；第一轮③有失败（C1 默认安装 #445、C5 冷启丢云登录 #440） | ②；第一轮被入口挡住，入口已修，C1、C5 单项补测通过 |
| 让电脑干活 | ②；第一轮③有失败（W3 #431） | ②；未重测 |
| 记住我的事 | ②；W3 本机独立安装自动接通、M1 通过；M2 失败，M3/M7 未完整通过（#334、Core #128/#129）；非干净沙盒 | ②；未重测 |
| 健康与提醒 | ②；第一轮③有失败（H3 #429、提醒查询 #434） | ②；未重测 |
| 页面完整 | ②；W3 候选记忆页 #433 浅/深色通过，其他 U1 未重测 | ②；未重测 |

第一轮安装候选（2026-10-16，同源 `cbc435a7`；Windows `0.1.1-preview.701`，安卓 `0.8.38/code51`）的原始结果见 [#332 回报](https://github.com/memoweft/weftmate/issues/332#issuecomment-6214881354)。截至 2026-10-18：两端四条主路均到②，**未达完整③或④**。下一轮基线是 PLAN 阶段 0。

**W3 单项安装复验**（2026-10-18–19）：候选 `0.1.1-preview.732`，组合源码 `84be94f9`、Core `069ecca6`、真实 MiMo，本机独立安装身份和空数据，**非干净沙盒**。自动接通和 M1 通过；M2 的修订被拒绝后仍答旧偏好；M3 单条删除与原聊天保留通过，但整链前置未成立且 Core 上下文仍有副本；M7 正式条目清零不等于来源与上下文全清。未启用文案使用状态响应夹具在真实安装窗口验证。分项与边界见 [MEMORY](docs/MEMORY.md#本机独立安装复验)；不替换原轮结果，不计完整③。

已有代码能力（未逐项安装验收）：

- **Windows 桌面**：自配模型；对话/工作（D92）、项目、附件、流式、排队、引导、审批、提问；文件、命令、浏览器、子任务及成果展示；记忆形成/召回/纠正/遗忘；临时对话、历史导入、定时任务、动态、目标、成果库、更新、加密备份、诊断、用量、设置。
- **安卓**：原生聊天、侧栏、输入区、目标、动态、成果库、模型服务，部分仍为网页；独立配云模型聊天（D61），连电脑交任务/批准/看成果；离线任务、记忆副本、文件预览；运行时接通知，后台补发可能延迟（D41）。
- **iPhone / 手表 / macOS**：原生对话、审批、记忆、设置、离线聊天、本机提醒；iPhone 接 HealthKit，手表看投影/提醒，Mac 试用版带运行时。免费签名（D38）；本人 iPhone、手表未装（2026-10-14）。
- **云服务**：账号、邮箱验证、设备目录、中继、离线任务暂存、加密备份接口。
- **记忆**：Windows 默认完整语义层（D106、D110），无显式配置时自动接入随包 Python/Core；详见 [组件说明](scripts/memory-runtime/README.md)、[docs/MEMORY.md](docs/MEMORY.md)。

## 5. 已知的大缺口

- **记忆的安装验收尚未完成**（见上）。内置组件、默认完整语义层和自动接入已实现，仍须在干净 Windows 验证和完成新装、升级、回滚的数据保留验收。
- **CI 有偶发失败**：直接重跑并记进总账 issue，不追（D114）；同一条反复挡合并才修。
- **三套客户端技术栈**：网页共用层（`src/ui-core/`，桌面、手机网页、安卓网页部分共用）、安卓 Kotlin、苹果 Swift。改一端先查另两端是否受影响，本阶段不收敛。
- **自动办事的真实模型表现不稳定**：复杂审批、多轮和长任务，不能只凭合成测试说可靠。
- **苹果端没有推送和 TestFlight**（D38、D47）；安卓进程被挂起后通知会延迟（D41）。
- **大文件**：`src/main.mjs`、`src/dsh-web-runtime.ts`、`src/personal-access/http.mjs`、安卓 `HybridActivity.kt`、苹果 `AppleAppModel.swift`。改到哪里就按职责拆哪里，不整文件重写。
- **仓库里还有约 300MB 苹果端证据**（`apps/apple/Tests/Evidence/`），有两个脚本在读，迁走输入之前不能删（`later`）。
- 精灵陪伴、共同空间、公开发布在后续路线（PLAN「暂缓」）。

## 6. 接手时要保留的判断

| 判断 | 现行口径 |
|---|---|
| 同一个助手 | 换对话、换模型、换设备都不用重新介绍自己；账户之间完全隔离（D80） |
| 产品结构 | 「对话／工作」两种模式（D92）：对话不动电脑；工作绑定一台电脑和一个文件夹，原审批照常生效 |
| 旧主对话 | 取消置顶和旁聊菜单，手机历史只读；`kind:main`、`/chats/main`、历史分段及后台投递目的地为旧端兼容保留，不能随界面入口删除 |
| 模型与运行时 | 模型由用户自带（D45）；DSH 提供通用工具、压缩、子任务、调度和审批，优先用它自带的（D2、D87）；WeftMate 组合账号、记忆、界面、设备与权限 |
| 记忆 | 电脑上由 MemoWeft 形成、召回、纠正、遗忘；手机单独用时只有轻量记忆，有电脑就交给电脑（D63） |
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

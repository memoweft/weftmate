# WeftMate 项目地图

新会话先读这一页（D102）。这里只放变化慢的事实：目标、有效判断、各项做到哪一层、代码在哪、实时状态去哪查。每条都带出处或日期，没有证据的写「未知」。

## 1. 这是什么

围绕同一个人、同一个账号的 AI 助手：Windows 桌面程序、安卓、iPhone、Apple Watch、macOS，加一台轻量云服务器。换设备、换对话、换模型，面对的都是同一个 WeftMate；它能用电脑办事，也越用越懂你。愿景见 [docs/VISION.md](docs/VISION.md)，全部决定见 [docs/DECISIONS.md](docs/DECISIONS.md)。

## 2. 现在做什么

- **先收稳四条日用主路**（D100）：聊天问事、让电脑干活、记住我的事、健康与提醒。暂缓新功能扩张。
- **顺序**（D101）：先 Windows 和安卓，然后 iPhone 和手表。macOS 本阶段不排入，保持现状。
- **记忆**由总代理按 [docs/MEMORY.md](docs/MEMORY.md) 的规则派包（D108）。
- 当前工作清单、验收场景和暂缓的路线见 [docs/PLAN.md](docs/PLAN.md)。不在清单上的工作不做。
- **分工**（D107）：总经理（Claude 云端会话）写指令、核对结果、向本人汇报；总代理（Astra）按指令实施。现行指令见第 3 节。

## 3. 实时状态去哪查

这些状态一天变好几次，**不要抄进文档**，用的时候现查：

| 想知道 | 去哪看 |
|---|---|
| 总经理的现行指令、总代理的回报 | GitHub 上的[「总经理指令」issue](https://github.com/memoweft/weftmate/issues/332)：正文是指令，评论是回报 |
| 在做什么、谁在做 | GitHub `memoweft/weftmate` 上打开的 PR，对照 PLAN 当前清单 |
| 已知问题、不稳定的测试 | GitHub Issues；本机文件里不记 |
| main 是不是绿的 | main 最新一次 CI（Actions 里的 CI 工作流）；重跑才过的，说明有不稳定的测试，要开 GitHub Issue |
| 发出去的版本 | 官网下载页与发布清单 |
| 本人验收过什么 | 本页第 4 节，只记已经验收的结论 |

## 4. 各项做到哪一层

层级：**① 代码已合并** → **② 在 CI 上通过** → **③ 候选安装包按 PLAN 的场景验收通过** → **④ 本人日用认可**。写法是「层级 + 证据（PR、安装包版本或本人原话）+ 日期」，结果分通过、失败、阻塞、未测、未实现、不适用。

截至 2026-10-17：四条主路在 Windows 和安卓上都到了 ①、②。首轮安装候选已有下表结果；**整轮仍有失败、阻塞和未测，尚未达到完整③，也没有④本人日用认可**。开发宿主、组件检查和单项通过均不替代整轮安装验收。

**修复后安卓单项补验**（2026-10-17，`0.8.38/code51`，主线 `f1330bde`，Android 15专属模拟器，APK全新安装；[APK身份与证据](https://github.com/memoweft/weftmate/pull/436#issuecomment-6220861286)）：C1本机免云登录、配置MiMo并首次收到真实回复，通过；C5本机对话和模型冷启恢复，通过；云注册、云登录恢复、跨端、真机，未测。这是后续单端补验，不替换下表同源CBC原结果，不代表整轮③或④。

代码层面已经有的（未按安装版逐项验收）：

- **Windows 桌面**：本机直接使用，配置自己的模型服务；对话与工作两种模式（D92）、项目、附件、流式回复、排队与引导、审批与提问；电脑上的文件、命令、浏览器与子任务，步骤和成果在对话里看；记忆形成、召回、纠正与遗忘；临时对话、历史导入、定时任务、动态、目标、成果库；安装更新、加密备份、运行诊断、用量和设置。
- **安卓**：原生聊天、侧栏、输入区、目标、动态、成果库与模型服务已接，部分页面仍是网页；不连电脑也能配云模型聊天（D61）；连上电脑可以交任务、批准、看成果；离线任务、记忆副本、文件预览、系统保存与分享。通知在应用运行时接收，后台补发可能延迟（D41）。
- **iPhone / 手表 / macOS**：原生客户端已有对话、审批、记忆、设置、离线聊天和本机提醒；iPhone 健康接入 HealthKit；手表看投影和提醒；Mac 试用版带运行时。全部用免费签名（D38），本人的 iPhone 和手表上还没装（本人 2026-10-14）。
- **云服务**：账号、邮箱验证、设备目录、中继、离线任务暂存、加密备份接口。源码有不等于生产已启用，要按实际部署复验。

**记忆特别说明**（2026-10-16）：Windows 构建已有固定 Python/Core 的基础与完整语义两层，默认完整语义层（D106、D110）；组件导入、真实进程协议及模型编码是组件核验，尚不等于安装版主路验收。自动配置尚未接通，**全新安装的 Windows 版默认仍未启用记忆**。原有显式配置继续依赖所指定的环境。干净 Windows 和安装升级场景仍待验收；方法见 [组件说明](scripts/memory-runtime/README.md)，现状见 [docs/MEMORY.md](docs/MEMORY.md)。

**记忆开发基线**（2026-10-16，`bf0a9c4d6`/Core `e86b73b`/真实MiMo；[证据与边界](https://github.com/memoweft/weftmate/issues/332#issuecomment-6208869990)）：M1/M2通过；M3旧修订与导出残留、M7错误成功/误删来源，失败，跟踪[#334](https://github.com/memoweft/weftmate/issues/334)。按D16、D33，遗忘须覆盖整条修订链。M4本人决定暂缓；M5–M6完整安卓链未验完。缺语义组件，只有开发宿主与隔离APK的结果，**不计入③**；全新安装及人工配置的结果见下表。

**第一轮安装候选**（2026-10-16）：两端均冻结 `cbc435a7`；Windows `0.1.1-preview.701`，独立安装身份、含干净经典沙盒；安卓 `0.8.38/code51`，Android 15全新模拟器。**云实际部署版本未知**，不能由健康响应的结构版本推算；下轮先核对运行部署的发布标识与源码映射，再测兼容。原始[分项回报](https://github.com/memoweft/weftmate/issues/332#issuecomment-6214881354)、[沙盒与记忆补验](https://github.com/memoweft/weftmate/issues/332#issuecomment-6218305168)保留证据；后续修复不能改写本轮结果。

| 场景/环境 | 结果 | 证据与范围 |
|---|---|---|
| Windows C1默认安装 | 失败 | 隔离候选默认路径过长[#445](https://github.com/memoweft/weftmate/issues/445)；改短目录后可用，不能抵消默认流程失败 |
| Windows C1短目录安装/模型问答 | 通过 | 干净沙盒实际安装、填MiMo、查询5模型并首次收到42 |
| Windows C1云登录 | 通过 | 测试收件箱验证码登录、账户匹配 |
| Windows C1云新注册 | 未测 | 已有测试账号，未完成新注册 |
| Windows C3/C4/C6/C7 | 通过 | 停止与排队、1000条真实分页、流式切页完整、约1.5秒三连发 |
| Windows C5 | 失败 | 云登录冷启丢失[#440](https://github.com/memoweft/weftmate/issues/440)；本地对话/模型恢复有通过证据，不能抵消云状态失败 |
| Windows C2配置/测试断连恢复 | 通过 | 错误地址、仅本包连接断开，显示错误且可修复 |
| Windows C2生产流式中途断网 | 未测 | 未中断真实上游流式连接 |
| Windows C10已测显示分支 | 通过 | 中文/英文标题、一行收起与真实步骤展开 |
| Windows C10其他语言/步骤分支 | 未测 | 已测显示不保证所有步骤内容正确；提醒查询范围另有失败[#434](https://github.com/memoweft/weftmate/issues/434) |
| Windows W1整理/预览 | 通过 | 已准备的可写项目内按三类整理，内容一致、成果可打开 |
| Windows W1首次选电脑/目录 | 未测 | 现有证据从已准备项目开始，不证明完整选择流程 |
| Windows W2批准/拒绝 | 通过 | 可写且每次询问：批准后删除，拒绝后文件保留 |
| Windows W3/H3/U1 | 失败 | 换工作误答旧输入[#431](https://github.com/memoweft/weftmate/issues/431)；有睡眠时长却称无记录[#429](https://github.com/memoweft/weftmate/issues/429)；内部术语[#433](https://github.com/memoweft/weftmate/issues/433) |
| Windows H1 | 通过 | 真实到点通知与原生显示 |
| Windows H5保存/查看/删除/目标进展 | 通过 | 删除另一条提醒，长期目标有两轮进展 |
| Windows H5到点通知 | 通过 | 2026-10-17 09:00原提醒按时投递、原生通知显示；候选`0.1.1-preview.701`，[回报](https://github.com/memoweft/weftmate/issues/332#issuecomment-6227712772) |
| Windows全新记忆 | 失败 | 未启用；不是新随包组件或自动接线验收 |
| Windows人工接Core529，M1/M2 | 通过 | 形成、新对话召回、纠正；不代表全新安装 |
| Windows人工接Core529，M3/M7 | 失败 | 保留独立来源的导出残留、误删独立主题[#334](https://github.com/memoweft/weftmate/issues/334)；关联链删除成功不能抵消残留 |
| 安卓C1 | 失败 | 冻结CBC全新安装只有云登录入口[#428](https://github.com/memoweft/weftmate/issues/428) |
| 安卓后续聊天/健康/提醒/页面/记忆，跨端C8/W4–W6/M5–M6 | 阻塞 | 被上述入口挡住；安卓H5未设置，不据此判漏通知 |
| 安卓C9输入区 | 阻塞 | 聊天输入区不可达 |
| C9软键盘、M3另一来源支持旧修订变体 | 未测 | 本轮未覆盖，不能用其他子项替代 |
| M4 | 未测 | 本人决定本轮暂缓 |
| H4 | 不适用 | 不属于当前Windows/安卓轮 |

## 5. 已知的大缺口

- **记忆的自动接入和安装验收尚未完成**（见上）。内置组件及默认完整语义层已由本人确认，仍须在干净 Windows 验证和完成新装、升级、回滚的数据保留验收。
- **CI 有不稳定的测试**：同一提交重跑结果不同，会掩盖真回归。规矩见 [AGENTS.md](AGENTS.md)：不靠重跑合并。
- **三套客户端技术栈**：网页共用层（`src/ui-core/`，桌面、手机网页、安卓网页部分共用）、安卓 Kotlin、苹果 Swift。同一个功能常要分别修，改一端时先查另外两端是不是同样受影响。本阶段不收敛。
- **自动办事的真实模型表现不稳定**：复杂审批、多轮和长任务，不能只凭合成测试说可靠。
- **苹果端没有推送和 TestFlight**（D38、D47）；安卓进程被挂起后通知会延迟（D41）。
- **大文件**：`src/main.mjs`、`src/dsh-web-runtime.ts`、`src/personal-access/http.mjs`、安卓 `HybridActivity.kt`、苹果 `AppleAppModel.swift`。改到哪里就按职责拆哪里，不整文件重写。
- **仓库里还有约 300MB 苹果端证据**（`apps/apple/Tests/Evidence/`），有两个脚本在读，迁走输入之前不能删（PLAN 待清理项）。
- 精灵陪伴、共同空间、公开发布在后续路线（PLAN「暂缓」）。

## 6. 接手时要保留的判断

| 判断 | 现行口径 |
|---|---|
| 同一个助手 | 换对话、换模型、换设备都不用重新介绍自己；账户之间完全隔离（D80） |
| 产品结构 | 「对话／工作」两种模式（D92）：对话不动电脑；工作绑定一台电脑和一个文件夹，原审批照常生效 |
| 旧主对话 | 置顶入口已取消，但 `kind:main`、`/chats/main`、历史分段和后台投递目的地为兼容保留。不能因为界面没了入口就删它的数据结构 |
| 模型与运行时 | 模型由用户自带（D45）；DSH 提供通用工具、压缩、子任务、调度和审批，优先用它自带的（D2、D87）；WeftMate 组合账号、记忆、界面、设备与权限 |
| 记忆 | 电脑上由 MemoWeft 形成、召回、纠正、遗忘；手机单独用时只有轻量记忆，有电脑就交给电脑（D63） |
| 删除语义 | 忘掉一条记忆包含整条修订链及其来源，确认前列出连带内容；独立的其他话题不动，聊天原话默认保留（D16、D33）。新请求和旧请求恢复都须核对完整原话，无法核对就不删；已有命令只查原回执，只有实际成功回执才表示已删除 |
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

- **本机**：编排目录（任务书、现状页、交接记录）、各执行者的工作目录、日用数据和证据输出。这些地方只放机器事实（路径、会话、锁、设备）；产品决定和工作规矩以仓库为准，冲突时改本机文件。
- **依赖**：DSH 的固定提交见 `tests/contract/dsh-pin.json`，生成物在被忽略的 `vendor/dsh-runtime/`；MemoWeft Core 是独立仓库 `memoweft/memoweft`，同样由总代理维护（D111），CI 用的固定版本见 `.github/workflows/ci.yml` 的 `observed-core`，内核修好合进主线后再换这里的版本；WeftMod 独立。主仓单独通过不等于整套系统通过。
- **控件规范**（按钮和选择控件）：在 claude.ai 上的一个页面，链接见本机 `MACHINE.md`。

## 9. 怎么维护这一页

- 目标、有效判断、能力层级或大缺口变了，当轮做事的人在**同一个 PR** 里改这一页；改了决定，同时改 DECISIONS。
- 不写过程、日记和实时状态。超过 16KB，检查会报错：先把历史和过程移出去，留下判断和指路。

# WeftMate Mac iPhone 和 Apple Watch 开发交接

日期：2026-10-04。用户已明确让另一侧 Codex 开发 Mac、iOS 和 Apple Watch 版本，手表类型已确认。本文是 Apple 平台的任务交接与实施范围；当前尚无 Apple 客户端工程或构建验收。

目标是让 Apple 设备加入同一个 WeftMate：同账户继续聊天、使用记忆、交代事情、查看和接续任务；Mac 与 iPhone 同时具备自身可用的助手能力。现有 Windows 服务端和 Android 成果继续复用，Apple 侧按设备特点交付真实 App。

## 项目总目标与当前进度

WeftMate 是各种设备统一的 AI Agent（人工智能助手）。首版路线是完整 App 与账户、长期记忆、共享聊天与任务、手机派发电脑执行；随后扩大应用操作、DSH/Codex 协作、能力扩展、主动跟进和更多设备。界面、流畅度与后端功能同期交付。

| 能力 | 已有成果 | 仍需完成 |
| --- | --- | --- |
| 账户与设备 | 注册、密码登录、资料、设备管理、多账户归属与隔离已有候选 | Apple 接入与平台设备身份，三端切号/重启/撤权体验 |
| 对话与模型 | Windows/Android 聊天、原文字历史续聊、账户模型配置共享已有实现和运行证据 | Apple 客户端；完整附件上下文；任意中途换模 |
| 长期记忆 | 电脑按账户形成、召回、纠正、停用、真删除；手机在线只读 | Apple 展示与管理；云模型采用的实际接线；移动端编辑/失效同步 |
| 任务与成果 | 文件生成、项目资料和公共网页读取、来源、预览、手机保存、补充和准确停止已有候选 | 真实完整目标稳定结束；更广应用执行；Apple 结果查看和接续 |
| 独立与离线 | Android 直连云模型、基础本地记录、待同步和缓存已有实测 | Mac/iPhone 独立引擎；离线分支合并；端侧模型 |
| 更新与体验 | Weave 1.2 视觉方向、服务器界面更新、图片直显、部分安卓流式体验已确认 | Apple 原生交互与更新分层，真实设备验收 |
| 跟进与通知 | 页面和同步基础存在 | 完整持久调度、真实通知送达与回到原任务 |

“已有候选”“开发或真实模型验证”“用户本人通过”是不同状态。详细事实以 CURRENT_STATE 和相应任务卡为准，不能按本表宣布全部完成。

## 先读什么

在实际源码根依次读取：

1. [AGENTS.md](../../AGENTS.md)
2. [START_HERE.md](../START_HERE.md)
3. [PROJECT_DIRECTION.md](../PROJECT_DIRECTION.md)
4. [CURRENT_STATE.md](../CURRENT_STATE.md)
5. 本交接与 [DEVELOPMENT_LOOP.md](../DEVELOPMENT_LOOP.md)
6. [FRONTEND_PLAN.md](../FRONTEND_PLAN.md)、[ARCHITECTURE.md](../ARCHITECTURE.md)、[REPOSITORY_LAYOUT.md](../REPOSITORY_LAYOUT.md)

正文里较早的“仅做 Windows＋Android”和尚未接记忆等历史时点，以用户此次 Apple 平台要求和最新 CURRENT_STATE 为准。旧星球图谱已废弃。

本交接前的代码基线为本地提交 `180290f`；源码包还包含本次交接文档。此前提交没有推送到远端，Mac 上现有 clone（源码检出）未必拥有这些变更。先核对版本再集成；源码 ZIP 不含 Git 历史、依赖安装和私人运行数据，不能把 ZIP 中的基线文字当作本机真实 HEAD。

## 实现归属与协作

| 范围 | 负责人 |
| --- | --- |
| Apple 客户端、共享 Swift 代码、Mac 本机能力、Apple 构建与真机验证 | 另一侧 Codex |
| 现有 Windows 宿主、Android、共同服务端与正式协议 | Windows 侧 Codex |
| 全局方向与进度、公共契约索引、BACKEND 协作记录合入 | Windows 侧主助手 |

用户随后明确已连接 Mac，授权 Windows 主助手直接指挥苹果侧。已定位现有 Mac 任务 `01a106a1-c996-7e12-a93d-4441c14e530b`，工作目录 `/Users/yun/Desktop/WeftMate`；Windows 主任务为 `01a0dc76-b04c-7492-9cb9-94a1b1a0744e`。任务消息已能从 Windows 发到 Mac，进度由 Windows 的 wait_threads（任务等待工具）读取，用户无需复制两边对话。此处记录的是已发生的调度；源码同步仍需单独核实际通路。

Mac 此前已实测 Xcode 26.3/Swift 6.2.4，当前目录只有旧方案包；旁边的 `/Users/yun/Desktop/APPLE` 工程先作为只读参考，不能覆盖。首次调度要求核现有私有文件通路，取得最新源码后才开始正式接入。

建议 Apple 生产目录为 `apps/apple/`，内部组织 Shared、macOS、iOS、watchOS 和 Tests；这些目录是建议，当前还不存在。Apple 侧先在自己的检出或独立目录核工具链，保留已有修改，随后拥有 Apple 目录和本任务卡的实施记录。共享根依赖、锁文件、服务端源码和 Android 改动先协调，避免双方同写。

共同接口需求按现有 `collab/README.md` 协作；BACKEND.md 保持一个写者，由 Windows 侧合入 Apple 请求及答复。Apple 实施进展记录在本任务卡，由 Windows 侧据实际证据更新 CURRENT_STATE。交接包是快照，不另建一套实时状态系统。

Apple 侧负责把现有能力接成 Apple 用户流程。Windows 本地模型维护、PowerShell 恢复脚本和旧显卡诊断属于 Windows 侧，不是 Apple 工程的前置开发任务。

## 三端产品范围

### Mac

- 原生完整 App：账户、资料、外观、设备、模型、设置和更新入口。
- 聊天与内容工作区并用，能看文件、代码、网页、来源和任务成果，继续原会话。
- 同一账户接续 Windows/Android/iPhone 的记录、任务和已支持的上下文。
- 独立选择云模型或 Mac 可达的本地模型服务；Windows 离线时仍可做 Mac 自身支持的事情。
- 分批接 Mac 文件、应用启动、浏览器和后续项目/终端操作，使用真实观察与结果核验。
- 后续评估 Mac 本机 DSH 宿主与 MemoWeft 接入；保持既有协议和数据归属，按平台抽出 Windows 专属执行适配。

### iPhone

- 原生聊天体验：会话侧栏、流式回复、Markdown（结构化文本）、代码复制、真实生成/工具/任务状态与停止。
- 模型紧凑下拉，语音相邻；语音先回填草稿，左侧加号分享图片和文件。
- 图片直显与全屏预览；真实系统照片/文件选择、分享入口和成果保存。
- 账户、头像昵称、外观、通知、模型、设备、记忆和事情页面完整可进入。
- 同一对话跨端接续；优先沿用该对话原模型，缺配置时明确配置或选择。
- iPhone 自己可达的云模型直接运行，先持久化本地记录；电脑专属动作等待相应设备在线。
- 离线缓存、待发送与恢复逐步接通；电脑离线不等于手机完全断网，端侧推理后续按硬件评估。

### Apple Watch

- 快速语音/文字交代事情、查看最新回复和任务摘要、处理需用户确认的问题。
- 可以补充、请求停止同一任务；结果有回执，关闭手表界面不会取消电脑任务。
- 通知点入原事情，较长内容在 iPhone 或 Mac 接续；后续加入 WidgetKit（小组件框架）表盘组件和 Smart Stack（智能叠放）入口。
- 首批通过 iPhone 协助接入和同步，同时保留手表自己的设备身份。配对协助不能复制手机设备 ID 冒充另一台设备。
- 最终支持手表具备网络条件时自行访问服务器；iPhone 不可达时有真实离线/等待状态。独立登录或配对接口缺口由 Windows 侧补正式契约。
- 按短交互设计主界面；任务执行主要由云端或电脑承担，手表持续保留目标与回到原任务的入口。

Apple 官方支持独立 watchOS App（手表应用），独立应用需要自行取数据，Watch Connectivity（手机手表通信框架）可用于配对设备协作。[独立手表应用文档](https://developer.apple.com/documentation/watchos-apps/creating-independent-watchos-apps)

## 推荐技术与更新分层

推荐以 SwiftUI（苹果原生界面框架）做三端原生界面，共享 Swift Package（Swift 代码包）承载数据模型、网络、去重、账户切换和同步逻辑；文件、凭据、通知和执行能力各有平台适配。SwiftUI 提供 Apple 多平台界面工具，具体系统下限由那边实际 Xcode（苹果开发工具）和用户设备决定。[SwiftUI 官方说明](https://developer.apple.com/swiftui/)

这是实现建议，不是现有工程已采用的技术。先核当前代码、工具链和依赖，通过一条真实纵向流程确认，再扩完整页面。现有 `apps/mobile-ui/www` 和 `src/personal-access-ui` 提供 Weave 样式、产品语义与状态参考；Apple 侧将相同设计语言落到原生控件与交互。

Mac 与 iPhone 的本机模型入口先兼容已配置服务，模型接入优先复用现有运行方式。Mac 现有 Electron（桌面应用框架）/DSH 宿主的可移植部分单独核对；Windows 路径、`get-windows` 和项目 PowerShell 读取器需平台适配，不能靠改 package.json 标题就称完成 Mac 版。

更新分三层：服务器数据/模型目录/任务能力可以更新；采用的网页内容与共享界面资源按现有清单与兼容能力更新；原生 Swift 代码和新增系统能力通过安装包更新。不要承诺所有 SwiftUI 变更都能由服务器免打包推送。更新时保留草稿、账户和在途任务，失败恢复可用版本。

Watch Connectivity 的即时消息依赖对端可达，后台传输由系统调度；独立手表的服务器通信要按真实网络状态验证，不能把配对或排队当已送达。[WCSession](https://developer.apple.com/documentation/watchconnectivity/wcsession)

watchOS 后台网络请求可能因系统和网络条件延后。持续任务状态与通知需要系统允许的更新路径，不能承诺全天常驻连接。[手表后台请求](https://developer.apple.com/documentation/watchos-apps/making-background-requests)

## 共用接口与数据规则

沿用已有 `/personal/v1` 接口，字段、认证和事件以 [ARCHITECTURE.md](../ARCHITECTURE.md) 指向的正式实现为准。本文只给代码定位，不复制第二份 schema（数据结构）。

| 要接的能力 | 主要代码位置 |
| --- | --- |
| 登录、注册、账户资料、设备与任务接口 | `src/personal-access/index.mjs`、`apps/android/.../Network.kt` |
| 原会话绑定与历史接续 | `src/personal-conversations/context.mjs`、`ConversationHandoff.kt`、`SharedChat.kt` |
| 模型配置与不可变修订 | `src/personal-account-models/index.mjs`、`AccountModels.kt`、`ModelRouteFingerprint.kt` |
| 本机模型与持久记录 | `ModelClient.kt`、`LocalStore.kt`、`DeviceTools.kt` |
| 同步事件与附件 | `src/personal-sync/index.mjs`、`attachments.mjs`、`AttachmentStore.kt` |
| 任务回复、来源与成果 | `src/personal-reply-evidence`、`src/personal-artifacts`、`src/personal-browser` |
| 桌面与手机界面参考 | `src/personal-access-ui`、`apps/mobile-ui/www` |

Android 文件的完整根目录是 `apps/android/app/src/main/java/com/memoweft/weftmate/mobile/`。这些实现是学习现有契约的依据，不代表可以直接编译成 Apple 客户端。

实现时必须保持：

- 多个人、每人多台设备；聊天、记忆、任务、模型私有配置及缓存按账户隔离。
- 同一对话/任务身份连续；同步历史不重新触发模型或重复执行动作。
- 本地持久化后发送，未知结果先核对；重复同请求保持同一结果，冲突显式呈现。
- 采用原对话实际模型。账户模型旧修订/新修订分开，不能顺手改全局默认或旧共享绑定。
- 关闭页面、停止回复、停止任务分别处理；文件已核验与模型回复结束独立显示。
- 记忆停用与真删除分开；旧离线副本不能复活已删除内容。
- 模型来源与执行设备分别选择，只有本机确实支持的工具才声明可用。
- 用户凭据在本机标准 Keychain（钥匙串）等存储中处理；文档、日志、测试和源码包不放真实密码或 API Key（接口密钥）。既有账户隔离继续使用，个人助手保持简洁。

现有同步代码有 `nativeVersionCode` 等兼容门槛。Apple 实现应区分自身构建号与共同能力/协议版本，按真实实现协商；发现平台兼容缺口交 Windows 侧补，不靠填写 Android 版本数字绕过检查。

普通文件、完整图片上下文、离线分支合并、手机记忆写操作、APNs（苹果推送服务）登记/送达和独立手表接入均可能需要后端补接。逐项查当前代码并提出最小接口需求，客户端不得以本地改状态代替后端回执。

## 实施顺序与交付证据

| 里程碑 | Apple 侧交付 | 完成依据 |
| --- | --- | --- |
| A 工程与真实登录 | 可构建的 Mac/iOS 工程与 watchOS target（构建目标），统一主题、服务器设置、注册/登录、设备列表 | 实际 Xcode 构建；测试账户三端归属；失败保留输入；切号不串缓存 |
| B 同一对话与任务 | 列表、原对话续聊、实际模型选择、流式/停止、来源与成果 | iPhone→Mac→Windows 同一原对话接续；只有一次生成/动作；断线重开补齐 |
| C 完整日用页面与输入 | 资料、设置、记忆、设备、图片/文件、语音、内容工作区和更新 | 真文件选择/保存、原件与模型读取分开核验；键盘/长文/深浅色实机检查 |
| D Mac/iPhone 独立能力 | 云模型直连、本地持久任务、Mac 本机工具、电脑离线状态 | Windows 不可达时完成自身支持的目标；重连不重放；电脑专属动作等待 |
| E 手表完整接续 | 输入、任务摘要、确认/补充/停止、通知与 iPhone 交接 | 同一任务跨手表/手机/电脑；对端不可达、后台延迟、重复投递分别有实测 |
| F 独立手表与持续打磨 | 自行联网、账户接入、通知/小组件与稳定恢复 | iPhone 不可达时仍符合真实声明；真实手表验证与发行包 |

Mac/iOS 可共用核心并推进，手表先形成可运行目标，随后跟随同一对话/任务契约接通。先交用户可操作的完整流程，再扩大能力。代码编写与测试按用户约定由实际可用子 Agent 执行，主助手负责范围、协调与验收；显示真实模型。用户已允许 GPT-6 Sol/GPT-6 Luna，不必继续固定旧 5.6 分工。

每次交付记录代码版本、系统/Xcode、实际设备或模拟器、真实后端与模型结果、安装方法、3—5项本人操作和未完成项。静态界面、模拟器或 mock（模拟对象）不能当真机后台通知/独立联网通过。接口尚不可用时可以继续编译和界面/协议验证，但真实联调保持未通过。

运行环境、签名与目标系统首先在 Apple 机器核实。涉及账号、费用、不可推断的系统授权或外部发布时，完成可审查候选后再请用户处理；密码和密钥不发聊天。普通实现、修复和必要验证在本次 Apple 范围内持续推进，不把每个控件都变成确认问题。

## 现有服务器与源码包边界

既有入口为 `https://home.weftmate.com:8443/`，个人页面 `/personal/v1/ui`。这只是已配置地址，不表示目前已复验可达。

用户已在2026-10-04重启电脑；最后只读观察18:55为 GPU 显存约943MiB占用、个人宿主18186和模型切换代理8081监听，本地模型8080及Caddy443尚未见监听。Windows 侧恢复尚未接续。Apple 侧先实现离线可构建工程和真实故障状态；服务恢复后再做跨设备联调，不将服务器故障扩成 Apple 侧的 Windows 模型维护任务。

DSH 固定依据为 `tests/contract/dsh-pin.json`：版本`0.1.0-rc.5`、提交`47f943859bef60e4160492346772ded9b24f765a`。Apple 客户端实现无需先升级该依赖。需要运行本机宿主时按正式升级/依赖规则核工具链，不复制 Windows 的 node_modules、Junction（目录连接）或虚拟环境。

源码包仅包含当前 Git 跟踪内容。真实账户、密钥、模型权重、运行数据库、Windows已安装依赖及独立 MemoWeft/DSH 仓库不在其中；这些组件的源码位置与构建依赖另按正式索引取得。Apple 工程需要在 Mac 上实际编译，本文没有替代任何 Apple 运行验收。

## Apple 侧实施记录

状态：交接材料已准备，Mac 准备轮已派发；待取得当前源码快照后开始第一条真实客户端流程。

Apple 侧接续在本节记录首个源码版本、工程路径、工具链、已完成里程碑、真实联调与未完成的接口需求；Windows 侧读取这些证据更新全局进度。

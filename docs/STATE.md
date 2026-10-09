# 当前状态

> 只写现在，整页覆盖，不追加日记。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-09

## 当前里程碑：M0 重置 / 轻云并行

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows-3 | FX-9 首个云账号执行与发送确认 | `wp/fx-9-new-owner-execution`：空白宿主首个云账号持久保存执行归属，旧本地账号与数据保留；审批、通用工具、成果、提问与网页来源按执行会话归属接线。原命令回执独立收尾发送状态，原生持久回执同步清草稿；受限聊天声明无任务能力并解释账号限制。真实 main.mjs + 固定 DSH（助手运行时）+ MiMo + MuMu（安卓模拟器）已复现原问题，新云账号及旧本地绑定手机审批 / 写文件 / 完成通过，手机网页通过；第二账号隔离 / 403 / 清楚说明通过，手机批准原桌面重新进入后原执行账号办事仍通过；原生持久回执专项通过。相关定向回归与 typecheck（类型检查）通过。[证据](../tests/evidence/fx-9/README.md)，完整 CI（持续集成）交 PR（拉取请求）；本地完整中继夹具缺 HAProxy（TCP 前置代理），未复验。 |
| Codex · Windows-5 | QA-1 本人试用前五端验收 | 仅证据，无产品改动。[结果](../tests/evidence/qa-1/README.md)：MiMo 办事 5/6，LAN 抽测 3/3；王小明 8/8。MF-1 合并后补测即时记忆行为 / 语义 3/3，旧正式对象检查 2/3。新云账号被分配受限聊天预设、手机办事和发送确认两次失败；30 分钟 54 轮 18 次停止控件等待超时，p99（第99百分位延迟）31.2ms、RSS（驻留内存）+62.6MiB。iPhone 浅深对话通过，全设置遍历失败；Mac 隔离登录后验收阻断，Watch 仅显示取证，完整中继 / 实时跨端审批未通过。不建议本人试用，待 Claude 派修复包。模拟器与本包进程已清理，完整 CI 见本包 PR。 |
| Codex · Windows-4 | HF-2 · 日用程序主进程卡顿紧急修复 | [PR #119](https://github.com/memoweft/weftmate/pull/119) · `wp/hf-2-main-thread-stalls`：Windows ACL（访问控制列表）异步设定并缓存；独占新建文件继承当前账户唯一权限，旧文件首次访问仍收紧并验证。停止重试按1/2/4/8/16/30秒退避，尝试时间戳只存内存，同回执／后台任务状态不重复写；原生结束证据清理定时器，停止／继续契约保持。相同store（状态存储）跳过写盘，窗口位置／常规轮询／感知快照／大文件导出改异步合并。相关51/51、类型检查和Windows ACL读回通过；隔离真实Electron（桌面程序框架）60秒前后：事件循环p99（第99百分位）360.19→20.73ms、IPC（进程间通信）361.9→5ms、窗口移动290→10ms；写盘101→6次（后50秒0次）、同步启动202→0次、终态后重试2→0次。真实主程序＋固定DSH（助手运行时）停止／无关队列继续／恢复冒烟通过；见[HF-2证据](../tests/evidence/hf-2/README.md)，日用程序未操作。 |
| Codex · Windows | M0-6 现有模型入口、后台路由与系统状态 | [PR（合并请求）#33](https://github.com/memoweft/weftmate/pull/33) 方向调整完成：接入 D:\AI 的 8081 ModelSwitcher（模型切换代理），删除自起模型与参数；98,304 / 单槽 / 12 步与后台排队冒烟通过，M1-1b 完成后真实按钮重启通过；最终 CI（持续集成）见 PR 当前提交 |
| Codex · Windows-3 | UI-5 对话菜单与设置已归档（D34） | [PR #103](https://github.com/memoweft/weftmate/pull/103) · `wp/ui-5-session-menu`：桌面悬停 / 键盘 / 右键菜单、字母快捷键、行内重命名、分组子菜单与折叠、置顶 / 分组 / 未分组顺序；手机长按底部动作表单（Android〔安卓〕code23）；账号隔离的置顶、未读、用户标题、分组 CRUD（增删改查）及 DSH（助手运行时）原生事件种子分叉，独立工作目录与经验、不复制记忆来源；设置已归档搜索 / 恢复 / 既有删除确认。定向21项（含合入FG-1的遗忘 / 生命周期回归）、按名称与角色的界面回归59项及动效关闭回归1项、类型检查、真实 Electron（桌面程序框架）+ MiMo 分叉续聊与归档删除、390×844 手机网页和 MuMu（安卓模拟器）原生桥接通过；证据见 `tests/evidence/ui-5/`。删除确认遗忘勾选未动；长时浸泡及 Apple（苹果）原生接线未做；完整 CI（持续集成）见本包 PR（拉取请求），待 Claude 审查 |
| Codex · Windows-7 | UPD-1 版本化推送更新（D32） | `wp/upd-1-update-hooks`：三层 Ed25519（签名算法）清单 / 兼容范围、桌面差异文件暂存 / 下次空闲打开切换 / 启动失败回滚、程序本体 blockmap（分块映射）差分接缝与明确重启、共享关于动作和发布 / 校验脚本完成。真实 Electron（桌面程序框架）主入口 + DSH（助手运行时）合成流任务验证未被打断，v2 只下载一个变化文件，v3 自动回到 v2且重启保留；Chromium（浏览器引擎）390×844及MuMu（安卓模拟器）真实验签 / 切换 / 回退通过，[证据](../tests/evidence/upd-1/README.md)。相关50/50、类型检查通过；Android（安卓）code22支持合入备份后的251文件包，旧壳按最低原生code保留原界面；正式源 / 发布密钥 / 代码签名交UPD-3，关于呈现交UI-4；完整CI（持续集成）见本包PR（拉取请求），待Claude审查 |
| Codex · Windows-2 | PJ-1 项目 / 文件夹（D37） | `wp/pj-1-projects`：项目说明 / 只读与可写权限 / 修订设置、旧只读登记原地迁移、项目对话绑定与下一回合目录切换、DSH（助手运行时）原生文件与命令边界、一次明确批准的升级、审批文字隐去项目路径、子任务继承、移除保留文件和来源；桌面侧栏、系统文件夹选择、设置和移至项目，手机网页 / Android（安卓）界面包项目列表与新建对话已实现。真实 Electron（桌面程序框架）+ MiMo 读 / 写 / 命令核对、只读 / 越界拒绝、移动后执行与移除保留通过；390×844网页和手机界面包交互、相关定向回归与类型检查通过，[证据](../tests/evidence/pj-1/README.md)。Apple（苹果）原生接线后续包，未部署、未碰日用程序 / 数据；完整 CI（持续集成）见本包 PR（拉取请求），待 Claude 审查。 |
| Codex · Windows-6 | BK-1 本地自动备份与一键恢复 | `wp/bk-1-local-backup` / PR #88 返工：每日、手动、升级前、注销前改为程序内在线快照；DSH（助手运行时）原生日志排空复制，文件写入队列暂停 ≤2 秒、超时放弃稍后重试；SQLite（嵌入式数据库）在暂停时固定只读视图，恢复文件写入后在线复制，随后压缩校验。只有恢复/升级安装重启；批量 resume（恢复会话）限定恢复后的首次启动。「此电脑 → 备份与恢复」一行挂载，待 UI-4 注册表。备份 23 项与恢复/换机链路、真实 Electron（桌面程序框架）+ MiMo 运行中推迟备份、窗口 id / 进程 pid 不变、恢复首启后删除对话、类型检查通过；[验收](../tests/evidence/bk-1/README.md)。S4 云加密、Apple 原生入口与长时浸泡未做；CI（持续集成）见 PR（拉取请求），待 Claude 审查 |
| Codex · Mac-2 | H3 设备端健康指标 | [PR #67](https://github.com/memoweft/weftmate/pull/67)（`wp/h3-health-metrics`）：iPhone / Watch 本地恢复度、电量、负荷、压力区间与睡眠；日 / 小时摘要沿用 H2 隔离队列且强制仅本地模型；最小健康页 7/30 天趋势。Swift 相关22/22、宿主10/10、iOS / watchOS Debug 构建通过；隔离模拟器真实 HealthKit→计算→H2 HTTP→健康页闭环通过，[合成截图与验证](../apps/apple/Tests/Evidence/H3/README.md)；完整 CI 见本包 PR；不含真实设备、后台持续采集、Core delivered 或 AI 建议验收。 |
| Codex · Mac | UPD-2 Apple 更新（D32） | [PR #99](https://github.com/memoweft/weftmate/pull/99) · `wp/upd-2-apple-updates`：原生关于页版本 / build、所连宿主三层状态、按平台最低版本提示与拒绝不兼容连接已接线；Mac 因 Sparkle 沙盒安装器新增权限及 delta 失败全包回退采用授权最小口子，UPD-1 整体 Ed25519 签名检测 + 打开下载页，默认未配置；iPhone TestFlight / App Store，无执行代码热更。Swift 相关31/31、Node 相关21/21、类型检查、iOS / Mac Debug 构建通过；Mac 本地临时签名清单检测 / 篡改拒绝与 iPhone 原生2/2通过，[6图与验证边界](../apps/apple/Tests/Evidence/UPD2/README.md)。Mac XCTest 因自动化授权未执行，改用自身窗口捕获；完整 CI 见本包 PR，正式来源 / 签名身份 / 安装器接线交 UPD-3，待 Claude 审查。 |
| Codex · Mac | A9 Apple 详情 / 进展精修与 D36 设置 | [PR #122](https://github.com/memoweft/weftmate/pull/122) · `wp/a9-apple-polish`：参数名称 / 值、输出正文摘要 / 全文 / 复制、错误与二级原始数据；来源入口移入每步，与 Windows 文案一致。Mac / iPhone 进展与等待字号对齐正文、箭头紧随文字、整行可点；发送 / 停止同一主题色，Mac 附件「+」无附加箭头。常规默认排队 / 可选引导，按本设备账户保存，按钮 / 键盘走既有 queue / steer；修复并发详情读取取消后卡转圈。Watch 对话仅审批 / 完成，工具 + 对象、批准 / 拒绝，H3 健康保留。Swift 定向13/13、发送12 / 审批11 / 详情竞态1项状态检查、令牌4/4与证据4/4通过；iPhone 最终浅深2/2零跳过，含实际发送 / 重启保持 / 错误正文；Mac Debug、Watch 伴随构建、四组发送停止像素断言通过。原生浅深改前16 / 改后33（含独立 Watch 1图），见 [A9证据](../apps/apple/Tests/Evidence/A9/README.md)。完整 CI 见本包 PR，待 Claude 审查；无接口变更、日用数据、发布或部署，真机配对 / Watch 触感与推送、真实 DSH 执行另验。 |
| Codex · Cloud | S1c-Web 云账号登录与设备授权 | [PR #36](https://github.com/memoweft/weftmate/pull/36)（`wp/s1c-web-cloud-login`）：桌面/手机 Web Code+PKCE/不可导出 DPoP、绑定/解绑、一次性二维码与输入码、前台允许/拒绝已实现；真实 Chromium + file 邮件 + 隔离宿主闭环通过；Android 系统浏览器回调/Keystore/SPKI 已接线，GitHub runner 的 assembleDebug / JVM 单测通过；首轮五项 CI 全绿，最终门禁见 PR checks；待 Claude 审查 |
| Codex · Cloud | S2b 宿主内容证书自动签发 | [PR #38](https://github.com/memoweft/weftmate/pull/38)（`wp/s2b-host-certs`）：阿里云 V3 DNS-01/provider 私有环境接线与 RecordId 所有权、宿主 Node ACME/原内容 key CSR、每天检查/<30天续期/原子安装/热载、状态到期与错误已实现；本机真实 Pebble/challtestsrv→签名宿主/云/假 AliDNS API→配对 pin/TLS 热载与模拟到期续期通过；交付待 Claude 审查，最终 CI 门禁见 PR checks，本包未部署 |

已完成：文档/规则重置、M0-1b 清理与拆分、M0-2 容量与动态预算（#24）、H1 健康设置/摘要/隔离队列（#22）、S0/S1a/S1b（#27/#29/#30）、CI 分组与依赖审计。

## 最近一次验证

- **FE-1a**：82/82 相关测试通过；真实主程序登录、发送 / 插话 / 排队、运行、三种审批决定、提问、步骤、成果与来源、记忆标签和外观均走通。只在测试响应里把输出按钮移到侧栏，同组交互继续通过。9对1200×800截图逐RGBA（红绿蓝与透明度通道）像素一致，无遮罩；仅固定合成时钟和悬停状态。零模型请求，合成账号与日志、隔离目录；手机接线交FE-1b，src/personal-memory/与业务契约未改。[复现与边界](../tests/evidence/fe-1a/README.md)。

- **S1d / D29**：WSL（Windows 的 Linux 子系统）Node 24.21.0 相关云/数据库/入口/宿主 **33/33**（含 6 组新账号/设备测试）通过；真实 cloud main 进程、file（文件）邮件、隔离 SQLite（嵌入式数据库）和宿主验证分步注册→电脑云登录自动绑定→第二设备待批准→允许→账号目录→连接→一次性 wm1 配对材料消费/受信 pin（证书公钥指纹）交付。覆盖 DPoP（设备密钥持有证明）缺 key/重放、跨账号拒绝、pin 错 key/recipient/过期/篡改、旧密码/刷新族撤销、本机应急密码与云退出/离线保持；Windows 宿主相关回归 **9/9**（原 8 项 + 旧账号绑定中断边界 1 项） 与类型检查通过。完整套件只交 CI（持续集成），客户端相机/真实 Electron（桌面程序框架）完整登录页由 LG-1 / LG-2 验收；本包只改服务器、不部署、不发真实邮件、不碰日用数据。

- **DS-1**：真实 Electron（桌面程序框架）审批闭环与浅 / 深 / 四种主题色 / 字号保存、390×844 手机 Web 的列表 / 运行 / 审批 / 步骤 / 成果 / 来源均通过，15 对截图零像素差异（仅固定实时秒数字样与悬停条件）。全部样式声明保留原值；Android code19 JVM 与构建通过。仅参数来源变更，动画本体和 Apple 接线留后续包；客户端业务契约无变更。详见 tests/evidence/ds-1/README.md。

- **IC-1**：唯一图标来源、Windows 系统主题选择、手机及 Android code18接入完成；真实 Electron 浅 / 深审批卡、输入区与侧栏，MuMu 应用桌面图标、应用内浅 / 深、主题资源及通知均取证。窗口 / 任务栏使用单色 ICO；Windows 托盘处于溢出区，未取得其可见图标截图。仅安装并卸载本包专属 QA（质量验证）应用，没有覆盖原调试包。完整验证、既有静态正则例外及未做项见 tests/evidence/ic-1/README.md；客户端业务契约无变更。
- **UI-2v**：MuMu Android 15 真实安卓外壳/真实个人认证/原生网络桥通过；合成任务投影、零模型请求。14张 `adb exec-out screencap -p` 截图覆盖列表/运行/审批/步骤/成果/来源/深色；真实测试输入法区域324设备像素、网页980→726 CSS px（页面像素），标题与输入区稳定、点击按键与草稿保留/重载通过。手机96/96、Android JVM27/27与构建通过；[证据](../tests/evidence/ui-2v/README.md)。预装搜狗输入法返回零高度，正常键盘兼容性未验；未宣称真实 DSH 执行或云登录。隔离包/宿主/端口清理、原输入法设置恢复。

- **M2c**：相关WeftMate11/11（合入IC-1/IC-2与D28后复验）及类型检查通过；Core形成／HTTP（网络请求）相关批次214/214、准确性与边界补验26/26（重叠），严格类型检查通过。最新Core完整CI（持续集成）1,719/1,719及202模块类型检查、所有门禁绿。真实Electron（桌面程序框架）指定三项最终Qwen3/3、MiMo3/3；首轮流式偏好截断／小枣拒写失败保留，未改目标、检查或600秒预算；[证据](../tests/evidence/m2c/README.md)。完整门禁见[WeftMate #58](https://github.com/memoweft/weftmate/pull/58/checks)、[Core #87](https://github.com/memoweft/memoweft/pull/87/checks)。

- **UI-2**：手机目录100/100与相关记忆 / 项目 / 续聊回归31/31、来源分页 / 按需原文 / 失败重试 / 离线列表、全屏返回位置、草稿重启、跟随系统主题、窄屏 / 横屏与输入区视口布局通过；Android JVM 27/27与调试包、类型检查、发布回归通过。截图见 tests/evidence/ui-2/。初次验收使用浏览器；安卓安装与真实系统输入法已由 UI-2v 补验，跨设备验收仍另包。
- **UI-2a**：手机交互94/94、真实 Chromium（浏览器引擎）390×844五种模式/风险确认/默认重新读取/三种决定、发布回归1/1、类型检查通过；Android 本机 JVM（Java 虚拟机）26/26与 assembleDebug通过，0.8.3/code16。合成截图见 tests/evidence/ui-2a/；没有安装本人设备、发布手机包或执行真实脚本，完整门禁交 PR CI（持续集成）。

- **M1-2**：模式/风险与原生审批19/19、界面59/59、模式接口/授权恢复/十分钟超时3/3通过，另有原生执行与来源回归；类型检查通过。真实主程序验证五种模式、数字键、批准/拒绝、总是允许此类、同对话新任务重新计划及计划拒绝、设置默认与重载；模型请求确认含模式通知及系统提示中的口头检查点。已合入最新 main 的 UI-1c，不修改其面板实现。
- **M1-2 Qwen**：仅8081 / `qwen3.8-27b-original`，原目标、检查、时限保持。action-01 **通过130.84秒**，八项检查满足且移动无审批；action-06 前两次180.45/180.46秒超时，第三次180.37秒总限失败但第一轮审批允许、文件删除、completed三项通过；第二轮未得到决定。独立删除拒绝补验180.37秒超时，仅读取、没有到达拒绝卡，不能计通过。首次请求/回合切换的停滞已在M0-7b定位为预填充/推理与原生澄清等待；无API对照，不归因纯模型能力。原生合成批准/拒绝/超时链路通过不替代这项真实模型缺口。证据见 tests/evidence/m1-2/。

- M0-6：运行参数唯一来源为仓库外 D:\AI\Config；现有 8081、`qwen3.8-27b-original`，隔离宿主 / 原生请求实读 98,304、单槽；12 次链式读取返回校验字，非空 completed、无 max-tokens，后台在主对话结束后返回。GPU（图形处理器）协调标记到达后真实按钮重启通过，进程更换、模型与容量保持；不调参或浸泡。
- M0-6 状态/容量/排队/系统权限定向测试、桌面 59 项、手机 Web（网页界面）90 项、Android BusinessRoute 定向编译/测试与类型检查通过；合入最新 main 后云测试 7 项与相关回归通过，真实 Electron（桌面程序框架）窗口补验模型状态与重启能力。修复两分钟重启被普通短请求提前中断的问题，系统重启专用等待窗 6 分钟。最终以 PR 当前提交检查为准；既有例外沿用。截图见 tests/evidence/m0-6/。Windows EPERM rename 偶发不在本包。

- **UI-1c**：真实主程序浅 / 深色验收覆盖重复写出仅列最新项及其预览、多次调用一行摘要、原始详情按需展开 / 收起 / 等宽 / 复制、连接器键盘展开 / 失败重试 / 截断提示、侧栏对齐与收起、空对话隔离。相关测试 11/11 与类型检查通过；截图及可重复脚本见 tests/evidence/ui-1c/README.md。合成账号与模型，不碰日用数据。

- **UI-1**：原有桌面交互、云配置、记忆隔离与新增真实 Electron 窗口交互验证；类型检查通过。截图覆盖浅/深色的运行、审批、提问、步骤详情、成果右侧预览、完成收起、搜索、外观与 1024px 窗口；发送/停止与 Esc、Enter/Shift+Enter、Ctrl/Cmd+N/K/B、粘贴/拖拽文件、设备偏好重载另有断言。完整套件交 CI，不碰日用数据。
- **M1-1**：统一入口 8081 / qwen3.8-27b-original / 96K，隔离宿主与随机测试所有者；密钥仅内存，未进入保险库/结果文件。原生工具、浏览器/原生网页提供方、子任务读写与 4 个成果的真实 Electron + 固定 DSH 集成通过；相关回归 52/52、范围/循环 4/4、评测器 11/11，类型检查通过。完整必过套件交 CI，已登记例外不算本包新增失败。首轮 1/6；修复提供方并将 02–04 超时调到 600 秒后，最终 **2/6（33.3%）**，未达 M1 出口 ≥4/6。

| 场景 | 首轮 | 最终结果 / 耗时 | 归类与证据 |
|---|---|---|---|
| action-01 整理目录 | 失败 114.53s | 失败 114.53s | 代码/隔离配置：Windows shell（命令行）沙盒拒绝会话目录外移动，模型申请扩大权限；场景未声明该审批，runner（评测器）取消 |
| action-02 查网页存文档 | 超时 240.45s | 超时 600.41s | 模型行为兼有代码阻碍：多次错误网址与 TLS（传输层安全）诊断，目标文档仍不存在；并行原生调用遇到宿主 TASK_NOT_READY |
| action-03 读代码回答 | 超时 180.47s | 通过 48.62s | 4 项确定性检查通过：20.00、精度解释、关键代码未变、completed（已完成）；可选 LLM judge（模型评判）未启用 |
| action-04 查资料→脚本→执行 | 超时 300.45s | 失败 233.01s | 代码/隔离配置：sum.mjs 已写，实际运行写 result.json 被 Windows 沙盒拒绝 EPERM；申请扩大权限，场景未声明该审批；result.json 不存在 |
| action-05 停止→续做 | 通过 179.36s | 通过 179.36s | 4/4 检查：首轮 aborted（已停止）且无汇总，原根任务续做 completed，目标文件含 30 |
| action-06 删除批准/拒绝 | 超时 180.41s | 超时 180.41s | 模型行为：批准一次后删除通过 3 项检查；第二轮读取“保留”文字后发起澄清，未触发预期拒绝审批 |

- M1-1 分类：沙盒写入与并行 TASK_NOT_READY 是代码/接缝问题；错误网址后诊断漂移、未触发第二轮删除审批是观察到的模型行为，未跑 MiMo 对照，不能断言为纯模型能力。超时调整依据是原预算到期仍有工具/令牌推进；没有放宽检查或自动批准未声明操作。

- S1c-Apple：相关 Swift **10 项（含 5 组坏 JWT 输入）**、真实 `services/cloud/src/main.mjs`/SQLite/file 邮件→隔离宿主与原生 TLS **2 项**通过；单个 `AppleContractStateChecks` 通过；macOS / iOS / watchOS Debug 构建通过。iOS XCTest **3/3**：注册/验证码由隔离浏览器驱动执行，Swift 完成真实 PKCE/refresh/DPoP；新设备 pending 不见内容，另一原生本地会话允许后重开/Keychain 恢复进入合成对话；QR PNG 经 Vision/CoreImage 解码并 redeem。pin 接受正确 key，拒绝错误 pin、同域同 CA 其他 key、不受信 CA、错误域名，以及错误 pin 的上传/下载。无日用数据、真实邮件、系统 CA 修改或生产中继验证；另一个用例实走 ASWebAuthenticationSession 云表单/邮件验证码/原 callback 到达 pending；生产部署与真机仍未验。
- **S2b**：本机官方 Pebble 2.10.1/challtestsrv、真实 UDP/TCP DNS、cloud SQLite/身份、真实宿主配对、官方 frpc 与 TLS adapter 闭环通过：安装 proof→AliDNS V3 假 API→TXT→签发→原子安装→TLS 握手 pin 等于配对 pin→模拟剩余29天重签；已有 TLS 连接、adapter 端口/sidecar 配置/内容 key 保持，挑战只清本服务 ID。DNS 适配器 4/4、证书失败/按天重试/重启/拒绝换 key 1/1；相关 DNS/证书/S2/云/宿主回归（含入口启动）**26/26** 与类型检查通过，npm 高危审计零漏洞。完整本地套件未跑，最终门禁交 PR CI；合成报告 `.local/s2b-pebble.json` 不进仓库。

- **S1c-Web**：桌面相关 **65/65**、手机交互 **89/89**、新密钥/PKCE/状态/凭据轮换/配对与公开配置 **5/5**、云认证/配置/宿主 **22/22**、类型检查通过；真实 Chromium 使用 file 邮件、SQLite 与隔离宿主验证本地登录→绑定→新手机浏览器等待→桌面允许→进入对话、二维码过期自动刷新/配对、拒绝、解绑与本地登录保留。合成截图 `.local/s1c-web/` 不进仓库；等待页刷新恢复也已通过；首轮 CI 五项通过：Android assembleDebug / JVM、Web Chromium 闭环、根完整必过套件、真实 MemoWeft Core、实际 443 中继；最终门禁见 PR checks。现有 public account shell 静态正则将 context 当 text 的例外仍按 CI 清单处理。

- **D1**：真实服务器 API healthz/schema 4 与 OIDC discovery（发现文档）正常；Windows 官方 frpc 经公网443，显式隔离 CA（证书机构）验证随机 hosts 域 `/personal/v1/status` 200、Secure Cookie、setup/转发伪造拒绝、撤销断流和本地登录保留；frps/cloud 日志无合成密码/Cookie 明文。原有网站状态/头/证书与非 nginx listener（监听器）进程保持，真实来源地址核对；证书模拟续期与回滚 dry-run（只检查不执行）通过。Linux 配置/真实启动测试 6/6；Windows 同组两项既有 POSIX（类 Unix 路径）断言/临时目录 EPERM 问题，完整测试交 CI。生产宿主 CA 未验。
- A3：Swift **260 项通过**；`make test-state` **11 组通过**；macOS / iOS / watchOS Debug 三目标构建通过；iOS 合成时间线 + A2 附件 XCTest **2/2**。22,000 条旧记录只取尾页，上翻 beforeSeq=21906，详情按需一次，审批/回答各一次 POST；截图见 [A3](../apps/apple/Tests/Evidence/A3/README.md)。Mac 辅助功能未授权，未申请；Watch 配对/真实触感、推送与日用宿主尚未验收。

- **S2**：Mac Node 24.21.0、官方 frps/frpc 0.71.0、真实 HAProxy + cloud OIDC/SQLite + 宿主 TLS 全链路通过；登录/Secure Cookie、CSRF/Origin/转发伪造/setup 拒绝、SSE、2,200 事件尾页/上翻、附件 SHA256、断网重连、另一已认领宿主抢域名拒绝、错误 pin/同域受信 CA 伪造证书拒绝、证书 reload 拒绝换 key、凭据轮换、云撤销现有连接/保留本地登录。双向原始 TLS 字节无测试正文/密码/Cookie 明文，约 246 KiB；撤销断流约 3–4 ms。Mac 无免密码低端口权限，本机用 **18443**，相同 443 TLS authority；Linux CI `Relay full chain (443)` 已通过**实际 443**完整场景（合成报告约 248 KiB、断流 4 ms）；修复 socket 关闭后端口清空造成的表残留已重验，最终门禁以最新 PR checks 为准。
- **S2 回归**：类型检查通过，cloud 常规 **36/36**（显式跳过单独 E2E）；相关宿主/Origin/附件/SSE **16/16**（旧 Caddy 集成显式跳过，S2 新链路另验）；下载 SHA 防篡改、TLS sidecar 配置、宿主意外退出 IPC 清理 **3/3**。隔离目录规范化后运行，不碰日用数据。证据为受忽略 `.local/s2-relay-verification.json` 与 CI 合成报告。
- S1b：身份 7/7、实际 cloud OIDC/SQLite→宿主流程、A/B 隔离、DPoP 拒绝与 SSE 撤权、云离线本地登录通过；旧 store/ID/密码/Cookie/非零同步水位和备份保持。
- MW-2：真实 Python Core RPC/持久待办/并发撤回 2/2、健康 HTTP 7/7、类型检查/预检通过；M0-3 长历史 230,000+ 范围投影与审批/提问验证已通过。Qwen / MiMo 基线及真实长任务尚未跑。

## 最近一次场景结果 · M2c 本地单槽形成

2026-10-08，真实Electron（桌面程序框架）+固定DSH（执行框架）+隔离MemoWeft Core（记忆核心）。Qwen仅8081 / `qwen3.8-27b-original`，MiMo官方接口 / `mimo-v2.6-flash`。原目标、检查与每场景600秒预算保持，可选模型评判未启用；见[定位时间线、完整证据与费用](../tests/evidence/m2c/README.md)。

| 场景 | M2b Qwen / MiMo | M2c最终 Qwen / MiMo | 核对 |
|---|---|---|---|
| memory-01 偏好 | 超时600.56s / 通过59.16s | **通过399.18s / 通过88.45s** | 完整原话偏好形成、新对话买菜例子与采用依据通过 |
| memory-03 换模型 | 超时600.64s / 通过84.33s | **通过136.77s / 通过73.81s** | 正确保存小禾并在另一模型的新对话采用；Qwen→MiMo、MiMo→Qwen，后台各自保持所配模型 |
| memory-04 人物 | 超时600.63s / 通过35.44s | **通过276.84s / 通过107.43s** | 阿岚与秋季展览／海报背景形成、召回和采用通过 |

最终Qwen3/3、MiMo3/3，**只代表本包三项，不代表完整M2出口**。M2b同一偏好任务四次推理、25分52秒才写入，300秒非流式读取空闲超时及无效顶层思考参数造成重算与单槽等待；本地改流式，沿用300秒传输空闲超时与330秒召回等待预算。首轮仅流式结果1/3，偏好选择四个相邻片段却只保存引导句，称呼两次抄成小枣且拒写；现合并相邻选中原话区间、直接呈现中文来源，不跨未选片段、不改持久哈希。最终Qwen目标形成均一次尝试、无HTTP超时重试；四份World（记忆世界）均无小莓／阿朵／小枣，最终两份均有正确小禾／阿岚／买菜原话偏好。原M2a memory-02未声明审批现象保留，纠正留M2-3。

MiMo本包全部20个实际请求均有用量：输入90,839 token（令牌），缓存54,848，输出4,829，共95,668；按官方现价计**¥0.04674596（约¥0.05）**，不是账单，包含诊断与Qwen方向换模型时的MiMo调用。四个隔离根665实际文件密钥扫描0、凭据／宿主进程0；8081原模型、98,304/单槽及无切换／活动／排队／维护租约保持。未读日用保管库、未自起模型、未停止或重启8080。Core最新ee718d6由独立源码真实MiMo、正常形成路径真实Qwen及自身完整CI验证；本仓CI仍固定已合入M2b的0a0c54c，Core由Claude squash（压缩合并）后需更新固定提交。客户端接口无变更。

## 契约变更

- **FX-9**：CLIENT_API 3.2 / 3.3 / 7.8 增加可选 `/status.executionAccount`、会话 `taskAvailable`；空白宿主首个云账号自动成为执行账号，已有旧归属不转移。受限聊天不查询任务详情，发送确认以原命令回执与匹配会话记录判断。路径、请求体和认证不变；原生回执持久化增强须包含新版 APK（安卓安装包）。
- **PJ-1 / D37 / Windows-2**：CLIENT_API 3.11项目公开对象增加 `instructions,permission`；新增 PATCH / DELETE `/projects/{id}`（必填 `expectedRevision`），移除只登记、不删除文件；3.3会话 metadata（元数据）增加 `projectId`，列表可含 `projectNotice`。旧登记默认只读原地迁移，旧六项接口兼容；项目目录只存宿主、不回传客户端。Apple 原生需接项目列表 / 新建项目对话及移动 / 设置，见3.11。

- MS-1：CLIENT_API 3.10 / 3.15 增加账户默认模型与最近聊天模型字段、`/account/models/check` 草稿检查 / 显式极小测试、逐项安全诊断和模型 `location`；旧字段保留，后台无会话不再回退启动配置。

- **UI-P4**：CLIENT_API 3.1 的 GET `/sessions` 增加可选只读 `contextUsage:{usedTokens,contextWindow}`，透传DSH（助手运行时）当前有效上下文占用及真实上限；未知占用省略，未知上限为null，旧客户端兼容。未改发送、幂等键、停止或审批接口。

- **FG-2**：遗忘预览 `items[].kind` 增加 `interaction_commitment`（交互承诺），`itemType` 为承诺／建议／约定的既有种类，纳入名称列表与 `itemCount`；独立列表与命令目标种类保持既有契约。
- **UP-3 / Windows-2**：`GET /sessions` 的运行会话可带 `processing:{phase,modelName?,ahead?}`，提供宿主记忆读取 / 实际排队 / 8081 加载 / 模型思考及文字阶段；旧客户端可忽略。见 CLIENT_API 3.3。
- **UP-2**：CLIENT_API 7.7 补桌面实际客户端 / 回调与旧本地账号绑定说明；复用 7.4 / 7.8 的 claims、binding、App（应用）内认证，无新增路径或请求 / 响应字段。绑定成功保留原本地会话，清除绑定专用云令牌；未登记远程浏览器回调。

- **UI-5 / D34**：CLIENT_API 会话章节新增 PATCH `/sessions/{id}/metadata`、POST `/sessions/{id}/fork`、`/session-groups` CRUD；列表增加 `pinned,unread,groupId,parentSessionId?` 与 `groups`，置顶优先、助手新消息水位自动未读；写入沿用账号隔离 / CSRF（跨站请求伪造防护）与权限。分叉独立工作目录及经验、原生种子谱系、不复制 MemoWeft 来源；已归档迁到设置，旧客户端兼容。
- **FG-1 / Windows-4**：CLIENT_API 3.9新增遗忘只读预览 GET `/memory/items/{kind}/{itemId}/forget-preview`、`/memory/evidence/{evidenceId}/forget-preview`；3.3新增 GET `/sessions/{sessionId}/forget-preview`，均返回范围／名称／数量／`worldRevision`。对话 DELETE 可另传 `deleteConversationSnippets:false`、`memoryWorldRevision`；D33两类界面确认框默认不勾原话删除，预览失败／修订变化不可确认。既有 `/memory/export`、状态 `memory:{state,inject}` 和受限原生错误字段保留。

- **UPD-2 / D32**：既有 GET `/status` 增加可选 `updates.layers` 只读版本 / 状态投影与 `nativeMinimumVersions` 平台 SemVer 最低要求；未新增远程更新 / 安装权限。Mac 检测清单沿用 UPD-1 签名格式，签名扩展 `nativePlatform/nativeBuild/downloadPage`，无正式源。
- **UPD-1 / D32**：CLIENT_API 3.13 `/app/manifest` 增加统一 `layer/version/channel/files`、兼容范围和整体 Ed25519（签名算法）签名；保留 `schemaVersion=1/uiVersion/assets/minNativeVersionCode` 供旧壳读取，新壳强制核签。桌面更新动作仅本机 IPC（进程间通信），未增远程安装权限；3.14静态资源继续白名单与安全头。
- **BK-1**：CLIENT_API 第 8 节 `/backups` 改为在线完成并返回 `restartsHost:false`，注销前安全备份同次确认继续；只有恢复重启/重新登录，新增 `running/deferred` 与 `BACKUP_PAUSE_TIMEOUT`。每日空闲与超时重试、凭据排除/本地未加密语义明确，S4 云加密另包。
- **SCH-1**：CLIENT_API 3.18 新增 GET `/schedules`、POST `/schedules/{sessionId}/{id}/pause|resume|run`、DELETE `/schedules/{sessionId}/{id}`、GET `/notifications`；账号/对话隔离，沿用 CSRF（跨站请求伪造）与权限，原对话 `assistant.message.data.reminder=true` 可选；纯提醒无需推理，执行继承原对话审批，保存任务不随创建登录过期、设备撤销仍拒绝。手机管理界面及 S3 远程推送另包，旧客户端兼容。
- **A5 客户端接入**：复用 3.3 / 3.5 / 3.6 / 3.17 / 4.1；普通 `/sessions` 补返回既有 `modelProfileId`（旧会话未知可为null），修复 Apple 无法确认原模型而不能发送。无新增业务路径；归档 / 删除、取消 / 插话、用量与 FIX-3 时区均已接。任务控制以 `/tasks` 的 `control` 为准，解除与 `desktopOpenApp` 的错误绑定。

- **M2-4 / D11 / D16**：CLIENT_API 3.1 新增 `GET /sessions?archived=false|true|all`、POST `/sessions/{id}/archive|unarchive`、DELETE `/sessions/{id}`（`forgetMemories` 默认false）；归档发送409，删除先停止，勾选走Core真正来源证据删除。桌面/安卓远程会话已接，Apple原生界面另包。
- **LG-1a**：复用 CLIENT_API 7.8/7.9，无新增业务路径或请求/响应字段；云密码下限对齐 UI_SPEC 6b 的 8 位，注册已验证邮箱后登记同一 App 交互中的初始设备（第二设备仍确认），App 恢复 Cookie（会话凭据）路径修正为云桥可接收/清除。独立离线密码仍为原本机要求。
- **USE-1**：CLIENT_API 3.17 新增 GET `/usage?month&sessionId`、GET/PATCH `/settings/usage`，账号隔离的 token（令牌） / 缓存 / 费用月日统计、价格与仅本月临时上限；新增 402 `USAGE_LIMIT_REACHED`，云请求达到上限拒绝、本地豁免。手机原生精确业务路径已接；Apple 按本节接线，旧客户端兼容。
- **FIX-3**：CLIENT_API 3.17 GET `/usage` 新增可选 `timeZone`，PATCH `/settings/usage` 保存账号 `timeZone`；查询缺省宿主时区，预算按账号时区当前月判定，UTC 时间戳存储不变；旧客户端兼容。

- **M1-0b**：CLIENT_API 3.5 / 3.6 / 4.1 新增发送 `intent:steer|queue`（省略默认 steer，旧 mode 兼容）、Command.intent / 原生插话 rootTaskId、POST `/tasks/{taskId}/cancel`；queued/started/ended 投影原生 inbox（收件队列）/step，保留 seq / receiptId，生命周期关联根命令 ID 与 turnTaskId。停止保留其他排队目标，取消竞争已开始时409；桌面/手机/Apple 界面另包接入，未修改界面。
- **S1e / D30**：CLIENT_API **7.9** 新增云 DPoP `/auth/account/delete`、`/auth/email/change/{request,confirm}`、`/devices/rename`、`/auth/logout/others`；撤权签名响应新增可选 `memberships:[{sub,epoch}]`，新宿主按缺失归属撤销云访问/保留本地应急登录；旧邮箱接口兼容，schema 6 不变。LG-1 / LG-2 账户设置按本节接线，删除不可恢复确认须明确云/本地范围。

- **H3**：CLIENT_API 6.4 向既有 schemaVersion=1 日摘要添加可选 `derived/hourly`（算法版本、个人恢复度、相对负荷、睡眠、小时电量 / 压力区间）；最多25个UTC小时桶，12 KiB不变，H1兼容。H3来源强制禁止云读取，较新H1云许可也不得放宽；接口路径 / 账号隔离 / 删除重试不变。
- **S1d / D29**：CLIENT_API **7.8** 新增分步注册/找回、App 内 authorization/resume、密码更改/退出、DPoP 同账号设备目录/host connect、宿主 cloud-desktop 自动绑定、受信 recipient pin 交付与本机应急密码；7.1 / 7.4 / 7.7 同步登记 origin/Cookie/电脑云 Cookie 管理资格。云 schema 6；LG-1（Windows / 网页 / Android）与 LG-2（Apple）按 7.8 接线，原账号/配对接口兼容，跨账号共享留 S5。

- **M2a**：CLIENT_API 3.4 的 `assistant.message.data` 新增可选 `memoryUsed:[{id,kind,summary}]`，记录实际保留在回复请求上下文中的 MemoWeft 依据；未命中/失败/预算移除返回空数组，旧宿主可省略。来源复用3.9账户权限接口；桌面标签已接，手机/Apple（苹果客户端）标签另包。

- **UI-2 客户端接入**：服务端契约无变更，手机 / Android接入既有 CLIENT_API 3.16资源列表与既有成果 / 来源详情；原生精确只读路由需 code17，发布默认已更新。记忆模块与桌面界面未修改。
- **UI-2a 客户端接入**：复用 CLIENT_API 3.7，服务端契约无改动；手机 Web（网页界面）/Android 已接会话模式、账户默认与 scope/decisionScope/riskCategories。Android新增精确模式桥接，最低原生code16；Apple由另包接入。

- **M1-2**：CLIENT_API 3.7 新增 GET/PATCH `/sessions/{sessionId}/approval-mode`、GET/PATCH `/settings/approvals`；审批新增可选 `scope` 和返回 `decisionScope,riskCategories`，旧客户端省略 scope 仍允许一次。分类授权仅本对话；待答复十分钟失效并返回原生 unavailable。原生计划使用已有 questions 的 plan-review（计划确认）意图。手机 Web（网页界面）/Android 菜单已在 UI-2a 接入；Apple 菜单另包，接口可用。

- **UI-1c**：CLIENT_API 3.16 的 `outputs` 按同会话 `fileName` 保留 `createdAt` 最新项，旧成果按原 ID 仍可访问；`uses[].summary` 优先动作 / 文件名 / 可读调用描述。字段与详情端点不变。

- **UI-1b**：CLIENT_API 3.16 新增只读 `GET /sessions/{sessionId}/resources?afterSeq`，按已有成果 / 文件与网页快照 / 工具时间线分页聚合，不新增存储；使用记录按 callId 去重、详情仍走旧端点。Apple / 手机可忽略新接口；记忆自动注入没有公开的逐条引用，不伪造来源。

- M0-6：CLIENT_API 3.15 新增 model.currentModelId / lastSwitch，状态与重启改接现有 ModelSwitcher；未配置为 unconfigured；GET /system、模型/宿主/记忆重启、GET/PATCH /settings/models 兼容，后台配置按账户保存，手机只读配置 + 重启，Apple 待接入。

- M1-1：CLIENT_API 4.1 新增可选 artifacts 数组，同一原生 seq 可带多个成果，旧顶层字段仍是首项；成果接口不变。原生写文件自动登记，个人预设移除专用工具与回合限次；cwd 为宿主 conversations/<sessionId>。
- S1c-Apple：客户端接入现有 7.2/7.4/7.6 和 S1c-Web 正式 7.7 的 wm_device_id/wm_public_jwk、URL QR/wm1 编码，HTTP 契约未扩展；第 5 节记录原生能力与账号页/目录/可信 pin 交付缺口。官方 native client 拟用 `weftmate-apple` / `com.weftmate.apple:/oauth/callback`，须由云部署登记；7.7 bootstrap 已接入，仍不能自动信云目录 pin。Watch 不改。
- **S2b**：CLIENT_API 7.6 的 `/status.relay`（及 pairing relay）新增可选 `certificateExpiresAt` UTC/null、`certificateErrorCode` 代码/null；受限 DNS 接口形状保持，present 等权威 TXT 可见、provider/传播/区错误明确，cleanup 按自有 RecordId 幂等。云 schema 5 新增 DNS 所有权表；内容 pin/安装签名/凭据/客户端路径保持。

- **S1c-Web**：CLIENT_API **7.7** 增加宿主 GET `/cloud/config` 与已认证 GET `/cloud/binding`；云客户端可配 application_type，OIDC 设备公钥隐藏字段与预登记回调 origin CORS、表单回调 CSP；浏览器 fragment 回调和 wm1 配对编码、Android code 15 的系统浏览器 scheme/Keystore/SPKI。既有认领/配对/DPoP/CSRF/本地数据语义保持。相机与 Apple/真机另包。

- A3：现有 3.4 / 4 契约已接入 Apple，服务端接口未变；第 5 节历史/时间线差异标「已在 A3 修复」。上翻与正向水位独立，离线缓存分块读取；回合键不作为 /tasks 根 ID，成果以账号/会话授权元数据取根绑定。Watch 通过 iPhone 原生连接，不共享宿主凭据。

- **S2**：CLIENT_API **7.6** 新增中继 base URL、宿主离线/断流语义、目录/凭据/轮换/撤销/受限 ACME TXT；`GET /status` 增添 relay，已认证直接地址 `/cloud/pairings` 增添 relay 且原 tlsSpki 对应实际 TLS key。路径/ownerId/历史游标/Cookie/CSRF/setup 保持；S1c 需接原生 pin 与新 base URL。
- S1b：7.4–7.5 宿主认领/绑定、cloud-nonce/cloud-session、内容设备决定/配对、签名撤权；host:session 指定宿主 resource + DPoP；云 epoch 与本地分开。
- MW-2 / H2：第 6 节健康摘要/迟到水位、memory.state=delivered 与 queued/empty，observed 权限/撤回与 model_tier；需 observed v1 Core。
- S1a：第 7 节云账号/邮箱/OIDC/epoch/PKCE。M0-3 / M1-0a：3.4 / 4 尾页、beforeSeq/afterSeq、seq 详情与时间线；Apple 已在 A3 接入并移除 historyLimit；排队/插话另包。

## 已知问题与未做

- **M1-2 / M0-7c**：Qwen action-06第二轮澄清超时；MiMo首轮允许后出现unknown tool "pweff"并再次审批，两边失败列待查代码问题。动态写入/自身文件修正审批仍待查；跨会话形成/注入指定三项已在M2c通过，记忆纠正留M2-3，见最近场景表。手机/Android菜单已在UI-2a完成，Apple菜单已在A4a完成；真机/跨端验收及长期稳定性另包。风险判断集中在可见参数、常见命令、内联与本地脚本源，动态生成/未知二进制副作用没有静态识别保证；没有新增沙盒范围、白名单、限次或审计层。

- **UI-1 契约缺口**：`GET /sessions` 缺少日期、未读及跨会话审批汇总；有真实时间时可分组，无日期时显示「会话」，审批点只来自已读取的真实审批。未提供会话重命名/删除/归档、删除关联记忆、可取消排队、记忆引用、成果在文件夹显示及任意网页/成果图片预览接口，不造按钮或数据；已有 queue/steer（排队/插话）参数已接。助手文字使用持久消息，原生文字 chunk（片段）目前不在契约中，真正逐字流式输出另包。外观按设备保存；字体、自定义色、密度及账号同步不在本包。截图来自独立 Electron 验收入口，不代表 `src/main.mjs` 全套启动或 macOS 原生 App 已验收。
- M1-1c（依赖 #41）：电脑文件范围、不同根并行与子任务网页已修复；当包六场景1/6（03）；最新M0-7b基线4/6，仍未达完整M1出口。D12 五种模式与常见危险操作判断由 M1-2 接入，真实Qwen/MiMo失败与对照见上；跨端与长期稳定性未验。

- **S1c-Apple / D29 客户端待接**：S1d 已补 CLIENT_API 7.8 App 内注册/找回/OIDC 交互、账号设备/宿主枚举、连接和已有设备可信 pin 交付。LG-1 / LG-2 须接完整登录页、设置账户/设备、相机或可信设备传输与原生验签/固定 pin；云 HTML（网页标记）兼容表单仍非完整注册页，D29 不依赖它。生产预登记客户端、真机 Secure Enclave（安全隔区）/相机及中继部署尚未验；本包不改 Apple / 前端、不部署。
- S1c-Web 未部署；云需预登记实际直接/中继回调与 Android client。Android 本机没有 SDK/Gradle，已在 CI 完成构建/JVM；实际系统浏览器往返、CA+SPKI 拒绝的真机验收和相机扫码另包（本包输入配对码，无新增权限），Apple S1c 另包。宿主离线仍按 S2 的网络失败语义，S6 离线聊天另包。

- D1 已完成真实云/systemd（系统服务管理）私有证书权限、既有443共存与 API/relay 生产 CA；API/relay/hosts DNS 已就绪。S2b 已交付阿里云 DNS provider 与逐宿主自动签发/续期/安装/热载，尚未部署：本人需创建指定 DNS 区增删权限 RAM 子账号并私下配置凭据、升级 cloud schema 5、开启宿主 ACME；生产 AliDNS/Let's Encrypt、真实 Windows/五端 pin 真机与长时续期尚未验。掉电残留 TXT 的后台清扫、内容 key 轮换、已撤销宿主重新启用留后续包。Windows 验收使用隔离 CA，不能代表普通浏览器生产内容证书已就绪。
- frp 此版无踢在线 client 的管理 API；本包用云必经 TCP socket 所有权立即断流。部署不可绕过入口或公网暴露 frps/plugin。D24 普通浏览器允许，云/DNS 主动完全控制时仍可能被冒充；原生另 pin。
- MW-2 部署需升级 observed v1 Core；真机上传/日用模型/vendor 未验。M1-3 极少上下文先压缩待做。
- 根单测 BUG-1：[PR #69](https://github.com/memoweft/weftmate/pull/69)修复停止回执快速重启不重试、图片暂存释放后原请求重试404、Windows Mod（模组）崩溃启动记录并发EPERM；knownFailures（已知失败）2→0，恢复为必过单测，空清单观察步骤报告零项。[唯一一次全平台CI（持续集成）](https://github.com/memoweft/weftmate/actions/runs/37752917631) Linux788/macOS789/Windows794通过、均0失败，三条历史用例均通过；Windows完整Mod文件单独30次重复510/510、WSL（适用于 Linux 的 Windows 子系统）停止/附件7/7通过。固定DSH vendor（运行时依赖）/Design外部夹具与两个无关Linux/macOS平台例外保留，无Windows排除项；未新增例外或延长超时。Windows中继打包/真机与S1c客户端留后续包。

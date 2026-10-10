# 当前状态

> 只写现在，整页覆盖，不追加日记。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-09

## 当前里程碑：M0 重置 / 轻云并行

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows-5 | CI-R1 · 完整中继手机场景 | [PR #191](https://github.com/memoweft/weftmate/pull/191) · `wp/ci-r1-relay-phone-scenario`：独立 Linux CI（持续集成），复用真实云身份／设备批准／HAProxy（传输代理）／frp（隧道）／TLS（加密传输）；手机390×844交替10次、历史延迟2秒，首次输入零丢失／仅发送一次。原生DSH（助手运行时）合成模型读／写／读回，手机3次审批，磁盘／成果库来源与预览／可见完成通过；[恢复后实跑](https://github.com/memoweft/weftmate/actions/runs/38048427596)合MOB-P1主线后场景83.795秒、job（任务）2分42秒（恢复编译缓存），[故意破坏加载锁](https://github.com/memoweft/weftmate/actions/runs/38045983528)正确失败并已恢复，原中继job通过。相关单测34/34、合主线后补验37/37、语法／类型检查通过；未改产品代码，无契约变化。临时Linux项目目录、身份助手准备／真实回执恢复界面；Windows文件夹登记、邮箱表单与离线副本不计验收。自有进程残留0，Linux手动命令见SETUP。 |
| Codex · Windows-3 | R0-3 五端夜间回归自动化 | [PR #168](https://github.com/memoweft/weftmate/pull/168) · `wp/r0-3-nightly-regression`：专用回归树刷新主干，真实 Electron（桌面程序框架）／390×844网页浅深、Apple（苹果端）A10／A15自有AX（辅助功能控件树）＋iPhone／配对Watch、独立MuMu（安卓模拟器）包顺序运行；本轮新图隔离、24小时／缺图／失败／像素报警、14天保留、占用跳过与时限清理；03:00交流电计划任务脚本已提供，未注册。手动全主控约190秒：Windows32/32、网页32/32；Apple因A16完成标记缺失、MuMu因其他测试包占用均0新图，90项报警及后备桌面通知正确，不能称五端完整验收。故障注入／锁／1分钟超时／4c清理通过，13项定向、类型及安卓独立包构建通过；[证据与待补](../tests/evidence/r0-3/README.md)。Apple新增原生运行器与连续三晚待空闲补验，既有网页记录不可查看提示保留；无接口／权限／版本变更，本包进程残留0，完整CI（持续集成）见本包PR（拉取请求）。 |
| Codex · Windows-5 | FX-18 · 记忆形成重启恢复 | `wp/fx-18-formation-recovery`：[PR #187](https://github.com/memoweft/weftmate/pull/187)。宿主启动主动打开已有记忆库，空 outbox（持久待提交队列）也恢复；Core（记忆核心）以实例操作系统锁回收已退出持有者，正常退出先归还，令牌隔离与原子应用保证不重复、回收不耗失败次数。[Core PR #100](https://github.com/memoweft/memoweft/pull/100)，固定 `c6d449d` 待 Claude 压缩合并后替换。真实 Electron（桌面程序框架）退出矩阵 27/27，形成 9/9 在重启后 7.31–8.98 秒重新处理、7.56–9.21 秒健康正常（原 271–285 秒）；36 来源／作业／正式对象无重复，形成及聊天最后原话各 9/9 保留。完整必过单测 1,290 通过／0 失败，类型检查通过；Core 本地 120 项、Linux CI（持续集成）1,918 项通过。设置与动态显示继续整理，浅深／窄窗／手机截图通过；残留 0，记录 72 个 Core 进程均退出。未使用真实模型、未动日用数据。最终 CI 交 Claude。[证据](../tests/evidence/fx-18/README.md)。 |
| Codex · Windows-5 | FX-19 / FX-19b · 会话新建延迟 | [PR #189](https://github.com/memoweft/weftmate/pull/189) · `wp/fx-19-create-latency`：复用DSH（助手运行时）原生预设挂载，文件变化／挂载期间编辑／来源删除失效；单会话身份核对、等待已落盘创建回执、确定失败清发送锁。真实Electron（桌面程序框架）同批100／500／2000各新建20、切换20、列表各30；新建p95（第95百分位）360→146、1938→414、9667→832毫秒，500／2000均20次零超1秒，500列表p95 73／39毫秒。500切换p95 130毫秒、首批最大1156毫秒未达预算，单历史读取1118毫秒；主线合入后补测新建292、切换77毫秒。手机390×844新建10次p95 242毫秒；草稿20/20、删除／遗忘三组、FX-18 Core（记忆核心）c6d449d退出抽样3/3通过。定向143/143、回执故障18/18、合主线UI（用户界面）57/57、UX-6合入相关49/49，类型检查通过；完整必过单测1338通过／0失败／14条原条件跳过。客户端契约与手机母版已同步，无新路由／新壳／权限，遗留DSH日志路径扫描与偶发历史I/O（输入输出）长尾；额外清理6个本包进程／残留0，最终CI（持续集成）交Claude。[证据](../tests/evidence/fx-19/README.md)。 |
| Codex · Windows-4 | UX-8 · 回复进行中的轻动效 | `wp/ux-8-reply-motion`：Windows（视窗桌面程序）、手机网页与安卓界面包共用微光 1.8 秒、状态切换 / 发送 / 完成 150ms（毫秒）、片段 120ms、贴底 160ms；设置 → 外观可跟随系统或开启减少动态，隐藏 / 原生最小化暂停。图表工具右对齐、深色去重阴影、画廊图标按钮 44px（像素）；32 项交互、336 帧浅深证据、阅读锚点与高度漂移 0px。15,480 字更新 p95（第95百分位）桌面 8.5→3.6ms / 手机网页 8.6→1.4ms / 安卓包 7.8→1.2ms；可见工作动效额外约 2 个百分点的渲染 / GPU（图形处理器）进程 CPU（处理器占用），如实保留。MiMo（小米模型服务）真实思考 / 读取文件 / 长回复 / 停止通过；宿主正文仍只观测最终一帧，增量效果用合成流验证。完整必过单测 1298 通过 / 0 失败（12 项既有跳过）、合主干回归 57/57、类型检查与移动资产检查通过；安卓版本号由主干编排保留，本包无新业务契约，Apple（苹果端）原生清单交结果。见 [证据](../tests/evidence/ux-8/README.md)。 |
| Codex · Windows | M0-6 现有模型入口、后台路由与系统状态 | [PR（合并请求）#33](https://github.com/memoweft/weftmate/pull/33) 方向调整完成：接入 D:\AI 的 8081 ModelSwitcher（模型切换代理），删除自起模型与参数；98,304 / 单槽 / 12 步与后台排队冒烟通过，M1-1b 完成后真实按钮重启通过；最终 CI（持续集成）见 PR 当前提交 |
| Codex · Windows-7 | UX-6／UX-6b 搜索面板与侧栏顶部（D53） | [PR #186](https://github.com/memoweft/weftmate/pull/186)：UX-6b返工完成；手机抽屉顺序／令牌间距／标题对齐与新对话下拉、桌面提示行贴底、主对话底色及聚焦环、人话时间与完整日期已修正。浅深真实程序1200／480px、手机网页与安卓界面包390／360同名重拍，保留修复前后证据；模拟器被M3-1／AND-1占用，本包明确沿用无系统栏界面包例外。完整必过1329通过、0失败、14既有跳过；45项定向、17项动作、交互取证、类型检查与母版生成通过。已合UX-7与安卓36／0.8.23主线，未改版本号或新增接口／壳能力；推送后查看CI（持续集成）。[证据](../tests/evidence/ux-6/README.md) |
| Codex · Windows-2 | FX-16 · 草稿与会话列表收尾 | `wp/fx-16-draft-and-session-list`：已合主线82c62fce，草稿恢复 / 身份切换保护、分页索引、安卓整理预览、第二账号说明完成。合并后定向187/187、安卓JVM（Java虚拟机）12/12、类型检查通过；真实Electron（桌面程序框架）与390×844网页2秒延迟零丢字。真实原生500会话列表p95（第95百分位）55.9 / 63.2毫秒、新建可输入702.6毫秒达标；既有2000会话新建5754.5毫秒未达1秒，原因分析与后续项见[证据](../tests/evidence/fx-16/README.md)。既有65轮30分钟零超时；本次未重跑长测 / 2000 / 真实模型。安卓需新壳支持分页查询，版本留主线值由Claude统一发布；CI（持续集成）最终结果交Claude。 |
| Codex · Windows-6 | UX-7 · D51 下一步建议 | [PR #185](https://github.com/memoweft/weftmate/pull/185) · `wp/ux-7-next-suggestions`：宿主短请求 / 真实取消、账户同步开关、机会式单槽不排队 / 不重试、数值用量单列、共享上方条位与灰字补全已实现；真实Electron1200 / 480、手机网页 / 安卓界面包390 / 360浅深主矩阵216场，输入位移 / 高度变化0px；手机点灰字 / 右滑、真实安卓POST / DELETE与浅深6图通过；MiMo最终5轮14条、1.34–4.52秒，全部批次用量留证。完整必过1330项（1318通过 / 0失败 / 12条件跳过）、类型检查通过；最新调度 / 宿主39/39，原生路由14/14。已清理10进程、残留0；外部客户端竞争窗口需要模型代理原子机会式入口，当前日用代理未改。CI见PR检查，见 [UX-7](../tests/evidence/ux-7/README.md)。需要新安卓壳版本，由Claude统一递增；Apple接线清单已写。 |
| Codex · Mac-2 | H3 设备端健康指标 | [PR #67](https://github.com/memoweft/weftmate/pull/67)（`wp/h3-health-metrics`）：iPhone / Watch 本地恢复度、电量、负荷、压力区间与睡眠；日 / 小时摘要沿用 H2 隔离队列且强制仅本地模型；最小健康页 7/30 天趋势。Swift 相关22/22、宿主10/10、iOS / watchOS Debug 构建通过；隔离模拟器真实 HealthKit→计算→H2 HTTP→健康页闭环通过，[合成截图与验证](../apps/apple/Tests/Evidence/H3/README.md)；完整 CI 见本包 PR；不含真实设备、后台持续采集、Core delivered 或 AI 建议验收。 |
| Codex · Mac | UPD-2 Apple 更新（D32） | [PR #99](https://github.com/memoweft/weftmate/pull/99) · `wp/upd-2-apple-updates`：原生关于页版本 / build、所连宿主三层状态、按平台最低版本提示与拒绝不兼容连接已接线；Mac 因 Sparkle 沙盒安装器新增权限及 delta 失败全包回退采用授权最小口子，UPD-1 整体 Ed25519 签名检测 + 打开下载页，默认未配置；iPhone TestFlight / App Store，无执行代码热更。Swift 相关31/31、Node 相关21/21、类型检查、iOS / Mac Debug 构建通过；Mac 本地临时签名清单检测 / 篡改拒绝与 iPhone 原生2/2通过，[6图与验证边界](../apps/apple/Tests/Evidence/UPD2/README.md)。Mac XCTest 因自动化授权未执行，改用自身窗口捕获；完整 CI 见本包 PR，正式来源 / 签名身份 / 安装器接线交 UPD-3，待 Claude 审查。 |
| Codex · Mac | A16 Apple 主对话 / 临时对话（IA-5 / MEM-2） | [PR #167](https://github.com/memoweft/weftmate/pull/167) · `wp/a16-apple-main-chat`：主对话、日期 / 搜索 / 来源、逻辑发送附件、临时记忆与期限、404 清理、Watch 主对话投影；D49 本人消息只读与按需时间 / 复制，助手操作按需出现。移除 SwiftUI 几何偏好闭包，使用有界按天布局与原生像素锚点。61 项 Swift 单测、2 个状态程序、9 项文案 / 令牌检查；原生浅深、配对 Watch、最终 Mac 20 次启动与零新增崩溃见[证据](../apps/apple/Tests/Evidence/A16/README.md)。应用内弹层截图齐；系统保存面板的外部内容捕获 / iPhone 取消 / 实际落盘未全部验证，边界已列出。CI 最终结果由 Claude 检查；未部署、未合并、未改系统权限。 |
| Codex · Mac | A15 Apple UX-2 / UX-3 | [PR #158](https://github.com/memoweft/weftmate/pull/158) · `wp/a15-apple-ux23`：Mac 悬停置顶 / 归档 / 更多与完整提示、归档撤销，账户 / 项目最近 5 条及本机展开偏好；同账户月份用量、头像 / iPhone 设置用量条；原生附件菜单、会话深入思考与创建回执重试、D36 占位、真实子任务合并 / 三态 / 耗时 / 步骤定位已接线。Swift A15 9/9、状态程序 2/2、文案 / 令牌 12/12；iPhone 浅深 XCUITest 2/2，Mac 浅深 App 内原生 AX 2/2及创建成功 / 思考回应丢失重试通过；[原生证据与边界](../apps/apple/Tests/Evidence/A15/README.md)。Mac XCUITest 因 automation mode 初始化超时未执行，不计替代结果为 XCUITest；媒体注入合成文件 / 图片，未读本人剪贴板或桌面，未验真机相机 / 真模型 / 生产中继；无服务端契约 / 权限变化；已清理本包全部进程与模拟器，残留 0；完整 CI 见本包 PR，待 Claude 审查。 |
| Codex · Mac | A14 Apple 电脑离线模式（D13 / D39 / S6） | [PR #151](https://github.com/memoweft/weftmate/pull/151) · `wp/a14-apple-offline`：iPhone / 作为远程客户端的 Mac 已接 M3-A，原生 RSA-OAEP-256 / AES-GCM 与 ThisDeviceOnly Keychain 加密副本和离线对话；按宿主 / 账户隔离、云授权与清理代次前后核对、相关记忆直连账户云模型、稳定轮次与依赖幂等补交，回执只称「已同步」；遗忘 / 撤权 / 换账户清旧钥匙和历史，迟到响应不复活。Watch 离线投影无审批。Swift 定向13/13、宿主离线7/7、云撤权1/1、设计 / 文案8/8、账户状态检查通过；iPhone XCUITest完整闭环1/1、Mac浅深2/2，10张原生截图和存储正文 / 密钥零命中见 [A14证据](../apps/apple/Tests/Evidence/A14/README.md)。Mac / iPhone / Watch Debug构建通过；MiMo因Machine环境变量不可用使用合成HTTP替身，Core为合成摄取边界，未把补交回执称为正式形成；未验真机 / 真实Windows / 生产中继，无权限或服务端契约变更；已清理全部本包进程与模拟器；完整CI见本包PR，待Claude审查。 |
| Codex · Mac | A13 Apple 界面一致性 | `wp/a13-apple-consistency`：跟随 UX-1，Mac / iPhone 输入区共用审批 / 逐题提问条，审批优先、余数、说明、单选 / 多选 / 其他；原契约整批回答，有效回执 / 精确读回立即移除并留一行回答，持久原请求、身份 / 来源校验与重试保留。Mac 原生焦点 Return 按钮；ui-core 中文操作 / 参数表生成到 Swift，来源 / 步骤 / 审批 / 详情 / 错误及 Watch 同表；设备时区中文日期与 24 小时制，共用月份 / 跨年选择；清理密度 / 语言静态行和过时设备说明。Swift 定向52/52、状态程序2/2（回应11项）、Node文案 / 资源8/8；Mac浅深2/2、iPhone浅深2/2、配对Watch1/1零跳过，53原图 / 原生多行文字 / 回执见 [A13证据](../apps/apple/Tests/Evidence/A13/README.md)。已合最新main并补验宿主兼容；完整CI见本包PR，待Claude审查；无接口 / 权限 / 日用数据 / 发布 / 部署变化，编译DSH / 真模型 / 真机 / 生产中继未验；已清理本包全部进程与模拟器。 |
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

- **M3-1 / Windows-3**：CLIENT_API 3.2增加 `/status.presence`（宿主、运行时、模型、授权、启动标识），`/sync/events.presence`提供轻量宿主／启动投影；独立状态探测归并中继502／503／504不可达，业务／模型失败不判离线。原路由、游标、命令编号及附件身份保持；安卓网络错误分类与状态探测预算需新壳版本，版本由Claude统一递增。

- **UX-P3 / Windows-6**：CLIENT_API 9.8 的动态 `notification` 新增可选 `title/body`，由宿主统一生成完成 / 失败 / 审批 / 提醒系统通知文案；桌面 / 安卓优先消费、旧宿主回退原字段，临时内容沿隐私脱敏。安卓需要新壳版本，由Claude统一递增；Apple消费相同字段。
- **FX-16 / Windows-2**：CLIENT_API 3.3会话列表新增可选 `limit,cursor,q` 与分页回执（旧客户端省略limit保留完整枚举）；3.2状态新增 `executionAccountName`，仅执行账号昵称，邮箱回退「原账号」。安卓需新壳放行 `/sessions` 查询；无新增权限。
- **FX-19 / Windows-5**：`GET /status.personalCapabilities.creationReceipt:1`；既有 `POST /commands` 的 `session.create`／`session.side.create`可选 `waitForReceipt:boolean`，不参与幂等身份，在既有调度最终落盘后返回同一202命令。超时／断线查询原回执，原重启规则不变；安卓现有命令白名单覆盖，无新路由／新壳，Apple（苹果端）原轮询兼容。详见CLIENT_API 9.4。
- **UX-6 / D53**：CLIENT_API 9.3 扩展既有 GET `/chats?scope=search`，账户隔离的主／旁聊标题与正文命中、原来源定位、分页计数、删除／遗忘及临时代次失效；原路径白名单已支持，仅补安卓允许／拒绝测试，无新增路径或新壳能力。

- **UX-9 / Windows-2**：CLIENT_API 3.2 状态增加可选 `hostName`；3.11 项目增加 `pathHint`（路径末两级）。完整路径仅本机可信原生桥可取；浏览器任意路径登记返回403 `PROJECT_NATIVE_SELECTION_REQUIRED`。沿用现有项目 / metadata 路由、权限与审批，无安卓路由白名单变化。
- **UX-7 / Windows-6**：CLIENT_API能力`nextSuggestions:1`，POST / DELETE `/sessions/{id}/suggestions`（按requestId真实取消）、账户`nextSuggestionsEnabled`默认true、`/usage.categories`单列`next-suggestions`。建议为暂态，不进历史 / 记忆 / 导出；新增安卓精确路由，需新壳，由Claude统一递增，Apple接相同契约。
- **FX-18**：既有 `/memory/status` 与 `/system.memory` 增加 `state=recovering`（继续整理中）、`reasonCode=MEMORY_FORMATION_RECOVERING` 和可选 `recoveringFormationCount`，完成后回到 `ready`；能力仍按 `capabilities`。设置与动态文案同步，动态复用 `memory.report`。无新增路由或原生权限，不需要新安卓壳；Apple 客户端需识别新增状态。

- **FX-16 / Windows-2**：CLIENT_API 3.3会话列表新增可选 `limit,cursor,q` 与分页回执（旧客户端省略limit保留完整枚举）；3.2状态新增 `executionAccountName`，仅执行账号昵称，邮箱回退「原账号」。安卓需新壳放行 `/sessions` 查询；无新增权限。
- **FACT-1 / Windows-7**：既有 GET/PATCH `/settings/personalization` 新增 `researchSelfCheck:boolean`，默认 true，按账户保存、下一回合生效；关闭额外自查仍保留出处与未确认说明。来源片段复用现有会话详情接口，无新业务路径。
- **UX-P3 / Windows-6**：CLIENT_API 9.8 的动态 `notification` 新增可选 `title/body`，由宿主统一生成完成 / 失败 / 审批 / 提醒系统通知文案；桌面 / 安卓优先消费、旧宿主回退原字段，临时内容沿隐私脱敏。安卓需要新壳版本，由Claude统一递增；Apple消费相同字段。

- **A16 / D49**：沿 CLIENT_API 9.3–9.7 / 第10节接 Apple 主对话与临时旁聊，不增加宿主接口或权限。3.3 文案按本人新决定移除已处理用户消息的编辑入口；助手重新生成仍沿既有主对话来源旁聊 / 原生 message-branches 回执，排队编辑 / 撤回不变。
- **TB-3 / Windows-4**：CLIENT_API 9.9新增GET `/library`、`/library/{id}`、`/library/{id}/preview` 与桌面专用POST `open / show`；精确能力 `library:1,libraryPreview:1,libraryDesktopActions:1|0`。文件原生回执、来源时间线与项目身份复用，临时排除、D33索引失效，不删用户文件。安卓桥加入三条只读精确路由，需要新壳版本，由编排递增；Apple按9.9接线。
- **S3a / Windows-3**：CLIENT_API 9.8.2 增加宿主 `/push/registration`、云 `/cloud/auth/push/registration`（GET/PUT/DELETE），`pushRegistration:1`；当前设备绑定、token（令牌）不回显、撤权 / 注销清理，提供方明确未配置，载荷仅事件 ID / 类型。Android（安卓）读取动态宿主决定、原审批回执与解锁、WorkManager（安卓后台任务库）补发、本机通知状态 / 系统跳转，桥返回 `activityDeliveryVersion:1`，需要新壳版本；Apple（苹果端）9.8.2 清单待后续包，未改 `apps/apple`。

- TB-2（2026-10-10）：CLIENT_API 9.9增加精确版本1的taskOverview / scheduleEditing / goals、跨对话任务读接口、定时新建 / 修订编辑 / 幂等运行、原生目标新建 / 完成 / 归档；3.18兼容月历规则与结果字段。账户隔离、D33原生派生说明清理及临时来源脱敏，Apple与TB-4按同一母版接线。
- **FX-17**：CLIENT_API新增 `failedCorrectionCount/formationIssues`、`POST /memory/formation/{jobId}/retry`；动态复用 `memory.report/view_memory`，旧来源可返回 `superseded_by` 纠正原话。Apple需接状态与重试；安卓界面包沿用既有记忆路由，无新增原生权限。
- **UX-P1**：`GET /memory/items` 增补 `kind=all`、`includeSources=true`、`totalCount`、`sourceConversationIds`；旧默认 cognition 不变，游标继续绑定账户／类型／查询／版本。Apple 见 CLIENT_API 3.9。
- **ST-6 / Windows-4**：CLIENT_API 9.8.1 新增 GET/PATCH `/settings/notifications` 与 POST `/settings/notifications/test`，`notificationSettings:1`；动态 `notification` 追加 `notify,sound,decision,reason,initiatedBy,decidedAt`，新类型 `system.dnd.summary,system.notification.test,companion.greeting`。账户时区复用用量设置；S3a / Apple消费宿主决定，不再自行判勿扰或计数；安卓新增精确桥接路径，需要新壳版本，由编排递增。

- **ST-1 / Windows-4**：新增账户 GET/PATCH `/settings/personalization`、POST `/settings/personalization/style`；离线加密副本追加 `personalization`，助手消息可追加展示专用 `modelThinking`。原思考能力／会话接口和记忆输入不变；Android（安卓）code27，Apple（苹果端）接线见证据。

- **ONB-1**：新增安装 `GET/PATCH /onboarding` 与账户只读 `POST /models/discover`；沿既有认证 / CSRF（跨站请求伪造防护）、模型保存 / 诊断、记忆和配对流程；Apple（苹果端）按 CLIENT_API 第12节接线。

- **TB-1**：CLIENT_API 9.8正式增加 ctivity:1/activityChanges:1/activityRead:1/activityNotification:1、动态列表 / 增量 / 未读 / 单项与快照已读；原同步事件通道增加无正文动态水位，动作直达原审批 / 问题路径。账户签名游标、原任务结果身份、D33删除增量、临时脱敏与重要 / 普通 / 静默通知字段见9.8。
- **UX-4**：CLIENT_API 3.3 新增消息锚点 `POST/GET /sessions/{id}/message-branches` 与完整消息详情，创建后用返回的 `sendRequestId` 走既有 `session.message`；原版与新版可切换，模型只改新分支，原有 `/fork` 不变。主对话走 `session.side.create` 来源引用；`task.queued.inherited` 对齐原生种子队列。反馈只存设备；导出先脱敏预览。安卓保存桥最低code27，Apple改动清单见UX-4证据。
- **MEM-D**：CLIENT_API第11节新增账户 `GET/POST /memory/backfill` 预览、确认、暂停／继续／取消；记忆状态及设置健康增加形成计数、等待／失败原因与补整理进度。旧字段兼容，新增回合持久摄取，历史默认不自动跑；MEM-2排除与确认／来源权限保留。Apple需按第11节接线；安卓界面包沿现有记忆业务桥。


- **FX-15 / Windows-5**：记忆 sources（来源）可追加 `role:"assistant"`、`messageId`、`conversationId`，展示已确认提议原话；既有原文字段与权限保留，详见 CLIENT_API 3.9。
- **MEM-2 / Windows-2**：CLIENT_API第10节：`temporaryChats=1`、`session.create.temporary`与手机`POST /sessions/temporary`；会话/逻辑旁聊元数据增加记忆、独立召回、期限，列表增加`temporary,memoryMode,recallEnabled,autoDeleteDays,expiresAt,hasTemporaryContent`；历史`cacheAllowed:false`禁写离线缓存，Android（安卓）最低code26；主对话保护、旧回合策略与新备份过滤，Apple（苹果端）接线见第10节。
- **IA-3**：CLIENT_API 9.6 补齐原件 `PUT /sync/attachments/{id}` 以主对话 `chatId` 使用同一逻辑暂存身份；不创建执行段，原账户 / 命令 / 原件授权保持。

- **UX-3**：模型目录只读 `deepThinking` 能力，`GET/PATCH /sessions/{id}/thinking` 与会话 / 逻辑对话偏好；时间线步骤可选 `subtask` 元数据与原生 `subtask.updated` 终态。安卓code25新增相机选择与推理偏好业务路径，原发送 / 附件回执不变。
- **IA-2b / 2.6**：CLIENT_API 9.7增加 `chatLifecycle:1/chatResources:1`、旁聊逻辑元数据/归档/删除、跨段聚合遗忘预览与资源分页；D33同时清理原生修订校验的公开投影缓存，首次未命中范围读取限制明示。

- **IA-2b / 2.4**：CLIENT_API 9.6 增加 `chatSend:1`、`chat.message`、主对话附件暂存及 `contextOrganizing/relayError`；原命令查询/回执复用，待发消息在原子切段后绑定，已受理回执不重新路由。定时原生管理身份保持，主对话投递跟随逻辑身份。

- **IA-2b / 2.5**：CLIENT_API 9.5 登记统一 D33 清理；内容修订变化要求清空旧缓存，旁聊 `contextTransfer.sourceDeleted=true` 表示来源清除；清理未完成新发送返回既有 `SESSION_BUSY`，结果墓碑不能重新发布。M3-A 沿既有 generation（副本代次）清理。

- **UX-2**：`GET /sessions` 增加执行电脑 `hostId` 与可选真实活动 `updatedAt`；客户端缺时间时不伪造，既有用量接口与权限不变。
- **IA-2a / 2.3**：CLIENT_API 9.4正式增加 `sideChats:1`、`session.side.create`、来源/仅引用转移状态、`POST /chats/{id}/results`及`side.result`历史投影；原命令回执复用、同一结果/动态/通知身份，临时和共享来源拒绝回写。未启用逻辑发送或接力。

- **IA-2a / 2.2**：CLIENT_API 9.3 正式增加 `chatTimeline:1/chatSearch:1` 与 `/chats/{id}/events|changes|dates|locate|search`；独立历史/增量游标、稳定来源/顺序、中文子串搜索、账户时区与索引状态；旧会话接口不变。

- **IA-2a / 2.1**：CLIENT_API 第 9 节正式登记 `personalCapabilities.chats=1`、主对话 / 旁聊身份读取、分页列表、旧深链解析及主对话已读偏好；生命周期 / 发送仍沿旧旁聊接口，逻辑发送由 IA-2b 接入。迁移不改原生身份，主对话段的旧生命周期与直接发送由宿主拒绝。

- M3-A：新增 `/personal/v1/offline/sync` 设备公钥加密增量、`/offline/turns` 带清理代次的幂等补交；云 `/hosts/offline/status` 必须 DPoP（设备密钥持有证明）授权、`/hosts/offline/publish` 用宿主安装签名；云 schema（结构版本）7。Android（安卓）code24；iPhone 接线见 CLIENT_API 3.19。

- **FX-14 / Windows-4**：运行中 `/sessions` 的 `processing.phase` 新增可选 `retrying`，仅投影 DSH 原生流空闲超时后的重试；不改变停止／审批权限和重试策略。
- **FX-12 / Windows-4**：既有 Task.control 字段不变；stopStatus=completed 明确为回合已结束 / 已核对不再运行，不保证目标成功或由停止造成；stop_requested 保留冻结意图，canResume 依原生状态及副作用核对。启动核对历史请求，见 CLIENT_API 3.6。

- **FX-10 / Windows-4**：GET `/sessions` 新增可选 `snapshotAt`（服务端起读 ISO 8601 时刻），与原生事件同一时钟；用于区分旧会话投影与更新的回合证据，缺字段保持旧 running 行为。字段不新增执行权限，停止与审批接口不变。

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

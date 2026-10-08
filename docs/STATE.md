# 当前状态

> 只写现在，整页覆盖，不追加日记。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-08

## 当前里程碑：M0 重置 / 轻云并行

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows-4 | W-1 Windows 桌面程序 | [PR #40](https://github.com/memoweft/weftmate/pull/40)（`wp/w1-desktop-app`）：默认个人宿主与 WeftMate 原生窗口、持久本地登录、托盘/单实例/窗口恢复、开机到托盘、审批/提问/完成通知及成果原生打开已实现；真实 Electron（桌面程序框架）+ 固定 DSH 合成闭环通过，相关测试 69/69；[程序截图与验收](../tests/evidence/w1/README.md)，完整测试见 PR CI（持续集成）；安装包与快捷方式留 W-2 |
| Codex · Windows | M0-6 现有模型入口、后台路由与系统状态 | [PR（合并请求）#33](https://github.com/memoweft/weftmate/pull/33) 方向调整完成：接入 D:\AI 的 8081 ModelSwitcher（模型切换代理），删除自起模型与参数；98,304 / 单槽 / 12 步与后台排队冒烟通过，M1-1b 完成后真实按钮重启通过；最终 CI（持续集成）见 PR 当前提交 |
| Codex · Windows-3 | UI-2a 手机审批模式 | [PR #45](https://github.com/memoweft/weftmate/pull/45)（`wp/ui-2a-mobile-approval`）：手机五种模式、全部允许风险确认、按电脑对话保存与账户默认、三按钮风险审批及处理后一行已完成；Android 0.8.3/code16 桥接 scope（授权范围），发布最低 code16。手机交互94/94、真实 Chromium（浏览器引擎）390×844、Android JVM（Java 虚拟机）26/26与 assembleDebug、类型检查通过；[合成截图与边界](../tests/evidence/ui-2a/README.md)，完整门禁交 PR CI（持续集成），待 Claude 审查 |
| Codex · Windows-2 | M0-7b 正式场景基线 | `wp/m0-7b-baseline`：Qwen 12项已列，办事4/6；定位首轮预填充与第二轮澄清等待，修复PowerShell输出箭头误报覆盖审批；脚本补验仍因动态写入目标审批失败。MiMo用户环境key缺失，按要求最多等待一小时后列待补；跨端2项需人工。证据见 [M0-7b](../tests/evidence/m0-7b/README.md)，CI与PR收口中 |
| Codex · Mac | A4a Apple 审批模式 | `wp/a4a-apple-approval-modes`：macOS / iOS 五种模式菜单、全部允许风险提示、对话保存与账户默认、三按钮审批/风险/收起摘要已接入 CLIENT_API 3.7；Watch仍允许一次/拒绝。定向 Swift 20/20、审批状态10/10、iOS合成 XCTest 2/2、三端 Debug 构建通过；[截图与复现](../apps/apple/Tests/Evidence/A4a/README.md)。额外 Mac XCTest 自动化模式启动超时，未申请新权限；真机/日用宿主未验，完整门禁交 PR CI，待 Claude 审查 |
| Codex · Cloud | S1c-Web 云账号登录与设备授权 | [PR #36](https://github.com/memoweft/weftmate/pull/36)（`wp/s1c-web-cloud-login`）：桌面/手机 Web Code+PKCE/不可导出 DPoP、绑定/解绑、一次性二维码与输入码、前台允许/拒绝已实现；真实 Chromium + file 邮件 + 隔离宿主闭环通过；Android 系统浏览器回调/Keystore/SPKI 已接线，GitHub runner 的 assembleDebug / JVM 单测通过；首轮五项 CI 全绿，最终门禁见 PR checks；待 Claude 审查 |
| Codex · Cloud | S2b 宿主内容证书自动签发 | [PR #38](https://github.com/memoweft/weftmate/pull/38)（`wp/s2b-host-certs`）：阿里云 V3 DNS-01/provider 私有环境接线与 RecordId 所有权、宿主 Node ACME/原内容 key CSR、每天检查/<30天续期/原子安装/热载、状态到期与错误已实现；本机真实 Pebble/challtestsrv→签名宿主/云/假 AliDNS API→配对 pin/TLS 热载与模拟到期续期通过；交付待 Claude 审查，最终 CI 门禁见 PR checks，本包未部署 |
| Codex · Windows-3 | UI-2a 手机审批模式 | [PR #45](https://github.com/memoweft/weftmate/pull/45)（`wp/ui-2a-mobile-approval`）：手机五种模式、全部允许风险确认、按电脑对话保存与账户默认、三按钮风险审批及处理后一行已完成；Android 0.8.3/code16 桥接 scope（授权范围），发布最低 code16。手机交互94/94、真实 Chromium（浏览器引擎）390×844、Android JVM（Java 虚拟机）26/26与 assembleDebug、类型检查通过；[合成截图与边界](../tests/evidence/ui-2a/README.md)，完整门禁交 PR CI（持续集成），待 Claude 审查 |

已完成：文档/规则重置、M0-1b 清理与拆分、M0-2 容量与动态预算（#24）、H1 健康设置/摘要/隔离队列（#22）、S0/S1a/S1b（#27/#29/#30）、CI 分组与依赖审计。

## 最近一次验证

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

## 最近一次场景结果 · M0-7b

2026-10-08，真实Electron（桌面程序框架）+固定DSH（执行框架），隔离所有者账号与独立MemoWeft Core（记忆核心）；Qwen仅8081 / `qwen3.8-27b-original`。MiMo `MIMO_API_KEY` 用户环境缺失，未调用，列待补；D4对照归因不能完成。两个跨端场景未用自动点击冒充真机。

| 场景 | Qwen 结果 / 耗时 | MiMo 结果 / 耗时 | D4归类 / 证据 |
|---|---|---|---|
| action-01 整理目录 | 通过 / 180.37s | 待补 / — | 文件与终态8项通过，无审批 |
| action-02 网页→文档 | 通过 / 510.84s | 待补 / — | 保存、来源、回复与终态通过；文档事实抽查有缺口，见证据 |
| action-03 读代码 | 通过 / 77.11s | 待补 / — | 金额20、精度解释、关键代码不变、终态通过 |
| action-04 资料→脚本→执行 | 失败 / 203.43s | 待补 / — | 初轮42.79s为代码误判（箭头已修）；补验写出sum.mjs，动态outPath运行需审批，未放行；策略/目标识别局限待对照 |
| action-05 停止→续做 | 通过 / 57.20s | 待补 / — | aborted（已停止）→原根任务completed（已完成），汇总30 |
| action-06 删除批准/拒绝 | 超时失败 / 600.38s | 待补 / — | 首轮允许/删除/终态通过，第二轮原生澄清等待；模型行为，能力归因待对照 |
| memory-01 偏好 | 超时失败 / 600.36s | 待补 / — | 首轮完成；新对话缓存问题触发上下文澄清，未到终态；待对照 |
| memory-02 纠正 | 失败 / 35.64s | 待补 / — | 模型尝试覆盖自己写的user_preferences.md，场景无该审批；实际覆盖，未放行；待对照 |
| memory-03 换模型 | 不支持 / 12.15s | 待补 / — | 首轮完成；MiMo未配置，第二轮未跑；不替换成其他本地模型 |
| memory-04 人物背景 | 超时失败 / 600.37s | 待补 / — | 首轮要求选择提醒/清单/记住，未进入新对话；待对照 |
| cross-01 电脑→手机审批 | 需人工 / — | 待补（需人工） / — | Android/iOS各用隔离账号，在原对话允许一次并核对电脑实际删除 |
| cross-02 手机→电脑→成果 | 需人工 / — | 待补（需人工） / — | 手机发原目标，在原对话打开实际购物清单，核对牛奶和勾选框 |

Qwen办事 **4/6（66.7%）**；全部12项：通过4、失败5、需人工2、不支持1，可判定4/9（44.4%），通过覆盖4/12（33.3%）。只达到M1办事数值门槛，**未达到完整M1出口**（MiMo对照、Android/iOS跨端仍未验）。可选LLM judge（模型评判）未启用；`memory_used` 采用依据仍不支持，不把关键词冒充完整记忆通过。记忆结束时Core ready（就绪）、worldRevision=0，形成/注入效果仍待查，未归因纯模型能力。

停滞诊断：首轮租约380ms、直接到8081，8,468令牌预填充81.82秒；双轮旧180秒几乎耗尽于首轮约170秒。第二轮租约176ms、响应头769ms，持续生成后发出原生澄清提问。宿主/评测器交接正常；观测到模型行为，无MiMo不能按D4最终归因。时限按慢样本6–13 tokens/s（每秒令牌数）校准：整理/读代码360秒，联网900秒，停止/删除及两轮记忆600秒，三轮纠正900秒；原目标、检查、审批决定保留。详见场景notes及 [完整证据与人工步骤](../tests/evidence/m0-7b/README.md)。

M0-7旧慢配置/旧工具0通过的结果不作为基线；本表取代它。类型检查与相关定向回归通过，完整测试交PR CI（持续集成）。测试凭据已清理，模型key扫描0命中，未读取日用保管库，模型留8081。

## 契约变更

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

- **M1-2 / M0-7b**：action-06在600秒仍因第二轮原生澄清等待失败；首轮预填充与回合交接已定位，见最近场景表。手机/Android菜单已在UI-2a完成，Apple菜单已在A4a完成；真机/跨端验收及长期稳定性另包。风险判断集中在可见参数、常见命令、内联与本地脚本源，动态生成/未知二进制副作用没有静态识别保证；没有新增沙盒范围、白名单、限次或审计层。

- **UI-1 契约缺口**：`GET /sessions` 缺少日期、未读及跨会话审批汇总；有真实时间时可分组，无日期时显示「会话」，审批点只来自已读取的真实审批。未提供会话重命名/删除/归档、删除关联记忆、可取消排队、记忆引用、成果在文件夹显示及任意网页/成果图片预览接口，不造按钮或数据；已有 queue/steer（排队/插话）参数已接。助手文字使用持久消息，原生文字 chunk（片段）目前不在契约中，真正逐字流式输出另包。外观按设备保存；字体、自定义色、密度及账号同步不在本包。截图来自独立 Electron 验收入口，不代表 `src/main.mjs` 全套启动或 macOS 原生 App 已验收。
- M1-1c（依赖 #41）：电脑文件范围、不同根并行与子任务网页已修复；当包六场景1/6（03）；最新M0-7b基线4/6，仍未达完整M1出口。D12 五种模式与常见危险操作判断由 M1-2 接入，真实 Qwen 拒绝缺口见上；未做其它模型对照、跨端与长期稳定性。

- **S1c-Apple 生产依赖未齐**：7.7 原生公钥 bootstrap 已由 S1c-Web 补齐并接入；注册/找回尚无云浏览器页；discover 需要已知 hostId、尚无账号宿主枚举；已有设备批准尚无可信 pin 转交接口。待云/Windows 轨道补正式契约与页面，才能完成「全新设备仅云账号登录→另一设备批准」的无扫码流程。真机 Secure Enclave/相机与生产系统浏览器/中继未验；本包不越界改 `services/cloud` 或 `src`。
- S1c-Web 未部署；云需预登记实际直接/中继回调与 Android client。Android 本机没有 SDK/Gradle，已在 CI 完成构建/JVM；实际系统浏览器往返、CA+SPKI 拒绝的真机验收和相机扫码另包（本包输入配对码，无新增权限），Apple S1c 另包。宿主离线仍按 S2 的网络失败语义，S6 离线聊天另包。

- D1 已完成真实云/systemd（系统服务管理）私有证书权限、既有443共存与 API/relay 生产 CA；API/relay/hosts DNS 已就绪。S2b 已交付阿里云 DNS provider 与逐宿主自动签发/续期/安装/热载，尚未部署：本人需创建指定 DNS 区增删权限 RAM 子账号并私下配置凭据、升级 cloud schema 5、开启宿主 ACME；生产 AliDNS/Let's Encrypt、真实 Windows/五端 pin 真机与长时续期尚未验。掉电残留 TXT 的后台清扫、内容 key 轮换、已撤销宿主重新启用留后续包。Windows 验收使用隔离 CA，不能代表普通浏览器生产内容证书已就绪。
- frp 此版无踢在线 client 的管理 API；本包用云必经 TCP socket 所有权立即断流。部署不可绕过入口或公网暴露 frps/plugin。D24 普通浏览器允许，云/DNS 主动完全控制时仍可能被冒充；原生另 pin。
- MW-2 部署需升级 observed v1 Core；真机上传/日用模型/vendor 未验。M1-3 极少上下文先压缩待做。
- 根单测已有已登记例外、外部 vendor/Design 夹具及部分跨平台适配；Mac 127.0.0.2 回环别名缺失的既有环境失败以 CI 为准，未在 S2 改写例外。Windows 中继打包/真机与 S1c 客户端留后续包。

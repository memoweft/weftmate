# 当前状态

> 只写现在，整页覆盖，不追加日记。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-08

## 当前里程碑：M0 重置 / 轻云并行

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows-4 | W-1 Windows 桌面程序 | [PR #40](https://github.com/memoweft/weftmate/pull/40)（`wp/w1-desktop-app`）：默认个人宿主与 WeftMate 原生窗口、持久本地登录、托盘/单实例/窗口恢复、开机到托盘、审批/提问/完成通知及成果原生打开已实现；真实 Electron（桌面程序框架）+ 固定 DSH 合成闭环通过，相关测试 71/71；[程序截图与验收](../tests/evidence/w1/README.md)，完整测试见 PR CI（持续集成）；安装包与快捷方式留 W-2 |
| Codex · Windows-3 | UI-1 桌面界面 | [PR #39](https://github.com/memoweft/weftmate/pull/39)（`wp/ui-1-desktop`）：可收起侧栏、搜索、Markdown（格式化文本）正文、两级步骤、发送/停止、插话/排队参数、右侧预览与缩放、外观设备保存已实现；相关测试 65/65、类型检查与独立只读审查通过；Electron（桌面程序框架）窗口 + 隔离宿主浅/深色验收见 [UI-1](../tests/evidence/ui-1/README.md)；最终门禁见 PR checks（检查），待 Claude 审查 |
| Codex · Windows | M0-3 历史分页 + M1-0a 时间线 | [PR #26](https://github.com/memoweft/weftmate/pull/26) 审查修改完成，待复审；已合入 main `061b0fe`（H2 / S0 / D23–D25），来源校验按回合；桌面/手机时间线、任务页删除、Android code14 / UI 0.8.1 已实现 |
| Codex · Windows-2 | M1-1 个人入口原生工具 | [PR #31](https://github.com/memoweft/weftmate/pull/31)：合入 main `99b66b5`，修复 native web_fetch（原生网页获取）提供方；隔离 Qwen 原版 27B 办事场景 **2/6 通过（03、05）**，结果与未做项见下；类型/相关回归通过，最终 CI 门禁见 PR checks（检查） |
| Codex · Mac | S1c-Apple 云账号与设备授权 | [PR #37](https://github.com/memoweft/weftmate/pull/37)（`wp/s1c-apple-cloud-login`） 原生客户端接线与隔离验收完成，待 PR 审查；系统认证浏览器/PKCE、P-256/DPoP、Keychain 刷新、等待/允许/拒绝、iPhone QR、配对 SPKI 已实现。已接最新 7.7 设备公钥 bootstrap 与标准 QR/复制码；生产首次无配对材料登录仍受账号页、宿主枚举与可信 pin 转交缺口阻塞；[验收说明](../apps/apple/Tests/S1c-README.md) |
| Codex · Cloud | S1c-Web 云账号登录与设备授权 | [PR #36](https://github.com/memoweft/weftmate/pull/36)（`wp/s1c-web-cloud-login`）：桌面/手机 Web Code+PKCE/不可导出 DPoP、绑定/解绑、一次性二维码与输入码、前台允许/拒绝已实现；真实 Chromium + file 邮件 + 隔离宿主闭环通过；Android 系统浏览器回调/Keystore/SPKI 已接线，GitHub runner 的 assembleDebug / JVM 单测通过；首轮五项 CI 全绿，最终门禁见 PR checks；待 Claude 审查 |
| Codex · Cloud | S2b 宿主内容证书自动签发 | [PR #38](https://github.com/memoweft/weftmate/pull/38)（`wp/s2b-host-certs`）：阿里云 V3 DNS-01/provider 私有环境接线与 RecordId 所有权、宿主 Node ACME/原内容 key CSR、每天检查/<30天续期/原子安装/热载、状态到期与错误已实现；本机真实 Pebble/challtestsrv→签名宿主/云/假 AliDNS API→配对 pin/TLS 热载与模拟到期续期通过；交付待 Claude 审查，最终 CI 门禁见 PR checks，本包未部署 |
| Codex · Windows-3 | D1 云服务与中继部署 | [PR #35](https://github.com/memoweft/weftmate/pull/35)（`wp/d1-cloud-deploy`）：Node 24.21.0 / frp 0.71.0 / nginx stream（TCP 流代理）443 已上线；API/OIDC（身份协议）公网、Windows 隔离宿主 `/status`、撤销断流通过；既有 12 个入口与原服务基线一致；私有备份与一键回滚就绪。file 邮件暂不发信，内容生产证书待 DNS-01（DNS TXT 证书验证）provider（服务商适配器）与 RAM 凭据；运维见 deploy README |

已完成：文档/规则重置、M0-1b 清理与拆分、M0-2 容量与动态预算（#24）、H1 健康设置/摘要/隔离队列（#22）、S0/S1a/S1b（#27/#29/#30）、CI 分组与依赖审计。

## 最近一次验证

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

## 契约变更

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

- **UI-1 契约缺口**：`GET /sessions` 缺少日期、未读及跨会话审批汇总；有真实时间时可分组，无日期时显示「会话」，审批点只来自已读取的真实审批。未提供会话重命名/删除/归档、删除关联记忆、总是允许此类、可取消排队、结构化计划/记忆引用、成果在文件夹显示及任意网页/成果图片预览接口，不造按钮或数据；已有 queue/steer（排队/插话）参数已接。助手文字使用持久消息，原生文字 chunk（片段）目前不在契约中，真正逐字流式输出另包。外观按设备保存；字体、自定义色、密度及账号同步不在本包。截图来自独立 Electron 验收入口，不代表 `src/main.mjs` 全套启动或 macOS 原生 App 已验收。
- M1-1：Windows shell 的私有临时写区与 runner 的系统临时目录不一致，01/04 需沙盒升级但场景未声明；宿主单执行记录约束拒绝不同根的并行调用（TASK_NOT_READY）；子任务网页提供方尚未接通，读写/模型/目录继承已验。D12 五种审批模式属 M1-2，长任务/停止增强属后续包；未做 MiMo 对照、真实跨端或网页文档事实抽查（目标文档未生成）。隔离宿主已停，指定模型留在 8081。

- **S1c-Apple 生产依赖未齐**：7.7 原生公钥 bootstrap 已由 S1c-Web 补齐并接入；注册/找回尚无云浏览器页；discover 需要已知 hostId、尚无账号宿主枚举；已有设备批准尚无可信 pin 转交接口。待云/Windows 轨道补正式契约与页面，才能完成「全新设备仅云账号登录→另一设备批准」的无扫码流程。真机 Secure Enclave/相机与生产系统浏览器/中继未验；本包不越界改 `services/cloud` 或 `src`。
- S1c-Web 未部署；云需预登记实际直接/中继回调与 Android client。Android 本机没有 SDK/Gradle，已在 CI 完成构建/JVM；实际系统浏览器往返、CA+SPKI 拒绝的真机验收和相机扫码另包（本包输入配对码，无新增权限），Apple S1c 另包。宿主离线仍按 S2 的网络失败语义，S6 离线聊天另包。

- D1 已完成真实云/systemd（系统服务管理）私有证书权限、既有443共存与 API/relay 生产 CA；API/relay/hosts DNS 已就绪。S2b 已交付阿里云 DNS provider 与逐宿主自动签发/续期/安装/热载，尚未部署：本人需创建指定 DNS 区增删权限 RAM 子账号并私下配置凭据、升级 cloud schema 5、开启宿主 ACME；生产 AliDNS/Let's Encrypt、真实 Windows/五端 pin 真机与长时续期尚未验。掉电残留 TXT 的后台清扫、内容 key 轮换、已撤销宿主重新启用留后续包。Windows 验收使用隔离 CA，不能代表普通浏览器生产内容证书已就绪。
- frp 此版无踢在线 client 的管理 API；本包用云必经 TCP socket 所有权立即断流。部署不可绕过入口或公网暴露 frps/plugin。D24 普通浏览器允许，云/DNS 主动完全控制时仍可能被冒充；原生另 pin。
- MW-2 部署需升级 observed v1 Core；真机上传/日用模型/vendor 未验。M0-6 Qwen 启动不统一/曾 OOM；M1-3 极少上下文先压缩待做。
- 根单测已有已登记例外、外部 vendor/Design 夹具及部分跨平台适配；Mac 127.0.0.2 回环别名缺失的既有环境失败以 CI 为准，未在 S2 改写例外。Windows 中继打包/真机与 S1c 客户端留后续包。

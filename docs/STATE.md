# 当前状态

> 只写现在，整页覆盖。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-07

## 当前里程碑：M0 重置 / 轻云并行

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-6 本地模型、后台路由与系统状态 | [PR（合并请求）#33](https://github.com/memoweft/weftmate/pull/33) 审查修改中：默认改为 92,160 / q4_0 / 全 GPU，排队仅单槽本地服务；新参数实测待 GPU 协调；CI（持续集成）为最终门禁；18081 单槽、主请求优先、后台模型、桌面/手机状态与重启；Android code15 / UI 0.8.2 |
| Codex · Mac | A3（A1 + M1-0d）Apple 对话时间线 | [PR #32](https://github.com/memoweft/weftmate/pull/32) 待审查，本地验收通过：在线/离线尾页与上翻、增量、执行/审批/提问/成果卡、删除独立任务页面、Watch 手机桥接及前台触感；[合成证据](../apps/apple/Tests/Evidence/A3/README.md) |
| Codex · Cloud | S2 中继、单一 443 SNI、宿主 TLS | [PR #34](https://github.com/memoweft/weftmate/pull/34)（`wp/s2-relay`）：官方 frp 0.71.0 + SHA256 下载、逐宿主授权/轮换/撤销断流、HAProxy TCP 443 草稿、宿主 TLS/IPC sidecar/状态、受限 DNS-01 hook 与实际 SPKI 已实现；本机全链路通过；等待规划审查，最新 CI 见 PR checks；无部署 |

| Codex · Cloud | S1c-Web 云账号登录与设备授权 | [PR #36](https://github.com/memoweft/weftmate/pull/36)（`wp/s1c-web-cloud-login`）：桌面/手机 Web Code+PKCE/不可导出 DPoP、绑定/解绑、一次性二维码与输入码、前台允许/拒绝已实现；真实 Chromium + file 邮件 + 隔离宿主闭环通过；Android 系统浏览器回调/Keystore/SPKI 已接线，GitHub runner 的 assembleDebug / JVM 单测通过；首轮五项 CI 全绿，最终门禁见 PR checks；待 Claude 审查 |
| Codex · Windows-3 | D1 云服务与中继部署 | [PR #35](https://github.com/memoweft/weftmate/pull/35)（`wp/d1-cloud-deploy`）：Node 24.21.0 / frp 0.71.0 / nginx stream（TCP 流代理）443 已上线；API/OIDC（身份协议）公网、Windows 隔离宿主 `/status`、撤销断流通过；既有 12 个入口与原服务基线一致；私有备份与一键回滚就绪。file 邮件暂不发信，内容生产证书待 DNS-01（DNS TXT 证书验证）provider（服务商适配器）与 RAM 凭据；运维见 deploy README |

已完成：文档重置、M0-1b、M0-2、M0-3/M1-0a、H1/H2、MW-2、S0/S1a/S1b/S2 与 CI 分组。

## 最近一次验证

- M0-6 审查修改：新默认 92,160 / q4_0 / 全 GPU / batch 4096 / ubatch 512 / threads 8/16；32K / 48 层方案已撤回，新参数的速度、缓存、显存和 30 分钟稳定性实测待 GPU 协调。
- M0-6 首版完整单测 873：866 通过、5 既有静态失败、2 跳过；后续本地模型/队列/云身份/记忆/中继定向通过。合并中本地二次全量受瞬时冲突与依赖修复影响，不作为最终门禁；最终以 PR CI 为准；Windows 的忙碌注册、预检重试、云设备创建三项测试改为实际状态/调用次数断言，未放宽产品超时。类型检查/预检通过；手机 Web（网页界面）89 项、Android JVM（Java 虚拟机）测试/构建通过。界面见 tests/evidence/m0-6/。
- 已同步 MW-2、S1b、S2；真实固定 Core 集成通过；召回按主对话的实际 local/cloud（本地/云端）过滤，与后台形成模型分开。S2 上游：Mac 18443 与 Linux CI 实际 443 全链路通过；cloud 常规 36/36、相关宿主 16/16、下载/TLS/IPC 3/3。未把这些结果当作 Windows 真机验证。
- **S1c-Web**：桌面相关 **65/65**、手机交互 **89/89**、新密钥/PKCE/状态/凭据轮换/配对与公开配置 **5/5**、云认证/配置/宿主 **22/22**、类型检查通过；真实 Chromium 使用 file 邮件、SQLite 与隔离宿主验证本地登录→绑定→新手机浏览器等待→桌面允许→进入对话、二维码过期自动刷新/配对、拒绝、解绑与本地登录保留。合成截图 `.local/s1c-web/` 不进仓库；等待页刷新恢复也已通过；首轮 CI 五项通过：Android assembleDebug / JVM、Web Chromium 闭环、根完整必过套件、真实 MemoWeft Core、实际 443 中继；最终门禁见 PR checks。现有 public account shell 静态正则将 context 当 text 的例外仍按 CI 清单处理。

- **D1**：真实服务器 API healthz/schema 4 与 OIDC discovery（发现文档）正常；Windows 官方 frpc 经公网443，显式隔离 CA（证书机构）验证随机 hosts 域 `/personal/v1/status` 200、Secure Cookie、setup/转发伪造拒绝、撤销断流和本地登录保留；frps/cloud 日志无合成密码/Cookie 明文。原有网站状态/头/证书与非 nginx listener（监听器）进程保持，真实来源地址核对；证书模拟续期与回滚 dry-run（只检查不执行）通过。Linux 配置/真实启动测试 6/6；Windows 同组两项既有 POSIX（类 Unix 路径）断言/临时目录 EPERM 问题，完整测试交 CI。生产宿主 CA 未验。
- A3：Swift **260 项通过**；`make test-state` **11 组通过**；macOS / iOS / watchOS Debug 三目标构建通过；iOS 合成时间线 + A2 附件 XCTest **2/2**。22,000 条旧记录只取尾页，上翻 beforeSeq=21906，详情按需一次，审批/回答各一次 POST；截图见 [A3](../apps/apple/Tests/Evidence/A3/README.md)。Mac 辅助功能未授权，未申请；Watch 配对/真实触感、推送与日用宿主尚未验收。

- A3 / D1 上游验收：Apple Swift 260、state 11 组、三目标 Debug 与 iOS 合成 2/2；真实云 API/中继与 Windows 隔离 CA 验证通过。A3 已接历史与时间线，M0-6 新状态/后台接口另待接入。

## 最近一次场景结果

M0-7 **不作为基线**：以下结果使用慢配置与旧工具，基线在 M1-1 合并后另跑，不在本包。隔离宿主与测试账号，本地 Qwen，空闲宿主重跑、MemoWeft 已启用。**通过 0、失败 9、需人工 2、不支持 1**；可判定通过率 0/9，覆盖 0/12。无 MiMo 对照，不把超时归为已确认模型能力或代码根因。

| 场景 | 结果 | 耗时 | 原因 |
|---|---|---|---|
| action-01-organize | 失败 | 180.6s | 场景期限内未完成（超时） |
| action-02-web-document | 失败 | 240.6s | 场景期限内未完成（超时） |
| action-03-read-code | 失败 | 180.6s | 场景期限内未完成（超时） |
| action-04-research-script | 失败 | 300.6s | 场景期限内未完成（超时） |
| action-05-stop-resume | 失败 | 180.7s | 场景期限内未完成（超时） |
| action-06-delete-approval | 失败 | 180.6s | 场景期限内未完成（超时） |
| cross-01-desktop-approval | 需人工 | 0.0s | 需手机/电脑真机 |
| cross-02-phone-result | 需人工 | 0.0s | 需手机/电脑真机 |
| memory-01-preference | 失败 | 180.6s | 场景期限内未完成（超时） |
| memory-02-correction | 失败 | 180.6s | 场景期限内未完成（超时） |
| memory-03-switch-model | 不支持 | 40.3s | 未配置 MiMo |
| memory-04-person | 失败 | 180.4s | 场景期限内未完成（超时） |

## 契约变更

- M0-6：CLIENT_API 3.15，GET /system、模型/宿主/记忆重启、GET/PATCH /settings/models；后台配置按账户保存，手机只读配置 + 重启；主模型仍按对话选择，已有接口兼容，Apple 待接入。
- S2：7.6 中继 base URL（服务地址）、离线/断流、目录/凭据/轮换/撤销/受限 ACME TXT（证书验证）；GET /status 与 /cloud/pairings 增 relay。S1c 接原生 pin（证书固定）与新地址。
- S1b：7.4–7.5 认领/绑定、cloud-nonce/cloud-session、内容设备决定/配对、签名撤权；宿主 resource（授权目标）+ DPoP（持钥证明），云 epoch（撤权版本）与本地分开。MW-2/H2：第 6 节 delivered/queued、observed 权限/撤回与 model_tier；M0-3/M1-0a：3.4/4 历史与时间线。

## 已知问题与未做

- M1/M2 场景尚未通关；新默认全 GPU，实测待完成。2 小时本人日用、视觉模型、手机真机与 Apple 新接口未验；MiMo 未配。8080/8081/18080 旧入口废弃。
- MW-2 部署须支持 observed v1；本次旧隔离测试库与固定 Core schema（数据库结构）不兼容，已保留备份并用空库验证，未迁移本人数据。根单测与 vendor（内嵌依赖）/外部 Design 夹具按 CI 例外观察；本包未加例外，移除记忆路由的旧平台跳过。极少上下文先压缩与 JSONL（逐行结构化日志）物理整文件解析仍待后续。
- D1 已上线云 API/中继，运维见 deploy README；内容 DNS-01 provider 与 RAM 凭据、逐宿主 CSR 签发/热载及五端 pin 真机仍待后续。本包未做部署验证。frp 无踢在线 client（客户端）的管理 API，中继须经云 TCP socket（网络连接）所有权入口，不能绕过或公网暴露 frps/plugin；D24 浏览器边界保持。
- **S1c-Web**：CLIENT_API **7.7** 增加宿主 GET `/cloud/config` 与已认证 GET `/cloud/binding`；云客户端可配 application_type，OIDC 设备公钥隐藏字段与预登记回调 origin CORS、表单回调 CSP；浏览器 fragment 回调和 wm1 配对编码、Android code 15 的系统浏览器 scheme/Keystore/SPKI。既有认领/配对/DPoP/CSRF/本地数据语义保持。相机与 Apple/真机另包。

- A3：现有 3.4 / 4 契约已接入 Apple，服务端接口未变；第 5 节历史/时间线差异标「已在 A3 修复」。上翻与正向水位独立，离线缓存分块读取；回合键不作为 /tasks 根 ID，成果以账号/会话授权元数据取根绑定。Watch 通过 iPhone 原生连接，不共享宿主凭据。

- **S2**：CLIENT_API **7.6** 新增中继 base URL、宿主离线/断流语义、目录/凭据/轮换/撤销/受限 ACME TXT；`GET /status` 增添 relay，已认证直接地址 `/cloud/pairings` 增添 relay 且原 tlsSpki 对应实际 TLS key。路径/ownerId/历史游标/Cookie/CSRF/setup 保持；S1c 需接原生 pin 与新 base URL。
- S1b：7.4–7.5 宿主认领/绑定、cloud-nonce/cloud-session、内容设备决定/配对、签名撤权；host:session 指定宿主 resource + DPoP；云 epoch 与本地分开。
- MW-2 / H2：第 6 节健康摘要/迟到水位、memory.state=delivered 与 queued/empty，observed 权限/撤回与 model_tier；需 observed v1 Core。
- S1a：第 7 节云账号/邮箱/OIDC/epoch/PKCE。M0-3 / M1-0a：3.4 / 4 尾页、beforeSeq/afterSeq、seq 详情与时间线；Apple 已在 A3 接入并移除 historyLimit；排队/插话另包。

## 已知问题与未做

- S1c-Web 未部署；云需预登记实际直接/中继回调与 Android client。Android 本机没有 SDK/Gradle，已在 CI 完成构建/JVM；实际系统浏览器往返、CA+SPKI 拒绝的真机验收和相机扫码另包（本包输入配对码，无新增权限），Apple S1c 另包。宿主离线仍按 S2 的网络失败语义，S6 离线聊天另包。

- D1 已完成真实云/systemd（系统服务管理）私有证书权限、既有443共存与 API/relay 生产 CA；API/relay/hosts DNS 已就绪。内容 DNS provider 尚未接线，RAM 凭据待本人提供；逐宿主 CSR（证书签名请求）定时签发/安装/热载、内容 key 轮换、已撤销宿主重新启用、五端原生 pin（证书固定）真机留后续包。Windows 验收使用隔离 CA，不能代表普通浏览器生产内容证书已就绪。
- frp 此版无踢在线 client 的管理 API；本包用云必经 TCP socket 所有权立即断流。部署不可绕过入口或公网暴露 frps/plugin。D24 普通浏览器允许，云/DNS 主动完全控制时仍可能被冒充；原生另 pin。
- MW-2 部署需升级 observed v1 Core；真机上传/日用模型/vendor 未验。M0-6 Qwen 启动不统一/曾 OOM；M1-3 极少上下文先压缩待做。
- 根单测已有已登记例外、外部 vendor/Design 夹具及部分跨平台适配；Mac 127.0.0.2 回环别名缺失的既有环境失败以 CI 为准，未在 S2 改写例外。Windows 中继打包/真机与 S1c 客户端留后续包。

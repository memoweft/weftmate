# 当前状态

> 只写现在，整页覆盖，不追加日记。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-07

## 当前里程碑：M0 重置 / 轻云并行

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-3 历史分页 + M1-0a 时间线 | [PR #26](https://github.com/memoweft/weftmate/pull/26) 审查修改完成，待复审；已合入 main `061b0fe`（H2 / S0 / D23–D25），来源校验按回合；桌面/手机时间线、任务页删除、Android code14 / UI 0.8.1 已实现 |
| Codex · Mac | S1c-Apple 云账号与设备授权 | [PR #37](https://github.com/memoweft/weftmate/pull/37)（`wp/s1c-apple-cloud-login`） 原生客户端接线与隔离验收完成，待 PR 审查；系统认证浏览器/PKCE、P-256/DPoP、Keychain 刷新、等待/允许/拒绝、iPhone QR、配对 SPKI 已实现。生产首次云登录仍受云 HTML 公钥 bootstrap、账号页、宿主枚举与可信 pin 转交缺口阻塞；[验收说明](../apps/apple/Tests/S1c-README.md) |
| Codex · Cloud | S2 中继、单一 443 SNI、宿主 TLS | [PR #34](https://github.com/memoweft/weftmate/pull/34)（`wp/s2-relay`）：官方 frp 0.71.0 + SHA256 下载、逐宿主授权/轮换/撤销断流、HAProxy TCP 443 草稿、宿主 TLS/IPC sidecar/状态、受限 DNS-01 hook 与实际 SPKI 已实现；本机全链路通过；等待规划审查，最新 CI 见 PR checks；无部署 |
| Codex · Windows-3 | D1 云服务与中继部署 | [PR #35](https://github.com/memoweft/weftmate/pull/35)（`wp/d1-cloud-deploy`）：Node 24.21.0 / frp 0.71.0 / nginx stream（TCP 流代理）443 已上线；API/OIDC（身份协议）公网、Windows 隔离宿主 `/status`、撤销断流通过；既有 12 个入口与原服务基线一致；私有备份与一键回滚就绪。file 邮件暂不发信，内容生产证书待 DNS-01（DNS TXT 证书验证）provider（服务商适配器）与 RAM 凭据；运维见 deploy README |

已完成：文档/规则重置、M0-1b 清理与拆分、M0-2 容量与动态预算（#24）、H1 健康设置/摘要/隔离队列（#22）、S0/S1a/S1b（#27/#29/#30）、CI 分组与依赖审计。

## 最近一次验证

- S1c-Apple：相关 Swift **10 项（含 5 组坏 JWT 输入）**、真实 `services/cloud/src/main.mjs`/SQLite/file 邮件→隔离宿主与原生 TLS **2 项**通过；单个 `AppleContractStateChecks` 通过；macOS / iOS / watchOS Debug 构建通过。iOS XCTest **2/2**：注册/验证码由隔离浏览器驱动执行，Swift 完成真实 PKCE/refresh/DPoP；新设备 pending 不见内容，另一原生本地会话允许后重开/Keychain 恢复进入合成对话；QR PNG 经 Vision/CoreImage 解码并 redeem。pin 接受正确 key，拒绝错误 pin、同域同 CA 其他 key、不受信 CA、错误域名，以及错误 pin 的上传/下载。无日用数据、真实邮件、系统 CA 修改或生产中继验证；不把 JSON 浏览器驱动记为生产 ASWebAuthenticationSession UI 已通过。

- **D1**：真实服务器 API healthz/schema 4 与 OIDC discovery（发现文档）正常；Windows 官方 frpc 经公网443，显式隔离 CA（证书机构）验证随机 hosts 域 `/personal/v1/status` 200、Secure Cookie、setup/转发伪造拒绝、撤销断流和本地登录保留；frps/cloud 日志无合成密码/Cookie 明文。原有网站状态/头/证书与非 nginx listener（监听器）进程保持，真实来源地址核对；证书模拟续期与回滚 dry-run（只检查不执行）通过。Linux 配置/真实启动测试 6/6；Windows 同组两项既有 POSIX（类 Unix 路径）断言/临时目录 EPERM 问题，完整测试交 CI。生产宿主 CA 未验。
- A3：Swift **260 项通过**；`make test-state` **11 组通过**；macOS / iOS / watchOS Debug 三目标构建通过；iOS 合成时间线 + A2 附件 XCTest **2/2**。22,000 条旧记录只取尾页，上翻 beforeSeq=21906，详情按需一次，审批/回答各一次 POST；截图见 [A3](../apps/apple/Tests/Evidence/A3/README.md)。Mac 辅助功能未授权，未申请；Watch 配对/真实触感、推送与日用宿主尚未验收。

- **S2**：Mac Node 24.21.0、官方 frps/frpc 0.71.0、真实 HAProxy + cloud OIDC/SQLite + 宿主 TLS 全链路通过；登录/Secure Cookie、CSRF/Origin/转发伪造/setup 拒绝、SSE、2,200 事件尾页/上翻、附件 SHA256、断网重连、另一已认领宿主抢域名拒绝、错误 pin/同域受信 CA 伪造证书拒绝、证书 reload 拒绝换 key、凭据轮换、云撤销现有连接/保留本地登录。双向原始 TLS 字节无测试正文/密码/Cookie 明文，约 246 KiB；撤销断流约 3–4 ms。Mac 无免密码低端口权限，本机用 **18443**，相同 443 TLS authority；Linux CI `Relay full chain (443)` 已通过**实际 443**完整场景（合成报告约 248 KiB、断流 4 ms）；修复 socket 关闭后端口清空造成的表残留已重验，最终门禁以最新 PR checks 为准。
- **S2 回归**：类型检查通过，cloud 常规 **36/36**（显式跳过单独 E2E）；相关宿主/Origin/附件/SSE **16/16**（旧 Caddy 集成显式跳过，S2 新链路另验）；下载 SHA 防篡改、TLS sidecar 配置、宿主意外退出 IPC 清理 **3/3**。隔离目录规范化后运行，不碰日用数据。证据为受忽略 `.local/s2-relay-verification.json` 与 CI 合成报告。
- S1b：身份 7/7、实际 cloud OIDC/SQLite→宿主流程、A/B 隔离、DPoP 拒绝与 SSE 撤权、云离线本地登录通过；旧 store/ID/密码/Cookie/非零同步水位和备份保持。
- MW-2：真实 Python Core RPC/持久待办/并发撤回 2/2、健康 HTTP 7/7、类型检查/预检通过；M0-3 长历史 230,000+ 范围投影与审批/提问验证已通过。Qwen / MiMo 基线及真实长任务尚未跑。

## 契约变更

- S1c-Apple：客户端接入现有 7.2/7.4/7.6，HTTP 契约未扩展；第 5 节记录原生能力与云 HTML/目录/可信 pin 交付缺口。官方 native client 拟用 `weftmate-apple` / `com.weftmate.apple:/oauth/callback`，须由云部署登记；缺设备公钥 browser bootstrap 时 host token 会被拒绝，不能自动信云目录 pin。Watch 不改。

- A3：现有 3.4 / 4 契约已接入 Apple，服务端接口未变；第 5 节历史/时间线差异标「已在 A3 修复」。上翻与正向水位独立，离线缓存分块读取；回合键不作为 /tasks 根 ID，成果以账号/会话授权元数据取根绑定。Watch 通过 iPhone 原生连接，不共享宿主凭据。

- **S2**：CLIENT_API **7.6** 新增中继 base URL、宿主离线/断流语义、目录/凭据/轮换/撤销/受限 ACME TXT；`GET /status` 增添 relay，已认证直接地址 `/cloud/pairings` 增添 relay 且原 tlsSpki 对应实际 TLS key。路径/ownerId/历史游标/Cookie/CSRF/setup 保持；S1c 需接原生 pin 与新 base URL。
- S1b：7.4–7.5 宿主认领/绑定、cloud-nonce/cloud-session、内容设备决定/配对、签名撤权；host:session 指定宿主 resource + DPoP；云 epoch 与本地分开。
- MW-2 / H2：第 6 节健康摘要/迟到水位、memory.state=delivered 与 queued/empty，observed 权限/撤回与 model_tier；需 observed v1 Core。
- S1a：第 7 节云账号/邮箱/OIDC/epoch/PKCE。M0-3 / M1-0a：3.4 / 4 尾页、beforeSeq/afterSeq、seq 详情与时间线；Apple 已在 A3 接入并移除 historyLimit；排队/插话另包。

## 已知问题与未做

- **S1c-Apple 生产依赖未齐**：云 HTML 表单没有 deviceId/JWK 原生 bootstrap，注册/找回尚无浏览器页；discover 需要已知 hostId、尚无账号宿主枚举；已有设备批准尚无可信 pin 转交接口。待云/Windows 轨道补正式契约与页面，才能完成「全新设备仅云账号登录→另一设备批准」的无扫码流程。真机 Secure Enclave/相机与生产系统浏览器/中继未验；本包不越界改 `services/cloud` 或 `src`。

- D1 已完成真实云/systemd（系统服务管理）私有证书权限、既有443共存与 API/relay 生产 CA；API/relay/hosts DNS 已就绪。内容 DNS provider 尚未接线，RAM 凭据待本人提供；逐宿主 CSR（证书签名请求）定时签发/安装/热载、内容 key 轮换、已撤销宿主重新启用、五端原生 pin（证书固定）真机留后续包。Windows 验收使用隔离 CA，不能代表普通浏览器生产内容证书已就绪。
- frp 此版无踢在线 client 的管理 API；本包用云必经 TCP socket 所有权立即断流。部署不可绕过入口或公网暴露 frps/plugin。D24 普通浏览器允许，云/DNS 主动完全控制时仍可能被冒充；原生另 pin。
- MW-2 部署需升级 observed v1 Core；真机上传/日用模型/vendor 未验。M0-6 Qwen 启动不统一/曾 OOM；M1-3 极少上下文先压缩待做。
- 根单测已有已登记例外、外部 vendor/Design 夹具及部分跨平台适配；Mac 127.0.0.2 回环别名缺失的既有环境失败以 CI 为准，未在 S2 改写例外。Windows 中继打包/真机与 S1c 客户端留后续包。

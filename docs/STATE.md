# 当前状态

> 只写现在，整页覆盖。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-07

## 当前里程碑：M0 重置 / 轻云并行

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-6 本地模型、后台路由与系统状态 | [PR（合并请求）#33](https://github.com/memoweft/weftmate/pull/33) 实现与真实验证完成；CI（持续集成）为最终门禁；18081 单槽、主请求优先、后台模型、桌面/手机状态与重启；Android code15 / UI 0.8.2 |
| Codex · Mac | A3（A1 + M1-0d）Apple 对话时间线 | [PR #32](https://github.com/memoweft/weftmate/pull/32) 待审查，本地验收通过：在线/离线尾页与上翻、增量、执行/审批/提问/成果卡、删除独立任务页面、Watch 手机桥接及前台触感；[合成证据](../apps/apple/Tests/Evidence/A3/README.md) |
| Codex · Cloud | S2 中继、单一 443 SNI、宿主 TLS | [PR #34](https://github.com/memoweft/weftmate/pull/34)（`wp/s2-relay`）：官方 frp 0.71.0 + SHA256 下载、逐宿主授权/轮换/撤销断流、HAProxy TCP 443 草稿、宿主 TLS/IPC sidecar/状态、受限 DNS-01 hook 与实际 SPKI 已实现；本机全链路通过；等待规划审查，最新 CI 见 PR checks；无部署 |

| Codex · Windows-3 | D1 云服务与中继部署 | [PR #35](https://github.com/memoweft/weftmate/pull/35)（`wp/d1-cloud-deploy`）：Node 24.21.0 / frp 0.71.0 / nginx stream（TCP 流代理）443 已上线；API/OIDC（身份协议）公网、Windows 隔离宿主 `/status`、撤销断流通过；既有 12 个入口与原服务基线一致；私有备份与一键回滚就绪。file 邮件暂不发信，内容生产证书待 DNS-01（DNS TXT 证书验证）provider（服务商适配器）与 RAM 凭据；运维见 deploy README |

已完成：文档重置、M0-1b、M0-2、M0-3/M1-0a、H1/H2、MW-2、S0/S1a/S1b/S2 与 CI 分组。

## 最近一次验证

- M0-6：Qwen3.8 27B Q4_K_M，真实服务与原生请求上下文 32,768；同一对话 12 次链式 read、正确校验字、非空回复、completed，无 max-tokens。真实后台请求在主轮及工具间隙排队，主轮结束后执行；三项重启通过，模型重启后原生容量 16,384 → 恢复 32,768。
- 24 GiB RTX 3090：48 GPU（图形处理器）层、q8_0 KV cache（键值缓存）、单槽、batch（批大小）512 / microbatch（微批大小）128。30 分钟 354 次健康采样全部正常；峰值 20,537 MiB（含桌面，余约 3.9 GiB），无 OOM（内存不足）。全 GPU 初次占 24,265 MiB 并持续预热，未选为默认。
- M0-6 首版完整单测 873：866 通过、5 既有静态失败、2 跳过；后续本地模型/队列/云身份/记忆/中继定向通过。合并中本地二次全量受瞬时冲突与依赖修复影响，不作为最终门禁；最终以 PR CI 为准；Windows 的忙碌注册、预检重试、云设备创建三项测试改为实际状态/调用次数断言，未放宽产品超时。类型检查/预检通过；手机 Web（网页界面）89 项、Android JVM（Java 虚拟机）测试/构建通过。界面见 tests/evidence/m0-6/。
- 已同步 MW-2、S1b、S2；真实固定 Core 集成通过；召回按主对话的实际 local/cloud（本地/云端）过滤，与后台形成模型分开。S2 上游：Mac 18443 与 Linux CI 实际 443 全链路通过；cloud 常规 36/36、相关宿主 16/16、下载/TLS/IPC 3/3。未把这些结果当作 Windows 真机验证。

- A3 / D1 上游验收：Apple Swift 260、state 11 组、三目标 Debug 与 iOS 合成 2/2；真实云 API/中继与 Windows 隔离 CA 验证通过。A3 已接历史与时间线，M0-6 新状态/后台接口另待接入。

## 最近一次场景结果

M0-7：隔离宿主与测试账号，本地 Qwen，空闲宿主重跑、MemoWeft 已启用。**通过 0、失败 9、需人工 2、不支持 1**；可判定通过率 0/9，覆盖 0/12。无 MiMo 对照，不把超时归为已确认模型能力或代码根因。

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

- M1/M2 场景尚未通关；保守默认保留 CPU 分担，速度受 CPU 与负载影响。2 小时本人日用、视觉模型、手机真机与 Apple 新接口未验；MiMo 未配。初次全 GPU 不作为日用方式，8080/8081/18080 旧入口废弃。
- MW-2 部署须支持 observed v1；本次旧隔离测试库与固定 Core schema（数据库结构）不兼容，已保留备份并用空库验证，未迁移本人数据。根单测与 vendor（内嵌依赖）/外部 Design 夹具按 CI 例外观察；本包未加例外，移除记忆路由的旧平台跳过。极少上下文先压缩与 JSONL（逐行结构化日志）物理整文件解析仍待后续。
- D1 已上线云 API/中继，运维见 deploy README；内容 DNS-01 provider 与 RAM 凭据、逐宿主 CSR 签发/热载及五端 pin 真机仍待后续。本包未做部署验证。frp 无踢在线 client（客户端）的管理 API，中继须经云 TCP socket（网络连接）所有权入口，不能绕过或公网暴露 frps/plugin；D24 浏览器边界保持。

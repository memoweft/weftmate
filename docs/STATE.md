# 当前状态

> 只写现在，整页覆盖，不追加日记。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-07

## 当前里程碑：M0 重置

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-6 本地模型、后台路由与系统状态 | [PR（合并请求）#33](https://github.com/memoweft/weftmate/pull/33) 草稿，验证收尾中；18081 单槽、主请求优先、账户后台模型、桌面/手机状态与重启；Android code15 / UI 0.8.2 |
| Codex · Mac | MW-2 observed 桥接 | MemoWeft #84 已合并，WeftMate #28 合入中：[MemoWeft #84](https://github.com/memoweft/memoweft/pull/84)（CI Gate 已绿）→ [WeftMate #28](https://github.com/memoweft/weftmate/pull/28)；真实 Core 集成通过；按此顺序合入，部署需升级 observed v1 Core |
| Codex · Cloud | S1b 宿主云身份、绑定与设备授权 | [PR #30](https://github.com/memoweft/weftmate/pull/30)：已实现认领恢复/版本化绑定/迁移前备份、RS256+DPoP 换宿主 Cookie、待批准设备最小 Web UI、签名撤销/轮询与 outbox；宿主 7/7、cloud 34/34、UI 场景通过，类型检查/审计通过；待规划审查，PR CI 为门禁，未部署/真实发信；完整客户端接入留 S1c |

已完成：文档/规则重置、M0-1b 清理与模块拆分、M0-2 服务容量与动态预算（PR #24）、H1 iPhone 健康设置/摘要/隔离队列（PR #22）、CI 依赖审计与省钱分组。

## 最近一次验证

- S1b：宿主身份 7/7、实际 cloud OIDC/SQLite→宿主完整流程含在 cloud 34/34、桌面设备批准交互 1/1；旧 store/ID/密码/Cookie/非零同步水位与备份验证通过，A/B 隔离、DPoP 拒绝与 SSE 撤销、云离线本地登录通过。类型检查/根依赖审计（0 漏洞）通过。本机完整 required 712 项：704 通过、7 跳过、1 项既有回环别名环境失败；PR CI 为最终门禁。当前 CUA 无可用浏览器，未取得实际 UI 截图；完整客户端/扫码/TLS listener/推送另包。

- MW-2：真实 Python Core RPC 集成与持久待办/并发撤回 2/2、健康 HTTP 回归 7/7、类型检查/发布预检通过；本地/云端过滤保留普通偏好、账号权限变更、覆盖清除旧指标、删除/导出/重启均通过。CI 新增固定 Core 提交的真实集成任务；本机 required 710 通过/8 跳过，既有 127.0.0.2 回环别名缺失导致 1 项环境失败，最终 PR CI 为门禁。

- M0-3 修订：类型检查通过；完整单测 **868 项：861 通过、5 既有静态失败、2 跳过，新增失败 0**。5 项均在修改前合并基线 `64f9816` 复现；modelTier 保存/回填通过。后续 S0 合并未改 src、根测试或依赖。
- 长会话：同一 23,000+ 旧事件会话的审批/提问通过；旧历史增至 230,000+ 后仍只折叠相关回合，二分定位读取增长 <20。固定 DSH（模型运行时）冷重开 22,005 事件，从 seq=22000 读取并折叠 5 条，完成证据正确。
- M0-6：Qwen 真实 32,768 上下文，12 次链式 `read` 后非空回复、`completed`；主对话与后台真实并发按顺序结束。30 分钟 354 次健康采样全部正常，显存峰值 20,537 MiB（含桌面），无 OOM（内存不足）。全 GPU 初次加载占 24,265 MiB 并持续预热；选择 48 GPU 层 + q8_0 KV cache（键值缓存）。
- M0-6 完整单测 873 项：866 通过、5 既有失败、2 跳过；新增队列 2 项及相关定向测试通过；类型检查、Android code15 构建/JVM（Java 虚拟机）测试、手机 Web 89 项通过。界面见 tests/evidence/m0-6/；空闲宿主场景基线正在重跑。
- S0：上游报告 14/14；本次 Windows 独立测试 8/14，6 项平台夹具失败及 server 清理挂起，均在原样 main `061b0fe` 复现；已终止隔离测试 worker（工作进程），详见 PR #26 审查修改。

## 契约变更

- M0-6：CLIENT_API 3.15，`/system`、三项重启、`/settings/models` 后台选择；手机只读配置 + 重启。模型重启同时重建原生容量缓存。Apple 待接入，原接口兼容。

- S1b：CLIENT_API 7.4–7.5 新增宿主认领/绑定、cloud-nonce/cloud-session、待批准设备决定/配对与云宿主签名撤权接口；host:session 指定宿主 OAuth resource + 邮件确认设备 DPoP key。既有本地身份/数据/接口语义保留，云撤权 epoch 独立。

- MW-2：CLIENT_API 第 6 节新增 memory.state=delivered；queued/empty 区分待交付与撤回清理。DELETE 200 可带 queued，需重试/等待 Core 清理回执；宿主内容已移除，待办只含来源哈希与水位。personal-memory 使用 observed upsert/权限/撤回 RPC；World 与 interactions 召回传实际 model_tier，由 Core 按来源过滤，其他记忆保留。
- S1a：CLIENT_API 第 7 节新增 `/personal/v1/cloud/auth/*`、`/cloud/account`、`/cloud/oidc/*`；邮箱验证/找回/换邮箱 epoch 撤销、新设备邮件确认、PKCE S256/云 audience。宿主接口不变，客户端与宿主验签/DPoP/认领/会话交换在后续包。
- M0-3 / M1-0a：CLIENT_API 3.4 / 4 正式；尾页、beforeSeq 上翻、afterSeq 正向、seq 详情与原生时间线，taskId 为回合键。删除无生产方的 HISTORY_WINDOW_LIMIT 及网关映射；Apple historyLimit 枚举未改，A1 / M1-0d 待接入，排队/插话另包。
- H2：CLIENT_API 第 6 节正式，摘要上传/读取/删除及迟到水位；200 确认摘要和 observed 待办落盘；MW-2 交付后写入 World。3.10 可选 modelTier（auto/local/cloud）；桌面表单保留覆盖，非健康召回照常。A2 现有消息/接管/附件对齐记录继续有效。

## 已知问题

- MW-2：需先合入 MemoWeft PR 并升级 observed v1 Core。真实 Core 集成使用离线测试解释路由；真机上传、日用宿主/模型及 vendor 依赖仍未验证。见 src/personal-health/README.md。
- S0 Windows：POSIX（类 Unix 系统）路径断言、SQLite（嵌入式数据库）先删后关的清理顺序、SIGTERM 预期需跨平台适配；服务代码原样保留，未在本包修复。
- M1-3 极少剩余上下文时先压缩待做；DSH JSONL（逐行结构化日志）物理解析仍可能读整文件。M0-6 为稳定保留 CPU 分担，模型速度受 CPU 与并行负载影响；2 小时本人日用与视觉模型未测。
- 根单测 5 个既有静态失败与 vendor（内嵌依赖）/ 外部 Design 夹具仍按 CI 例外观察；仓库已公开，CI 正常运行。本包移除记忆路由夹具的平台例外，未新增例外。更广的模型路由简化仍见 PR #20。

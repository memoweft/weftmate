# 当前状态

> 只写现在，整页覆盖，不追加日记。路线见 PLAN.md；旧记录见 archive/2026-10-07/。

更新：2026-10-07

## 当前里程碑：M0 重置

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-3 历史分页 + M1-0a 时间线 | [PR（合并请求）#26](https://github.com/memoweft/weftmate/pull/26) 审查修改完成，待复审；已合入 main `061b0fe`（H2 / S0 / D23–D25），来源校验按回合；桌面/手机时间线、任务页删除、Android code14 / UI 0.8.1 已实现 |
| Codex · Mac | A3（A1 + M1-0d）Apple 对话时间线 | [PR #32](https://github.com/memoweft/weftmate/pull/32) 待审查，本地验收通过：在线/离线尾页与上翻、增量、执行/审批/提问/成果卡、删除独立任务页面、Watch 手机桥接及前台触感；[合成证据](../apps/apple/Tests/Evidence/A3/README.md) |
| Codex · Cloud | S1a 云账号、邮箱验证与令牌 | [PR #29](https://github.com/memoweft/weftmate/pull/29)：账号/邮件验证/找回/新设备确认、OIDC Code+PKCE、SQLite adapter、JWKS/刷新轮换已实现；隔离测试 30/30、依赖审计 0 漏洞；[Linux cloud CI](https://github.com/memoweft/weftmate/actions/runs/37617343451/job/112778774483) 通过；未部署/真实发信，客户端与宿主接入留 S1b |

已完成：文档/规则重置、M0-1b 清理与模块拆分、M0-2 服务容量与动态预算（PR #24）、H1 iPhone 健康设置/摘要/隔离队列（PR #22）、H2（PR #25）与 MW-2（PR #28）、CI 依赖审计与省钱分组。

## 最近一次验证

- A3：Swift **260 项通过**；`make test-state` **11 组通过**；macOS / iOS / watchOS Debug 三目标构建通过；iOS 合成时间线 + A2 附件 XCTest **2/2**。22,000 条旧记录只取尾页，上翻 beforeSeq=21906，详情按需一次，审批/回答各一次 POST；截图见 [A3](../apps/apple/Tests/Evidence/A3/README.md)。Mac 辅助功能未授权，未申请；Watch 配对/真实触感、推送与日用宿主尚未验收。

- MW-2：真实 Python Core RPC 集成与持久待办/并发撤回 2/2、健康 HTTP 回归 7/7、类型检查/发布预检通过；本地/云端过滤保留普通偏好、账号权限变更、覆盖清除旧指标、删除/导出/重启均通过。CI 新增固定 Core 提交的真实集成任务；本机 required 710 通过/8 跳过，既有 127.0.0.2 回环别名缺失导致 1 项环境失败，最终 PR CI 为门禁。

- M0-3 修订：类型检查通过；完整单测 **868 项：861 通过、5 既有静态失败、2 跳过，新增失败 0**。5 项均在修改前合并基线 `64f9816` 复现；modelTier 保存/回填通过。后续 S0 合并未改 src、根测试或依赖。
- 长会话：同一 23,000+ 旧事件会话的审批/提问通过；旧历史增至 230,000+ 后仍只折叠相关回合，二分定位读取增长 <20。固定 DSH（模型运行时）冷重开 22,005 事件，从 seq=22000 读取并折叠 5 条，完成证据正确。
- 原桌面/手机截图见 tests/evidence/m0-3/；Android 构建及 JVM（Java 虚拟机）22/22 为原交付，本次未重跑真机。Qwen / MiMo 基线与真实长任务回归尚未跑。
- S0：上游报告 14/14；本次 Windows 独立测试 8/14，6 项平台夹具失败及 server 清理挂起，均在原样 main `061b0fe` 复现；已终止隔离测试 worker（工作进程），详见 PR #26 审查修改。

## 契约变更

- A3：现有 3.4 / 4 契约已接入 Apple，服务端接口未变；第 5 节历史/时间线差异标「已在 A3 修复」。上翻与正向水位独立，离线缓存分块读取；回合键不作为 /tasks 根 ID，成果以账号/会话授权元数据取根绑定。Watch 通过 iPhone 原生连接，不共享宿主凭据。

- MW-2：CLIENT_API 第 6 节新增 memory.state=delivered；queued/empty 区分待交付与撤回清理。DELETE 200 可带 queued，需重试/等待 Core 清理回执；宿主内容已移除，待办只含来源哈希与水位。personal-memory 使用 observed upsert/权限/撤回 RPC；World 与 interactions 召回传实际 model_tier，由 Core 按来源过滤，其他记忆保留。
- S1a：CLIENT_API 第 7 节新增 `/personal/v1/cloud/auth/*`、`/cloud/account`、`/cloud/oidc/*`；邮箱验证/找回/换邮箱 epoch 撤销、新设备邮件确认、PKCE S256/云 audience。宿主接口不变，客户端与宿主验签/DPoP/认领/会话交换在后续包。
- M0-3 / M1-0a：CLIENT_API 3.4 / 4 正式；尾页、beforeSeq 上翻、afterSeq 正向、seq 详情与原生时间线，taskId 为回合键。删除无生产方的 HISTORY_WINDOW_LIMIT 及网关映射；Apple 已在 A3 接入并移除 historyLimit；排队/插话另包。
- H2：CLIENT_API 第 6 节正式，摘要上传/读取/删除及迟到水位；200 确认摘要和 observed 待办落盘；MW-2 交付后写入 World。3.10 可选 modelTier（auto/local/cloud）；桌面表单保留覆盖，非健康召回照常。A2 现有消息/接管/附件对齐记录继续有效。

## 已知问题

- MW-2：需先合入 MemoWeft PR 并升级 observed v1 Core。真实 Core 集成使用离线测试解释路由；真机上传、日用宿主/模型及 vendor 依赖仍未验证。见 src/personal-health/README.md。
- S0 Windows：POSIX（类 Unix 系统）路径断言、SQLite（嵌入式数据库）先删后关的清理顺序、SIGTERM 预期需跨平台适配；服务代码原样保留，未在本包修复。
- M0-6 本地 Qwen 启动不统一、曾 OOM（内存不足）；M1-3 极少剩余上下文时先压缩待做。DSH JSONL（逐行结构化日志）顺序介质的物理解析仍可能读取整文件；本包约束来源投影范围。
- 根单测既有失败、固定 DSH / 外部 Design 夹具与跨平台适配尚未全部解决；GitHub Actions（自动化工作流）现已在公开仓库运行。模型路由进一步简化待协调恢复/队列/引用保护（PR #20）。

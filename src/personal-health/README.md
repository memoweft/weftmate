# 健康日摘要与 MemoWeft observed（H2 / MW-2）

客户端只调用 `/personal/v1/health/daily-summaries`，契约见 `docs/CLIENT_API.md` 第 6 节。`http.mjs` 在个人访问服务认证后分发；写操作进入原有 `context.serial` 并重新认证，继承 Cookie/Bearer、账号设备范围、Origin 与 CSRF 行为。

摘要和 observed 交付状态位于 `<personal-access-root>/accounts/<ownerId>/health/daily-summaries.json`。使用私有目录/文件保护及 fsync + 原子替换；账号/设备/日期产生稳定的来源哈希。新版本完整覆盖，省略的指标真正消失；旧版本及同时间不同内容拒绝，同版本相同内容幂等。账号最新 `summarizedAt` 的云端选择作用于全部摘要；同时间 false 优先，回填与重试不能放宽新选择。

MW-2 已在现有 `personal-memory` 管理器消费队列：`upsert_observed` 写 exact observed 证据及其状态投影，`update_observed_permissions` 更新来源权限，`retract_observed` 撤回来源。数据不通过 user/assistant 摄取，不发送给写入或嵌入模型。MemoWeft 能力要求 `observed_evidence: 1`、`recall_model_tier: true`；需先合入 MemoWeft 的 MW-2 PR，再安装含此契约的 Core。CI 的真实 Core 集成任务使用固定候选提交验证同一接口。

摘要写入与账号选择变更后自动交付。每条记录保存内容版本、已应用权限哈希、证据 ID 和 World 修订；收到 Core 成功回执才标记交付。同一来源锁串行处理交付与后续更新/DELETE，防止晚到写入复活。进程中断、Core 不可用或存储清理未完成时保留可重放状态；管理器的 status、recall 与 `flushObserved` 会重试。POST 返回 `memory.state=delivered` 表示交付已确认；queued 表示宿主已持久化，Core 待交付。`observedOutbox` 只返回剩余待写输入。

DELETE 先移除宿主摘要、设备及健康文本，保存无健康内容的来源哈希/删除水位待办，然后请求 Core 真正遗忘。撤回覆盖证据、混合来源的衍生 World 项、索引、形成/审查台账、缓存快照及依赖健康来源的助手历史；独立记忆保留。清理失败时 `memory.state=queued`，同一 DELETE 可重试；没有健康内容的撤回待办跨重启保存，Core 确认 `storage_cleanup.state=complete` 后移除。迟到 `summarizedAt <= 水位` 拒绝，更晚的合法版本可重新上传。当前存储清理不宣称擦除文件系统快照或外部备份。

召回将实际模型的 `modelTierFor` 结果通过 `model_tier` 传给 World 和 interactions RPC。local 只读允许本地的来源；cloud 只读允许云端的来源，并检查衍生项及助手历史的记忆依赖。健康云端选择 false 时，其他可读记忆照常召回。来源权限同步失败时暂停该次上下文注入，待重试成功后恢复，避免注入旧授权数据。模型层级继续按地址自动判定，并保留 `modelTier: auto|local|cloud` 手动覆盖。

`tests/personal-memory-observed.integration.test.ts` 使用真实 Python Core + stdio RPC + 隔离测试账号/目录，覆盖普通对话偏好与健康 observed 共存、本地/云端过滤、全账号权限变化、覆盖清除旧指标、删除/导出和重启。解释模型使用显式测试路由，不访问真实模型服务；Core 存储、World、召回和真正遗忘均是真实实现。`personal-memory-observed-outbox.test.ts` 覆盖失败重试、交付确认、无内容撤回待办、清理 pending、重启、水位与并发删除。既有健康 HTTP、权限和模型位置测试继续验证客户端边界。

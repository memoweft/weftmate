# 健康日摘要（H2）

客户端只调用 `/personal/v1/health/daily-summaries`，契约见 `docs/CLIENT_API.md` 第 6 节。`http.mjs` 在个人访问服务完成认证后分发；写操作进入原有 `context.serial` 并重新认证，继承 Cookie/Bearer、账号设备范围、Origin 与 CSRF 行为。历史、桌面 UI、手机 UI 未改动。

## 私有存储与 observed 待写队列

文件位于 `<personal-access-root>/accounts/<ownerId>/health/daily-summaries.json`。使用 `private-host-storage` 的 POSIX 0700/0600 或 Windows 当前用户 ACL，复用 `durableWrite` 的 fsync + 原子替换。同一个文件事务保存摘要、账号使用选择和每条摘要的 observed 待写证据；没有日志副本或原始样本流。

账号/来源设备/日期对应一条记录，证据 `source_id/evidence_id` 由该三元组哈希生成，版本 `payload_hash` 根据规范化摘要计算。新版本覆盖整个摘要及其待写证据，省略的指标真正消失；不同手机不会相加。较旧汇总时间拒绝；同一汇总时间的不同内容拒绝，相同内容幂等成功。云端选择和自评频率按账号最新 `summarizedAt` 应用于全部摘要及证据；相同时间出现冲突时 false 优先，旧回填和重试不能放宽新选择。

DELETE 真正移除目标摘要与对应待写证据，留存的只有无健康内容的删除时间水位。水位为服务器删除时间与已有汇总时间的较大值；晚到的 `summarizedAt <= 水位` 被拒绝，重新读取生成的较新版本可以上传。全部删除包含所有日期水位；多次删除幂等。这里的真实删除指当前宿主文件的内容移除，不宣称安全擦除文件系统/备份。

## MemoWeft 桥接现状与后续接线

现有写入链是 `main.mjs` 的账号绑定 → `personal-memory/index.mjs` → `MemoWeftRpc` → `memoweft.integrations.dsh_bridge`（RPC v2）。当前桥接只定义对话 `ingest_boundary` 和 World 纠正/静音/删除命令；`boundary.mjs` 只允许 user/assistant 消息。没有正式的 observed upsert 契约；H2 不把健康数据伪装为用户发言、不猜测新的 RPC 方法，也不绕过桥接直写 SQLite。

因此 H2 落地的是任务允许的待写队列分支，**尚未把健康证据写入 MemoWeft World**。POST 的 `memory.state=queued` / `reasonCode=MEMORY_OBSERVED_UNSUPPORTED` 明确反映这一点；200 表示摘要与队列已持久化，Apple 可清除上传待办。`personal-memory` 管理器持有同一个 `healthStore`，宿主方法 `observedOutbox(ownerId)` 读取可回放的 `{operation:"upsert",idempotencyKey,evidence}` 列表；每条证据含 `source_kind=observed`、中文事实、设备/日期/时区/汇总时间及 local/cloud 权限。此方法仅导出待写输入，不宣称已回放。删除级联验证的是已落盘队列撤回，当前不存在本包写入的 Core 证据。

MemoWeft 侧需先补充并发布：

- 类型明确的 observed 写入/更新协议：账号 subject、稳定来源 ID、版本与幂等键；不经过对话角色；更新撤回被省略的旧事实/索引。
- 按来源更新权限与撤回/真实删除协议及回执：覆盖衍生 World 项、证据、索引与存储清理；同来源删除后可接受新的合法版本。
- 按模型目的地执行证据和衍生项权限过滤的召回协议，返回可验证的来源与过滤结果（包括 interactions），避免旧派生记忆绕过 opt-out。

补齐后在 **现有 `personal-memory` 管理器**内消费 `observedOutbox`，落盘已应用版本/回执并给覆盖和 DELETE 接上 Core 撤回。不得将该待写列表发送给不受本地/云端策略约束的写入模型。需要真实 Core 的更新/撤回/重启/权限集成测试；当前 RPC 夹具测试不能替代这些验收。

## 模型使用边界

`memoryRecallModelTier` 使用宿主设置中的真实 profile，并要求 `baseUrl === FORMAL_LOCAL_BASE_URL` 且 `isFormalLocalProfile(profile.id) === true`，才能判断为 local。该目录本来就由宿主校验正式本地服务来源；名字中出现 local、私有 loopback URL 或 localhost 不能证明本地（可能为云端代理），其余按 cloud 处理。账号路由权限仍由现有 `memoryRecallDestination` 校验。`main.mjs` 把此结论作为可信 processingRoute 属性传给管理器，客户端和模型不能指定它；RPC initialize 的 `model_tier` 同步使用该结论。

`personal-memory.recall` 在开始 RPC 前经过 `healthStore.withRecallPolicy`。当前 RPC 只提供 World/interactions 混合文本，没有可靠的逐条健康来源过滤，因此账号仍有健康摘要且最新选择为 false 时，cloud/未知目的地的**整段个人记忆召回**返回 `withheld / MEMORY_HEALTH_CLOUD_BLOCKED`。local 可继续召回；明确选择 true 可恢复 cloud 召回。待写健康事实尚未进入 World，故当前本地模型也不会从 World 召回到这些待写事实；GET 可供客户端读取。MemoWeft 补齐过滤协议后才能恢复云端的非健康记忆，同时确保衍生健康项被排除。

同一账号的召回/写入使用同一事务队列，opt-out 提交成功后的后续 pre-step 会重新检查；现有 personal-memory 插件每个 pre-step 清除旧的插件记忆消息，拒绝后不会复用旧 snapshot。这里约束的是宿主自动召回；不删除或改写用户对话与助手历史文本。

## 验证

`tests/personal-health.test.ts` 使用临时目录、测试账号、合成 RPC；覆盖认证/CSRF/同源、请求限制、幂等与陈旧覆盖、来源隔离、多设备、最新选择、日期/全部删除与队列撤回、删除水位、重开存储、私有权限、中文 observed 格式和云端召回拒绝。

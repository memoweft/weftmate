# 当前状态

> 只写现在，整页覆盖更新，不追加日记。≤1 页。旧状态记录见 `archive/2026-10-07/CURRENT_STATE.md`。

更新：2026-10-07

## 当前里程碑：M0 重置（见 PLAN.md 第 6 节）

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-3 历史分页 + M1-0a 对话时间线 | 进行中（`wp/m0-3-timeline`）；M0-2 已合入 [PR #24](https://github.com/memoweft/weftmate/pull/24) |
| Codex · Mac | H2 健康摘要服务端 | `wp/h2-health-server` 已实现；POST/GET/DELETE、私有存储、observed 待写队列及云端召回限制；相关检查通过，CI 与审查见本包 PR |

已完成：
- 规则松绑与文档归档；GitHub `memoweft/weftmate` 已用本地历史重置（旧仓库备份在 `WeftMate/References/_archive/github-weftmate-2026-10-07.bundle`）。
- 任务 15 在途改动已作 checkpoint 提交 `1f922a5`（通用执行、审批、用户提问、Android 文本成果 MIME，未经独立验收）。
- M0-1b：旧 alpha2 路径清理、一次性脚本归档；`personal-access/index.mjs` 6160 → 614 行，导出、接口和存储行为兼容。
- M0-2：[PR #24](https://github.com/memoweft/weftmate/pull/24) 已合入；预算按服务实际上下文计算，personal-remote 接入原生压缩。
- H1：[PR #22](https://github.com/memoweft/weftmate/pull/22) 已合入；iPhone 健康设置、8 类只读权限、每日摘要/14 天基线、云端选择/自评频率与隔离持久队列已实现。Core 253 项、状态检查 10 组、三目标构建及 iOS 隔离模拟器 2 项场景通过；服务端接收由 H2 接续；World observed 写入待 MemoWeft 协议补齐。

## 最近一次场景结果

H2：隔离健康 HTTP/存储/RPC 场景 8/8，通过幂等、设备/账号隔离、删除与待写证据撤回、迟到上传、云端选择/召回、认证/CSRF/超大请求及重开存储；既有记忆/个人访问回归 43 通过、1 个需显式 TLS 夹具的场景跳过；类型检查通过。未连真实宿主、未碰日用数据；vendor/真实 Core observed 写入与撤回未验，CI 按现有精确例外运行。

M0-7 场景集已建立；Qwen / MiMo 实测基线尚未跑。

M0-2 工程检查：类型检查通过；相关单测 46/46；完整单测 855/868 通过、11 原有失败、2 跳过，新增失败 0。隔离 DSH（模型运行时）完成 10 次原生文件读取及最终回复；服务容量截断、配置/密钥刷新和实际请求输出预算通过。真实 Qwen 场景未跑，已知本机端口的只读元数据接口均不可用。

CI-1 的三平台必过/非阻塞基线结果及最终运行链接见 [PR #23](https://github.com/memoweft/weftmate/pull/23)。原 11 项基线外，在未改动 main `855044d` 上确认图片消息原请求重试（偶发 404）与重启后的停止回执重试两项失败；不改产品逻辑，13 项按精确名称单独非阻塞运行，同文件其他用例仍必须通过。

## 契约变更

- 2026-10-07 / H2：CLIENT_API 第 6 节转正式：POST 同账号/设备/日期完整覆盖；GET 近 1–365 天（默认 14，查询时区默认 UTC）；DELETE 日期/全部及迟到上传水位。200 确认摘要和 observed 待写队列落盘；MemoWeft 无 observed 写入契约，尚未写 World。最新选择作用全账号；false 时 cloud/未知路由的整段个人记忆召回 withheld，本地由正式宿主 profile 证明；后续需 Core 来源权限过滤/撤回协议。

- 2026-10-06 / H1：CLIENT_API 第 6 节新增健康摘要草案：POST `/health/daily-summaries` 按账号/来源设备/日期幂等，含云端使用选择与自评频率；DELETE 按日期/全部；Apple 404/501 静默保留本地队列。待 Windows 接收、MemoWeft observed 与模型使用/删除闭环实现。

- 2026-10-07 / A2：服务端不变；Apple 对齐 8,192 UTF-16 / 12 KiB JSON、确认接管和附件现有接口。`/sessions` 无 origin，任务入口以 `/status` 的仅所有者桌面能力 + 实时 sendAvailable 确认 personal-remote；shared-chat 与范围不明会话不请求 /tasks。

- 2026-10-07 / M0-5：CLIENT_API 建立77项现有业务接口基线；Apple消息/纠正体上限、shared-chat任务控制、接管确认字段及分页/附件/模型等缺口已列；M0-3分页与M1-0a十种时间线事件为待Windows确认草案。仅文档，现有接口兼容性不变。

## 已知问题

- H2：当前 MemoWeft RPC 缺少 observed upsert 与来源权限/撤回协议；健康事实仍在可回放队列，未进入 World。混合召回不能可靠过滤衍生来源，opt-out 暂时阻止整段云端个人记忆召回；需求见 `src/personal-health/README.md`。

- 长会话打开时报「历史超出当前可读取范围」：`src/runtime/dsh-adapter/sessions.mjs` `historyPage` 每页从尾部倒扫，超过 24×50 条即失败（M0-3）。
- M0-2 预算来源已修复并通过隔离场景；真实 Qwen 长任务回归待服务可用。剩余上下文极少时输出预算会降到 1 token（`outputBudget` 下限），应先触发压缩——归 M1-3 处理。
- 本地 Qwen 服务曾多次显存不足（OOM），启动方式不统一（M0-6）。
- 模型路由只合并两个薄封装；跨文件恢复、串行队列和历史会话引用保护保留，进一步简化仍需协调持久化与重载路径（见 PR #20）。
- CI-1 待续：固定 DSH 的可重复编译产物未提供，vendor 生成/验证、契约及 103 个依赖 vendor 的用例与 3 个文件明确未验证；另缺外部 Design 夹具。POSIX 整树清理、Windows 写死路径夹具与 Linux optional 夹具平台适配列为后续；13 项主干失败仍待产品修复。依赖审计漏洞已全部解除。

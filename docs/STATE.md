# 当前状态

> 只写现在，整页覆盖更新，不追加日记。≤1 页。旧状态记录见 `archive/2026-10-07/CURRENT_STATE.md`。

更新：2026-10-07

## 当前里程碑：M0 重置（见 PLAN.md 第 6 节）

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-1b 代码瘦身 | [PR（拉取请求）#20](https://github.com/memoweft/weftmate/pull/20) 待审；5 项完成，模型切换部分简化 |
| Codex · Mac | A2 Apple 客户端契约对齐完成 | `wp/a2-apple-contract`：发送/纠正体与 UTF-16 上限、明确接管确认、personal-remote 任务范围、图片/文件附件上传与历史预览已实现；Core 243 项、状态检查 10 组与三目标构建通过；iPhone 隔离 UI 内容可见场景通过；Mac UI 受本机自动化/辅助功能授权阻塞；[PR #21](https://github.com/memoweft/weftmate/pull/21) 已合入 main |

已完成：
- 规则松绑与文档归档；GitHub `memoweft/weftmate` 已用本地历史重置（旧仓库备份在 `WeftMate/References/_archive/github-weftmate-2026-10-07.bundle`）。
- 任务 15 在途改动已作 checkpoint 提交 `1f922a5`（通用执行、审批、用户提问、Android 文本成果 MIME，未经独立验收）。
- M0-1b：旧 alpha2 路径清理、一次性脚本归档；`personal-access/index.mjs` 6160 → 614 行，导出、接口和存储行为兼容。

## 最近一次场景结果

尚无（M0-7 建立）。

M0-1b 工程检查：类型检查通过；完整单测基线 873/890 通过、15 失败、2 跳过 → 当前 843/856 通过、11 原有失败、2 跳过（含主干新增评测测试）；新增失败 0。分项检查与完整失败用例见 PR。

## 契约变更

- 2026-10-07 / A2：服务端不变；Apple 对齐 8,192 UTF-16 / 12 KiB JSON、确认接管和附件现有接口。`/sessions` 无 origin，任务入口以 `/status` 的仅所有者桌面能力 + 实时 sendAvailable 确认 personal-remote；shared-chat 与范围不明会话不请求 /tasks。

- 2026-10-07 / M0-5：CLIENT_API 建立77项现有业务接口基线；Apple消息/纠正体上限、shared-chat任务控制、接管确认字段及分页/附件/模型等缺口已列；M0-3分页与M1-0a十种时间线事件为待Windows确认草案。仅文档，现有接口兼容性不变。

## 已知问题

- 长会话打开时报「历史超出当前可读取范围」：`src/runtime/dsh-adapter/sessions.mjs` `historyPage` 每页从尾部倒扫，超过 24×50 条即失败（M0-3）。
- 长任务以 `max-tokens` 空结束：上下文/输出预算未按实际模型服务计算（M0-2）。
- 本地 Qwen 服务曾多次显存不足（OOM），启动方式不统一（M0-6）。
- 模型路由只合并两个薄封装；跨文件恢复、串行队列和历史会话引用保护保留，进一步简化仍需协调持久化与重载路径（见 PR #20）。

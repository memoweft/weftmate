# 当前状态

> 只写现在，整页覆盖更新，不追加日记。≤1 页。旧状态记录见 `archive/2026-10-07/CURRENT_STATE.md`。

更新：2026-10-07

## 当前里程碑：M0 重置（见 PLAN.md 第 6 节）

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-1b 代码瘦身 | 待开工 |
| Codex · Mac | M0-7 场景评测集编写完成 | `wp/m0-7-eval`：12 条场景（办事 6 / 记忆 4 / 跨端人工 2）；无依赖 Node 24 runner 与隔离启动说明；假 `/personal/v1` 自测 11/11 通过；`memory_used` 缺公开回复依据，标 unsupported，LLM judge 可选；待 Windows 跑 Qwen / MiMo 基线 |

已完成：
- 规则松绑与文档归档；GitHub `memoweft/weftmate` 已用本地历史重置（旧仓库备份在 `WeftMate/References/_archive/github-weftmate-2026-10-07.bundle`）。
- 任务 15 在途改动已作 checkpoint 提交 `1f922a5`（通用执行、审批、用户提问、Android 文本成果 MIME，未经独立验收）。

## 最近一次场景结果

尚无（M0-7 建立）。

## 契约变更

- 2026-10-07 / M0-5：CLIENT_API 建立77项现有业务接口基线；Apple消息/纠正体上限、shared-chat任务控制、接管确认字段及分页/附件/模型等缺口已列；M0-3分页与M1-0a十种时间线事件为待Windows确认草案。仅文档，现有接口兼容性不变。

## 已知问题

- 长会话打开时报「历史超出当前可读取范围」：`src/runtime/dsh-adapter/sessions.mjs` `historyPage` 每页从尾部倒扫，超过 24×50 条即失败（M0-3）。
- 长任务以 `max-tokens` 空结束：上下文/输出预算未按实际模型服务计算（M0-2）。
- 本地 Qwen 服务曾多次显存不足（OOM），启动方式不统一（M0-6）。

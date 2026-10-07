# 当前状态

> 只写现在，整页覆盖更新，不追加日记。≤1 页。旧状态记录见 `archive/2026-10-07/CURRENT_STATE.md`。

更新：2026-10-07

## 当前里程碑：M0 重置（见 PLAN.md 第 6 节）

| 执行者 | 当前工作包 | 状态 |
|---|---|---|
| Codex · Windows | M0-1b 代码瘦身 | 待开工 |
| Codex · Mac | A0 已完成本地合并；下一包 M0-5 契约文档 | `wp/apple-sync`：build 11；macOS/iOS/watchOS 构建、Core 233 项测试 + 状态 91 项检查通过；待 Claude 经 SSH 取分支并代推送/PR |

已完成：
- 规则松绑与文档归档；GitHub `memoweft/weftmate` 已用本地历史重置（旧仓库备份在 `WeftMate/References/_archive/github-weftmate-2026-10-07.bundle`）。
- 任务 15 在途改动已作 checkpoint 提交 `1f922a5`（通用执行、审批、用户提问、Android 文本成果 MIME，未经独立验收）。

## 最近一次场景结果

尚无（M0-7 建立）。

## 契约变更

（W-Core 修改 `/personal/v1` 时在此记一行：日期 / 接口 / 变化 / 是否兼容。）

## 已知问题

- 长会话打开时报「历史超出当前可读取范围」：`src/runtime/dsh-adapter/sessions.mjs` `historyPage` 每页从尾部倒扫，超过 24×50 条即失败（M0-3）。
- 长任务以 `max-tokens` 空结束：上下文/输出预算未按实际模型服务计算（M0-2）。
- 本地 Qwen 服务曾多次显存不足（OOM），启动方式不统一（M0-6）。

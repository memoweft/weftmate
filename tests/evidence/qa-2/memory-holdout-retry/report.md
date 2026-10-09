# WeftMate 场景评测

时间：2026-10-09T14:20:20.732Z · 模型：mimo · 宿主：http://127.0.0.1:57812

| 场景 | 分类 | 结果 | 耗时 | 原因 | 最终回复摘要 |
|---|---|---|---|---|---|
| memory-1x-correction · 留出：浇水量省略主题纠正 | memory | 失败 | 13.88s | reply_contains did not match expected value; memory_used did not match expected value; holdout must adopt its own current formal memory | 按你固定的习惯，每盆浇 300 毫升即可。 |

检查明细：

- **memory-1x-correction**：M2e留出场景；园艺数量领域；三个独立会话。基线严格检查当前纠正项采用、旧项失效且排除、双方原话来源保留及未声明审批。
  - turn_status（第 1 轮）：通过
  - turn_status（第 2 轮）：通过
  - reply_contains：失败 — reply_contains did not match expected value
  - turn_status：通过
  - memory_used：失败 — memory_used did not match expected value
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.

通过 0 · 失败 1 · 需人工 0 · 不支持 0 · 跳过检查 1

可判定场景通过率：0/1 = 0.0%。
全部场景通过覆盖率：0/1 = 0.0%。需人工、不支持不算通过。

文件场景目录保留在系统临时目录供复查；JSON 含完整回合和逐项检查。凭据仅在本地 credentials.json，不在报告中。

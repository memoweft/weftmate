# WeftMate 场景评测

时间：2026-10-09T14:06:16.431Z · 模型：lan/local-quality · 宿主：http://127.0.0.1:54031

| 场景 | 分类 | 结果 | 耗时 | 原因 | 最终回复摘要 |
|---|---|---|---|---|---|
| action-01-organize · 整理收件目录 | action | 通过 | 57.28s |  | 收拾好了，收件箱现在按类型归类：  [local path] ├─ 文本\ │  └─ 会议记录.txt ├─ 表格\ │  └─ 预算.csv ├─ 文档\ │  └─ 说明.md └─ 不要动\          ← 未移动，原样保留    └─ 保留.txt  文件名和内容都保留，未动「不要动」文件夹及其内部文件。 |
| action-03-read-code · 读小项目解释金额计算 | action | 通过 | 76.09s |  | 项目里的计算在 `[local path]  ```js export function total(items, discount = 0) {   const cents = items.reduce((sum, x) =&gt; sum + Math.round(x.price * 100) * x.quantity, 0);   return Math.round(cents * (1 - discount)) / 100; } ```  * 先 `x.price * 100` 并 `Math.round` 是把价格转成整数“分”来算。JavaScript 的浮点数会有 12.5 * 100 = 1249.999… 这种误差，用分做整数累加后再除回元，能保证金额精确。 * `discount` 是折扣比例，函数内部用 `1 - discount`。README 说明折扣参数是 0 到 1 的比例。  按你说的场景：两件单价 12.50 合计分 = 2 × Math.round(12.50 × 100) = 2 × 1250 = 2500 分 = 25.00 元  打八折 = 付 80 |
| action-05-stop-resume · 中途停下再接着办 | action | 通过 | 56.36s |  | 已完成。  进度文件已创建：`[local path] 内容为「开始整理」。 汇总已生成：`[local path] `records.csv` 计算得出记录 2 条，总金额 30。 |

检查明细：

- **action-01-organize**：只在 runner 临时目录移动文件；任何未声明的审批会使场景失败并请求取消。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；360秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限180秒。
  - file_contains：通过
  - file_contains：通过
  - file_contains：通过
  - file_contains：通过
  - file_absent：通过
  - file_absent：通过
  - file_absent：通过
  - turn_status：通过
- **action-03-read-code**：固定项目由 runner 生成；评测读取代码与解释，文件内容检查验证关键代码仍在。本地 Qwen 27B 首轮 180 秒到期时仍在读取和运行核验，调整为 600 秒；关键代码不变的检查仍保留。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；360秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限600秒。
  - reply_matches：通过
  - reply_matches：通过
  - file_contains：通过
  - turn_status：通过
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.
- **action-05-stop-resume**：第一轮发送后 1 秒由 runner 调用任务 stop，等待 aborted，再调用同一根任务 resume；不把 HTTP 202 当停止完成。非 personal-remote 账号的任务接口可能不支持。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；600秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限180秒。
  - turn_status（第 1 轮）：通过
  - file_absent（第 1 轮）：通过
  - file_contains（第 2 轮）：通过
  - turn_status（第 2 轮）：通过

通过 3 · 失败 0 · 需人工 0 · 不支持 0 · 跳过检查 1

可判定场景通过率：3/3 = 100.0%。
全部场景通过覆盖率：3/3 = 100.0%。需人工、不支持不算通过。

文件场景目录保留在系统临时目录供复查；JSON 含完整回合和逐项检查。凭据仅在本地 credentials.json，不在报告中。

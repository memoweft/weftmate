# WeftMate 场景评测

时间：2026-10-09T14:00:32.434Z · 模型：mimo · 宿主：http://127.0.0.1:65300

| 场景 | 分类 | 结果 | 耗时 | 原因 | 最终回复摘要 |
|---|---|---|---|---|---|
| action-01-organize · 整理收件目录 | action | 通过 | 54.79s |  | 收件箱已按类型整理好，文件名和内容都原样保留，「不要动」文件夹未触碰。  现在 `inbox` 结构：  - `文本\会议记录.txt`（28 字节，内容「周五讨论秋季活动。」） - `表格\预算.csv`（25 字节，表头「项目,金额 / 场地,300」） - `文档\说明.md`（15 字节，内容「# 活动说明」） - `不要动\保留.txt`（13 字节，原样保留，未移动、未改写）  三份文件都用移动操作完成，字节数与移动前一致，移动后我重新读过一遍确认内容未变。 |
| action-02-web-document · 查网页并保存说明 | action | 通过 | 710.98s |  | 已完成：说明文档已保存到 `[local path] 13.6/npm 11/AsyncContextFrame 等新变化、弃用与破坏性改动、22.x 已回移的非独占特性、升级建议），并附来源链接。依据的官方资料包括 Node.js 24.0.0 与 22.0.0 发布说明、官方版本状态页、CHANGELOG_V24、22.12.0（require(esm)）、22.18.0（类型剥离默认）及 PR #57199。 |
| action-03-read-code · 读小项目解释金额计算 | action | 通过 | 78.78s |  | **答案：20.00 元（总价 20 元）**，代码没动，我用它实际跑了一遍验证：`total([{price:12.50,quantity:1},{price:12.50,quantity:1}], 0.2)` 返回 `20`（写成 `quantity:2` 也一样）。  计算过程对着 `pricing.mjs` 看：  1. 第 2 行：每件 `Math.round(x.price * 100) * x.quantity` → 12.50×100 = **1250 分**，两件共 **2500 分**（= 25.00 元）。 2. 第 3 行：`Math.round(cents * (1 - discount)) / 100`。八折按 README 的约定就是 `discount = 0.2`，所以 2500 × (1−0.2) = 2000 分，再除以 100 → **20.00 元**。  **为什么先乘 100：** 把钱换成整数「分」来算，避免二进制浮点误差。JS 的 `Number` 是双精度浮点，很多十进制小数表示不准（经典例子 `0.1 + 0.2 === 0.300 |
| action-04-research-script · 查资料写脚本并实际运行 | action | 失败 | 66.81s | Unexpected approval; scenario has no matching decision (left pending) | 资料已查到（Node.js 官方 `fs` 文档页，下面写脚本用其中的 `readFileSync`）。现在写脚本： |
| action-05-stop-resume · 中途停下再接着办 | action | 通过 | 37.90s |  | 目录里还没有进度文件，我先补上「开始整理」，再生成汇总。 已完成：`进度.txt` 已写入「开始整理」，`汇总.md` 已生成，内容读自 `records.csv`（2 条记录），**总金额：30**。 |
| action-06-delete-approval · 删除操作批准一次拒绝一次 | action | 通过 | 27.49s |  | 删除操作被拒绝了，我没有执行删除，`[local path] 仍然保留着。  看文件名是“还要保留”，可能它确实不该删——如果你想留着它，那就没问题；如果仍要删除，请再告诉我一次。 |

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
- **action-02-web-document**：需要联网；文件检查只确认保存和官方来源链接，具体事实准确性由 Windows 人工抽查，judge 为可选补充。本地 Qwen 27B 首轮 240 秒到期时仍在正常检索官方迁移指南，调整为 600 秒以覆盖检索、写入和核验。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；900秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限600秒。
  - file_exists：通过
  - file_contains：通过
  - reply_matches：通过
  - turn_status：通过
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.
- **action-03-read-code**：固定项目由 runner 生成；评测读取代码与解释，文件内容检查验证关键代码仍在。本地 Qwen 27B 首轮 180 秒到期时仍在读取和运行核验，调整为 600 秒；关键代码不变的检查仍保留。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；360秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限600秒。
  - reply_matches：通过
  - reply_matches：通过
  - file_contains：通过
  - turn_status：通过
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.
- **action-04-research-script**：需要联网和宿主 Node；输出数字字符串检查配合回复检查，实际脚本可在 Windows 复查。本地 Qwen 27B 首轮 300 秒到期时仍在网页读取和命令执行，调整为 600 秒；修复 web_fetch 提供方后重跑。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；900秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限600秒。
- **action-05-stop-resume**：第一轮发送后 1 秒由 runner 调用任务 stop，等待 aborted，再调用同一根任务 resume；不把 HTTP 202 当停止完成。非 personal-remote 账号的任务接口可能不支持。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；600秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限180秒。
  - turn_status（第 1 轮）：通过
  - file_absent（第 1 轮）：通过
  - file_contains（第 2 轮）：通过
  - turn_status（第 2 轮）：通过
- **action-06-delete-approval**：按轮声明审批决定；每轮最多处理所声明的那一次。第二轮用户在审批卡拒绝，文件必须仍在；终态允许拒绝后的 completed/blocked/aborted。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；600秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限180秒。
  - approval_seen（第 1 轮）：通过
  - file_absent（第 1 轮）：通过
  - turn_status（第 1 轮）：通过
  - approval_seen（第 2 轮）：通过
  - file_contains（第 2 轮）：通过
  - turn_status（第 2 轮）：通过
  - reply_matches（第 2 轮）：通过

通过 5 · 失败 1 · 需人工 0 · 不支持 0 · 跳过检查 2

可判定场景通过率：5/6 = 83.3%。
全部场景通过覆盖率：5/6 = 83.3%。需人工、不支持不算通过。

文件场景目录保留在系统临时目录供复查；JSON 含完整回合和逐项检查。凭据仅在本地 credentials.json，不在报告中。

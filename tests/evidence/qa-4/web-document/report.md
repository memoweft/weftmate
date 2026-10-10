# WeftMate 场景评测

时间：2026-10-09T23:40:30.532Z · 模型：mimo · 宿主：http://127.0.0.1:53780

| 场景 | 分类 | 结果 | 耗时 | 原因 | 最终回复摘要 |
|---|---|---|---|---|---|
| action-02-web-document · 查网页并保存说明 | action | 通过 | 62.52s |  | 我先抓取 Node.js 官方的 22 与 24 版本说明，对比初始大版本的要点，再写成中文短文存到指定路径。 v22 的官方公告已拿到；v24 页面一次抓取失败，我再用另一官方链接补取。 需要补齐 v24 的“弃用与移除”部分，我用官方发布页的后续段落读取，再落文件。 主干信息已足够：官方 24.0.0 发布说明列出 V8、npm、AsyncContextFrame、权限模型、Windows 构建链等变化；v22 官方公告列出 require(esm)、WebSocket、watch 稳定化等。现在写入指定 Markdown 文件并回读确认。 已写入并回读确认：`node24说明.md`，内容来自 Node.js 官方的 [v22 发布公告](https://nodejs.org/en/blog/announcements/v22-release-announce) 与 [v24.0.0 发布说明](https://nodejs.org/blog/release/v24.0.0)。 |

检查明细：

- **action-02-web-document**：需要联网；文件检查只确认保存和官方来源链接，具体事实准确性由 Windows 人工抽查，judge 为可选补充。本地 Qwen 27B 首轮 240 秒到期时仍在正常检索官方迁移指南，调整为 600 秒以覆盖检索、写入和核验。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；900秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限600秒。
  - file_exists：通过
  - file_contains：通过
  - reply_matches：通过
  - turn_status：通过
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.

通过 1 · 失败 0 · 需人工 0 · 不支持 0 · 跳过检查 1

可判定场景通过率：1/1 = 100.0%。
全部场景通过覆盖率：1/1 = 100.0%。需人工、不支持不算通过。

文件场景目录保留在系统临时目录供复查；JSON 含完整回合和逐项检查。凭据仅在本地 credentials.json，不在报告中。

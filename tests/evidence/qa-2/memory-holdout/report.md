# WeftMate 场景评测

时间：2026-10-09T14:11:13.758Z · 模型：mimo · 宿主：http://127.0.0.1:53864

| 场景 | 分类 | 结果 | 耗时 | 原因 | 最终回复摘要 |
|---|---|---|---|---|---|
| memory-1x-correction · 留出：浇水量省略主题纠正 | memory | 失败 | 11.99s | reply_contains did not match expected value; memory_used did not match expected value; holdout must adopt its own current formal memory | 按你定下的固定用量，今天浇水给每盆 300 毫升即可。 |
| memory-1x-person · 留出：课程师生关系跨对话联系 | memory | 失败 | 13.30s | memory_used did not match expected value; holdout must adopt its own current formal memory | 给闻舟的消息，一句自然的：  &gt; 闻舟老师，最近怎么样？上次练完拉坯手还有点酸，但感觉找到点门道了，想着跟你打个招呼，这周有空还想再去练练。  如果想更短一点：  &gt; 闻舟，好久没去练坯了，怪想念转盘的，你最近什么时候方便？  需要的话我可以帮你直接发出去——告诉我用哪个聊天渠道就行。 |
| memory-1x-preference · 留出：音乐选择偏好跨对话采用 | memory | 失败 | 12.87s | memory_used did not match expected value; holdout must adopt its own current formal memory | 推荐一首：**坂本龙一 —《Aqua》**（选自专辑《 Kevin Carter / New York Monitor》… 实际最易找到的版本在《1996》专辑）。  纯器乐，钢琴为主，节奏缓慢、音色清澈，像水波一样一层层展开，没有起伏强烈的段落，非常适合放空或睡前听。  如果想换换口味，也可以试试这两首纯器乐备选：  - **Ludovico Einaudi —《Nuvole Bianche》**：钢琴独奏，温柔绵长 - **Ólafur Arnalds —《Saman》**：钢琴加弦乐，安静带一点暖意  需要更多同类的纯器乐推荐随时说。 |

检查明细：

- **memory-1x-correction**：M2e留出场景；园艺数量领域；三个独立会话。基线严格检查当前纠正项采用、旧项失效且排除、双方原话来源保留及未声明审批。
  - turn_status（第 1 轮）：通过
  - turn_status（第 2 轮）：通过
  - reply_contains：失败 — reply_contains did not match expected value
  - turn_status：通过
  - memory_used：失败 — memory_used did not match expected value
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.
- **memory-1x-person**：M2e留出场景；陶艺师生关系领域。新会话只提姓名；基线另核对采用的正式关系、当前状态、完整原话来源、独立会话及未声明审批。
  - turn_status（第 1 轮）：通过
  - reply_contains：通过
  - reply_matches：通过
  - turn_status：通过
  - memory_used：失败 — memory_used did not match expected value
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.
- **memory-1x-preference**：M2e留出场景；音乐领域与形成提示示例、原memory-01..04无关。基线另查采用项的当前状态、精确原话来源、独立会话及未声明审批。
  - turn_status（第 1 轮）：通过
  - reply_matches：通过
  - turn_status：通过
  - memory_used：失败 — memory_used did not match expected value
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.

通过 0 · 失败 3 · 需人工 0 · 不支持 0 · 跳过检查 3

可判定场景通过率：0/3 = 0.0%。
全部场景通过覆盖率：0/3 = 0.0%。需人工、不支持不算通过。

文件场景目录保留在系统临时目录供复查；JSON 含完整回合和逐项检查。凭据仅在本地 credentials.json，不在报告中。

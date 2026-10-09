# WeftMate 场景评测

时间：2026-10-09T14:13:32.718Z · 模型：mimo · 宿主：http://127.0.0.1:61981

| 场景 | 分类 | 结果 | 耗时 | 原因 | 最终回复摘要 |
|---|---|---|---|---|---|
| memory-01-preference · 新对话采用表达偏好 | memory | 失败 | 27.42s | memory_used did not match expected value | **先讲个买菜的例子**  你家离超市有三公里，每天做饭都要去买菜。跑一趟超市要半小时，太累了。于是你想了个办法：每次去超市顺便多买一点，把菜存在冰箱里。想做饭了，先开冰箱看一眼——有现成的，两分钟搞定；冰箱里没有，再跑超市。  这个"冰箱"就是缓存。  它的本质就一句话：**在手边放一份常用东西的副本，省得每次都跑远路。**  **再讲原理**  计算机里各级存储的速度差得非常离谱，大致是这样：  \| 地方 \| 比喻 \| 速度 \| \|---\|---\|---\| \| CPU 缓存 \| 你手边的菜篮 \| 最快 \| \| 内存 \| 家里的冰箱 \| 快 \| \| 硬盘 \| 楼下的储藏室 \| 慢一万倍 \| \| 网络/服务器 \| 三公里外的超市 \| 慢百万倍 \|  数据放在越远的地方越便宜、空间越大，但取回来越慢。缓存就是在这中间插一层"小而快"的地方：**把最近用过或经常用的数据复制一份放进去**。  工作流程永远是两步：  1. 要数据了，先问缓存：有吗？ 2. 有 → 直接用（**命中**）；没有 → 去慢的地方取，顺手复制一份存进缓存（**未命中**），下次就快了。  **缓存带来的两个老问题 |
| memory-02-correction · 纠正后按新理解走 | memory | 通过 | 28.70s |  | 放周五晚上最合适（你已改掉周三）。已为你建立提醒：2026年10月16日（周五）晚上 19:00（Asia/Shanghai）提醒你锻炼一次，仅此一次，不重复。 |
| memory-04-person · 之后提到某人能联系上 | memory | 失败 | 31.43s | memory_used did not match expected value | 给你一句轻松自然的开场白：  **"阿岚，周六见之前先跟你同步一下～海报那边你进展到哪步啦？我这边也把展览的一些想法整理了整理，到时候咱们碰一下，看怎么配合更顺。"**  如果想更简短随意一点，也可以直接：  **"阿岚，周六聊展览呀～海报有啥新想法先给我剧透两句？"**  需要更正式或者更活泼的版本，跟我说一声就行。 |

检查明细：

- **memory-01-preference**：需要第一轮形成并可注入测试账号记忆。新会话不复制偏好；回复匹配只是行为证据，memory_used 单独 unsupported。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；600秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限180秒。
  - turn_status（第 1 轮）：通过
  - reply_matches：通过
  - turn_status：通过
  - memory_used：失败 — memory_used did not match expected value
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.
- **memory-02-correction**：测试从日常纠正形成理解，使用三轮对话而非直接编辑底层记忆。等待 1 秒只是形成窗口，基线失败可能反映记忆形成/调度未接通。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；900秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限180秒。
  - turn_status（第 1 轮）：通过
  - turn_status（第 2 轮）：通过
  - reply_contains：通过
  - turn_status：通过
  - memory_used：通过
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.
- **memory-04-person**：新会话只提名字，不复制原背景；独立测试账号，不接触本人联系人。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；600秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限180秒。
  - turn_status（第 1 轮）：通过
  - reply_contains：通过
  - reply_matches：通过
  - turn_status：通过
  - memory_used：失败 — memory_used did not match expected value
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.

通过 1 · 失败 2 · 需人工 0 · 不支持 0 · 跳过检查 3

可判定场景通过率：1/3 = 33.3%。
全部场景通过覆盖率：1/3 = 33.3%。需人工、不支持不算通过。

文件场景目录保留在系统临时目录供复查；JSON 含完整回合和逐项检查。凭据仅在本地 credentials.json，不在报告中。

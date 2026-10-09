# WeftMate 场景评测

时间：2026-10-09T14:24:15.650Z · 模型：mimo · 宿主：http://127.0.0.1:49407

| 场景 | 分类 | 结果 | 耗时 | 原因 | 最终回复摘要 |
|---|---|---|---|---|---|
| action-04-research-script · 查资料写脚本并实际运行 | action | 通过 | 70.99s |  | &lt;tool_call&gt;&lt;function=load_tools&gt;&lt;parameter(names&gt;["read", "write", "pwsh", "web_fetch", "browser"]&lt;/parameter&gt;&lt;/function&gt;&lt;/tool_call&gt; 脚本已写好并实际跑通：`[local path] Node.js 内置的 `node:fs` 的 `readFileSync` + `writeFileSync`，没有安装任何包；每次运行都会重读 `sales.csv` 覆盖写出 `[local path] CSV 直接重跑即可。  **算出来**（已核对 result.json）：茶 小计 25、咖啡 小计 24，**合计 49**。  **参考资料**：Node.js 官方教程 [Reading files with Node.js](https://nodejs.org/learn/manipulating-files/reading-files-with-nodejs)（介绍了 `fs.readFile` / `fs.readFileSync` / `fsProm |

检查明细：

- **action-04-research-script**：需要联网和宿主 Node；输出数字字符串检查配合回复检查，实际脚本可在 Windows 复查。本地 Qwen 27B 首轮 300 秒到期时仍在网页读取和命令执行，调整为 600 秒；修复 web_fetch 提供方后重跑。 M0-7b 时限校准：本地27B实测生成约6–13 tokens/s（每秒令牌数），首轮约8.5K提示预填充曾为79 tokens/s；900秒为场景全部回合共用预算，覆盖预填充、推理、工具与后台单槽等待。原目标、检查及审批决定保持；原时限600秒。
  - file_exists：通过
  - file_contains：通过
  - file_contains：通过
  - file_contains：通过
  - reply_contains：通过
  - reply_matches：通过
  - turn_status：通过
  - llm_judge：跳过 — No judge configured; enable --judge-model same or a configured model name.

通过 1 · 失败 0 · 需人工 0 · 不支持 0 · 跳过检查 1

可判定场景通过率：1/1 = 100.0%。
全部场景通过覆盖率：1/1 = 100.0%。需人工、不支持不算通过。

文件场景目录保留在系统临时目录供复查；JSON 含完整回合和逐项检查。凭据仅在本地 credentials.json，不在报告中。

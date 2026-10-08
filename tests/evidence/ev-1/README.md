# EV-1 数值检查与脚本审批

2026-10-09，Windows-4。数值变化用 M1-4 保存的两轮 LAN（局域网）原始产物离线重判；真实回归使用 MiMo `mimo-v2.6-flash`、真实 Electron（桌面程序框架）与固定 DSH（执行框架），每批独立合成账号、隔离 MemoWeft Core（记忆核心）、系统临时目录与随机端口。原 action-01..06 的目标、预算、检查和审批决定均保持。没有使用本人日用数据，也没有重跑 LAN 模型。

`file_contains`（文件文本包含检查）的默认 `.includes()` 语义保持。仅显式 `numeric: true` 才比较完整十进制数值：规范化全角数字及标点、Unicode（统一字符编码）负号、合法三位千分位逗号或水平空格分组，并以字符串规范值核对，避免大整数浮点舍入。正负号、非零小数位、数字边界和非法分组仍参与判定；不跨换行拼接数字，不增加容差或依赖模型语义评判。例如 `24,300`、`２４,３００`、`24 300` 等于 `24300`，`243000`、`-24300`、`24300.01` 均不等于 `24300`。

本包只在 `eval/scenarios/action-07-long-directory.yaml` 加了以下 50 个字段，逐字段索引见 [numeric-fields.json](numeric-fields.json)。原有检查词、目标、预算、审批和标识检查都没有改变。

| 文件检查 | 保留的 text | 新增字段 | 数量 |
|---|---|---|---:|
| `reviews/review-01.md` 至 `reviews/review-24.md` 的金额 | `1001` 至 `1024`，逐批对应 | `numeric: true` | 24 |
| 上述每份报告的差额 | `100` | `numeric: true` | 24 |
| `summary.md` 的合计 / 差额 | `24300` / `2400` | `numeric: true` | 2 |

这些字段检查的是相同数值的不同排版，并未接受不同金额。完整数值比较还避免默认子串检查把 `243000` 当成 `24300`。`B01..B24` 和 `EX-01-MISMATCH..EX-24-MISMATCH` 等标识继续按原文本比较。action-01..06 和记忆场景没有加数值选项。

| M1-4 保存产物 | 旧规则重判 | 新规则重判 | 变化 |
|---|---|---|---|
| LAN 第 1 轮 | 失败，98/100 | 通过，100/100 | 仅 summary.md 的 24300 / 2400 |
| LAN 第 2 轮 | 失败，98/100 | 通过，100/100 | 仅 summary.md 的 24300 / 2400 |

[offline-recheck.json](offline-recheck.json) 保存全部 25 份输出的 SHA-256（内容摘要）。重判前后哈希一致，24 份源文件与原场景夹具逐字一致；旧规则逐项复现保存报告。模型请求为 0，原来的模型执行、未验收的后台收取与主会话压缩边界保持，文件检查通过不能代替这些验收。原失败判定没有被覆盖。

审批根因已从 M1-4 保存的 `sum.mjs` 复现，见 [approval-replay.json](approval-replay.json)：同一命令旧规则得到 `overwrite`（覆盖文件），新规则无风险。需纠正任务描述中的一个细节：这份原脚本除了控制台输出，也调用 `writeFileSync` 写入尚不存在的 `result.json`。策略本来会读取脚本源码；`process.argv[3] ? resolve(process.argv[3]) : join(here, 'result.json')` 无法静态解析，使新文件被当成未知覆盖目标。修复是给已有 `personal-write-targets.mjs` 辅助模块增加字面启动参数的条件分支解析，未修改审批模式或跳过脚本检查。它是审批策略直接调用的路径解析器，属于本包必要的最小辅助文件改动。

单测覆盖只读 JS / PowerShell 脚本、新输出文件、明确参数与默认参数分支，以及已有用户文件、未知 shell（命令解释器）参数、argv[0]、脚本内部删除、`>` 重定向、`Set-Content` / `Out-File`、`Move-Item` / `mv` 覆盖和 `Remove-Item` / `rm`。真正覆盖与删除继续触发审批，已有的本对话创建文件规则保持；D12 五种模式未改。

本地定向测试 53/53：评测器及风险策略 22/22，原生审批桥及工具审批 31/31；`npm run typecheck` 通过。完整测试交 CI（持续集成）。

离线复判命令：

```powershell
node tests/integration/personal-checks-offline.mjs tests/evidence/ev-1/offline-recheck.json <M1-4保存LAN根1> <M1-4保存LAN根2>
node --test tests/eval-runner.test.ts tests/personal-approval-modes.test.ts
node --test tests/personal-tool-approvals.test.ts tests/personal-approval-bridge.test.ts
npm run typecheck
```

真实模型命令（两个独立隔离宿主；不启用可选模型评判）：

```powershell
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --only action-01-organize,action-02-web-document,action-03-read-code,action-04-research-script,action-05-stop-resume,action-06-delete-approval
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --only action-04-research-script,action-06-delete-approval
```

| 场景 | 原六场景批次 | 独立额外复跑 |
|---|---|---|
| action-01-organize | 通过，48.24 秒 | — |
| action-02-web-document | **失败，452.94 秒：未声明审批** | — |
| action-03-read-code | 通过，75.33 秒 | — |
| action-04-research-script | **通过，83.06 秒** | **通过，100.60 秒** |
| action-05-stop-resume | 通过，415.20 秒 | — |
| action-06-delete-approval | **通过，333.42 秒** | **通过，419.37 秒** |

原六场景 **5/6**，专项 **2/2**；action-04 与 action-06 各 **2/2**。两次 action-04 均无原生审批，两次 action-06 均观察到原生 `delete`（删除）风险、`allowed-once`（允许一次）和 `rejected`（拒绝），并通过拒绝后的文件保留检查。完整数值/脚本修复不能据此宣称全部自主办事场景通过。原六场景只有 action-03 / action-04 的可选评判被跳过；额外批次只有 action-04 被跳过，没有启用或改动 M2f 新增的语义评判。

失败的 action-02 先联网获取资料，后尝试用 PowerShell（命令解释器）的动态变量 `$p=Join-Path $dir ...` 与 `[IO.File]::WriteAllText($p,...)` 下载发布说明。现有策略无法静态确认此目标，仍按未知写入要求 overwrite 审批；场景未声明该审批，评测器保留待审批并取消。没有放行、改检查或再跑该场景以覆盖失败。这是剩余的动态目标解析边界，与本包修复的 Node argv 条件分支不同。[mimo-regression.json](mimo-regression.json) / [mimo-repeat.json](mimo-repeat.json) 保留所有检查、逐轮状态与原生审批类别/决定；[original-scenarios.json](original-scenarios.json) 证明原六场景内容与运行基线一致。

| MiMo 批次 | 请求 / 有用量 / 无用量 | 输入令牌 | 缓存输入令牌 | 输出令牌 | 已知估算人民币 |
|---|---:|---:|---:|---:|---:|
| 原六场景，含失败 | 44 / 40 / 4 | 424,479 | 305,152 | 8,436 | ¥0.14230204 |
| action-04 / action-06 额外复跑 | 18 / 16 / 2 | 239,661 | 124,032 | 4,367 | ¥0.12684364 |
| 合计 | 62 / 56 / 6 | 664,140 | 429,184 | 12,803 | **¥0.26914568 下界** |

按运行当日核对的 [MiMo 官方价格](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)，缓存输入 ¥0.02、未缓存输入 ¥1、输出 ¥2 / 百万 token（令牌）计算。用量来自实际 MiMo 上游请求，避免重复计算本机转发；包括后台调用、中断和失败场景。六笔中断请求无用量，未观察到 HTTP 429（请求限流）。这是已知用量费用下界，不是账户账单；离线 LAN 重判费用为 0。

两批模型运行从 `1f29811` 加 EV-1 实现启动；完成过程中快进合入 `origin/main` 的 `ee74c0d`（M1-4）。合并后最终数值/风险测试 22/22 与类型检查通过，未追加真实模型批次。原生审批桥/工具审批此前 31/31 通过。完整 CI 门禁见本包 PR（拉取请求）的最新提交检查，不用 CI 绿色替代原六场景的 5/6。

隔离根共扫描 488 个实际文件，凭据命中 0；共享依赖链接各 510 个未遍历，避免扫描别的工作树。两个隔离运行的 Node / Electron / Python 进程残留为 0。原始日志、合成账号目录、完整脚本与模型输出留在仓库外，不复制凭据、Cookie（会话凭据）、账号/会话标识、用户目录或私有 LAN 地址。公开产物另行扫描，汇总见 [verification.json](verification.json)。客户端契约、界面和记忆实现未改。


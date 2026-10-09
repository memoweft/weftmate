# FX-13 · 脚本覆盖审批与停止延迟

本包使用合成账号、系统临时目录和随机端口。MiMo 密钥仅在进程内读取；不访问本人日用宿主、8081 或日用数据。

## QA2-03 根因与修复

QA（质量验收）首轮原脚本见 [qa2-original-sum.mjs](before-approval/qa2-original-sum.mjs)，原失败回执见 [qa2-original-result.json](before-approval/qa2-original-result.json)。`sum.mjs` 通过 `dirname(fileURLToPath(import.meta.url))` 确定输入 / 输出目录。`Set-Location C:\` 不会令它写入 `C:\result.json`。

实际遗漏在文件观察：第一次运行脚本创建用户指定合成目录内的 `result.json`，该目录在会话目录外，且命令没有显式 `workdir（工作目录）`。旧观察器只扫描会话目录、workdir 和文件工具参数，漏记输出创建来源。再次运行时，风险分类器看到一个没有本对话创建来源的已有文件，产生覆盖审批。合成重放的[改前](before-approval/reproduction.json) / [改后](after-approval/reproduction.json)保留原数据；输出均为茶 25、咖啡 24、合计 49，另一目录无新增文件。

修复复用现有静态路径解析，观察脚本中可以确定的 Node.js（JavaScript 运行时）输出文件。只读源码，在执行前确定输出目标并比较同一组文件的实际变化，新增来源仍随原生工具结果持久保存。本对话新建输出可重跑；已有用户文件、未知输出、其他会话创建的文件继续按 D12 审批。风险分类与观察共用 shell（命令解释器）的逐条工作目录记录，区分固定脚本目录与相对运行目录；同一脚本多次在不同目录执行会分别检查。

真实 Electron（桌面程序框架）/ DSH（助手运行时）重放截图位于 `before-approval/electron/` 与 `after-approval/electron/`。改前观察器使用当前分支起点的原始文件，测试入口仅为这一合成批次选择旧观察器，不修改审批模式。外部工作目录已有文件的相对输出场景拒绝覆盖并核对原内容保留。

合入最新主干后的原 `action-04-research-script` 在三个全新账号分别以 MiMo 执行，**3/3 通过，74.731、108.168、45.068 秒，额外审批 0**；文件 / 回复 / completed（已完成）七项原判据均通过，原可选 LLM judge（模型判分）未配置并保持 skipped（跳过），没有把它算成已判分。结果、工具详情、实际脚本、成果与选中真实对话的浅 / 深截图位于 `mimo/run-1..3/`。本包全部 MiMo 用量见 [usage.json](usage.json)：**64 个实际推理请求、64 笔完整用量、缺用量 0；输入 591278、缓存 426752、输出 16695 token（词元）**，不是账户账单。用量仅汇总直接向 MiMo 的上游请求，避免内部代理重复计数；缺用量不当作免费。

## QA2-05 方法与边界

原 QA2 压力数据与第 60 轮截图保留在 [before-desktop](before-desktop/)。原运行器每轮重写越来越大的请求数组，且有其他验收同时执行，不能直接将 p95（第95百分位）3.364 秒定为产品回归。

修正后的运行器把每条请求追加到 JSONL（逐行 JSON），`results.json` 仅含小规模逐轮结果与监测摘要。保持真实程序、完整单槽 `/switch/status` + `/props` 状态、17.5 秒流式输出、新建 / 发送 / 每三轮停止、原 12 秒失败门槛、30 分钟持续负载。MiMo 与定向测试均安排在有效压力批次结束后；不修改停止控制、轮询间隔或会话列表逻辑。

完整批次（含 UX-1 的 `6b0edc47` 基线）持续 **1813.456 秒，68/68 轮通过**。发送至停止可见且启用：中位 **1381 毫秒**、p95 **1936 毫秒**、最大 **4291 毫秒**；超过 2 秒 **2 轮**（第 62 轮 2965 毫秒、第 64 轮 4291 毫秒），原 12 秒超时 0。p95 达到 2 秒目标，未改停止生产路径。保留长尾，不声称全部轮次都在两秒内。

| 指标 | QA2 原压力批次 | 修正运行器后的完整独立批次 |
|---|---:|---:|
| 轮次 | 64/64 | 68/68 |
| 中位 | 1355 毫秒 | 1381 毫秒 |
| p95 | 3364 毫秒 | 1936 毫秒 |
| 最大 | 4313 毫秒 | 4291 毫秒 |
| 超过 2 秒 | 24 轮 | 2 轮 |

合入最新主干 `122fe00e`（IA-2a / PF-2）后的[短时兼容复核](merged-smoke-summary.json)为 148.421 秒、5/5 轮通过、p95 / 最大 901 毫秒，独立执行；此批不替代 30 分钟验收。合并提交 `47694578` 保留 PF-2 网页缓存过滤与 FX-13 脚本输出观察。

[有效完整批次](clean-v2-desktop/results.json)与[汇总](stability-summary.json)给出全量逐轮延迟；失败不删除，超过 2 秒的轮次另计。计时从真实发送点击前开始，到停止按钮可见且启用，包含新建会话和检测开销。沿用的写盘挂钩没有同步 Node 内置模块的 ES module（标准模块）导出，写盘零值无效，不用于结论。

首次旧运行器登录流程在重载后显示登录页，未进入有效测量，保留在 `clean-baseline-desktop/` 与 `clean-run-desktop/`；无失败轮被纳入有效批次或伪造成 0 毫秒。

## 验证与复跑

本地仅跑本包相关单测与类型检查；完整现有测试交 CI（持续集成）。原始结果与公开扫描、进程清理记录同目录保存。合入主干前后定向单测均 **65/65**，类型检查均通过；新回归 4 项。旧项目证明测试的临时插件漏解析 `personal-project-context.mjs`，只补依赖位置、不改判据；新 Bash 用例修正 Windows 路径拼写后原碰撞断言通过。首轮 60/65 的失败原因保留在 [verification.json](verification.json)。

合并前原题三次均通过（55.685、67.143、64.174 秒），额外审批 0，证据在 `pre-merge-mimo/`；合并后的最终原题另存 `mimo/`。最初三个账户命名不符合评测器的 `eval-` 要求，未进入原题、模型推理请求 0，保留在 `mimo-setup-failure/`。真实改后重放曾在启动阶段中断，无场景结果；清理遗留进程后独立复跑通过，见 [启动重试](replay-launch-retry.json)。所有失败与补测均保留。

- `node tests/evidence/fx-13/runners/desktop.mjs`：完整 30 分钟独立压力批次；如改期望输出目录，用 `FX13_PHASE`，只用于试跑的缩短时长用 `FX13_STRESS_MS`，缩短批次不能代替验收。
- `node tests/evidence/fx-13/runners/replay-electron.mjs --before` / 不带 `--before`：真实审批前后重放。
- `node tests/evidence/fx-13/runners/mimo.mjs`：三个新账号的原题；从 Machine 环境变量取密钥，不请求本地模型。
- `node --test tests/personal-script-output-provenance.test.ts tests/personal-approval-modes.test.ts tests/personal-dynamic-write-targets.test.ts tests/personal-native-files.test.ts tests/personal-project-tool-proof.test.ts`。
- `npm run typecheck`；推送前合 `origin/main`，PR（拉取请求）检查全绿后交接。

未更改审批契约、权限模式、用户数据或其他并行包的产品范围。LAN（局域网模型服务）未使用，无占用锁或模拟器。

4c 最终审计见 [cleanup.json](cleanup.json)：按 PID（进程标识符）强制清理 11 个（首次压力尝试 6 个、一次中断的重放启动 5 个），其余正常退出；本包最终残留 0。未启动模拟器，未使用 LAN。公开扫描 [public-scan.json](public-scan.json) 为 108 文件，实际密钥 / 私有 LAN 目的地 / 凭据文件 / 本机主目录命中均 0。

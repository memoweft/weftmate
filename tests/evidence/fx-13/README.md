# FX-13 · 脚本覆盖审批与停止延迟

本包使用合成账号、系统临时目录和随机端口。MiMo 密钥仅在进程内读取；不访问本人日用宿主、8081 或日用数据。

## QA2-03 根因与修复

QA（质量验收）首轮原脚本见 [qa2-original-sum.mjs](before-approval/qa2-original-sum.mjs)，原失败回执见 [qa2-original-result.json](before-approval/qa2-original-result.json)。`sum.mjs` 通过 `dirname(fileURLToPath(import.meta.url))` 确定输入 / 输出目录。`Set-Location C:\` 不会令它写入 `C:\result.json`。

实际遗漏在文件观察：第一次运行脚本创建用户指定合成目录内的 `result.json`，该目录在会话目录外，且命令没有显式 `workdir（工作目录）`。旧观察器只扫描会话目录、workdir 和文件工具参数，漏记输出创建来源。再次运行时，风险分类器看到一个没有本对话创建来源的已有文件，产生覆盖审批。合成重放的[改前](before-approval/reproduction.json) / [改后](after-approval/reproduction.json)保留原数据；输出均为茶 25、咖啡 24、合计 49，另一目录无新增文件。

修复复用现有静态路径解析，观察脚本中可以确定的 Node.js（JavaScript 运行时）输出文件。只读源码，在执行前确定输出目标并比较同一组文件的实际变化，新增来源仍随原生工具结果持久保存。本对话新建输出可重跑；已有用户文件、未知输出、其他会话创建的文件继续按 D12 审批。风险分类与观察共用 shell（命令解释器）的逐条工作目录记录，区分固定脚本目录与相对运行目录；同一脚本多次在不同目录执行会分别检查。

真实 Electron（桌面程序框架）/ DSH（助手运行时）重放截图位于 `before-approval/electron/` 与 `after-approval/electron/`。改前观察器使用当前分支起点的原始文件，测试入口仅为这一合成批次选择旧观察器，不修改审批模式。外部工作目录已有文件的相对输出场景拒绝覆盖并核对原内容保留。

原 `action-04-research-script` 在三个全新账号分别以 MiMo 执行，结果、工具详情、实际脚本、成果与选中真实对话的浅 / 深截图位于 `mimo/run-1..3/`。用量仅汇总直接向 MiMo 的上游请求，避免内部代理重复计数；缺用量不当作免费。

## QA2-05 方法与边界

原 QA2 压力数据与第 60 轮截图保留在 [before-desktop](before-desktop/)。原运行器每轮重写越来越大的请求数组，且有其他验收同时执行，不能直接将 p95（第95百分位）3.364 秒定为产品回归。

修正后的运行器把每条请求追加到 JSONL（逐行 JSON），`results.json` 仅含小规模逐轮结果与监测摘要。保持真实程序、完整单槽 `/switch/status` + `/props` 状态、17.5 秒流式输出、新建 / 发送 / 每三轮停止、原 12 秒失败门槛、30 分钟持续负载。MiMo 与定向测试均安排在有效压力批次结束后；不修改停止控制、轮询间隔或会话列表逻辑。

[有效完整批次](clean-v2-desktop/results.json)与[汇总](stability-summary.json)给出全量逐轮延迟；失败不删除，超过 2 秒的轮次另计。计时从真实发送点击前开始，到停止按钮可见且启用，包含新建会话和检测开销。沿用的写盘挂钩没有同步 Node 内置模块的 ES module（标准模块）导出，写盘零值无效，不用于结论。

首次旧运行器登录流程在重载后显示登录页，未进入有效测量，保留在 `clean-baseline-desktop/` 与 `clean-run-desktop/`；无失败轮被纳入有效批次或伪造成 0 毫秒。

## 验证与复跑

本地仅跑本包相关单测与类型检查；完整现有测试交 CI（持续集成）。原始结果与公开扫描、进程清理记录同目录保存。

- `node tests/evidence/fx-13/runners/desktop.mjs`：完整 30 分钟独立压力批次；如改期望输出目录，用 `FX13_PHASE`，只用于试跑的缩短时长用 `FX13_STRESS_MS`，缩短批次不能代替验收。
- `node tests/evidence/fx-13/runners/replay-electron.mjs --before` / 不带 `--before`：真实审批前后重放。
- `node tests/evidence/fx-13/runners/mimo.mjs`：三个新账号的原题；从 Machine 环境变量取密钥，不请求本地模型。
- `node --test tests/personal-script-output-provenance.test.ts tests/personal-approval-modes.test.ts tests/personal-dynamic-write-targets.test.ts tests/personal-native-files.test.ts tests/personal-project-tool-proof.test.ts`。
- `npm run typecheck`；推送前合 `origin/main`，PR（拉取请求）检查全绿后交接。

未更改审批契约、权限模式、用户数据或其他并行包的产品范围。LAN（局域网模型服务）未使用，无占用锁或模拟器。

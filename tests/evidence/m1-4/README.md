# M1-4 后台委派结果收取

2026-10-08，真实 Electron（桌面程序框架）与固定 DSH（执行框架），使用合成账号、随机端口和隔离临时目录。原 action-07 的目标、5,400 秒预算、98,304 LAN（局域网模型服务）上下文配置、文件检查和审批决定均保持。LAN 两轮串行，整批持有编排器占用锁，仅使用 `local-quality`；不切换或重配模型服务。

## 原生机制与改动

DSH `dsh-tool-jobs` 已提供作业完成通知、`job_output(wait: true)` 阻塞收取，以及收取后的 `reported` 状态。未收取作业完成时发送一次原生 notice（通知）；主会话运行中注入下一步，空闲时可用原生 wakeup（唤醒）开启收取回合。正在阻塞收取的调用会抑制多余完成通知。完成通知只有状态和收取提醒，不包含作业结果。

原 `continuable`（可续接）子任务返回 `subagentId`，自动注入最终结果，不使用 `job_output`。个人执行预设现改接原生 `one-shot`（单次作业）：同步调用直接返回结果，显式 `run_in_background: true` 返回 `jobId`，通过 `job_output` 收取；完成通知使用 `completionDelivery: wakeup`。这种委派不保留为可继续发送后续回合的活动子任务。已知旧预设可自动升级，用户自行修改的预设仍保持原有冲突处理。

保留 DSH 原生子任务工具描述和参数说明，去掉旧的简略描述覆盖。通用系统指引要求记录作业标识与负责范围，只继续独立工作，不重做委派范围；依赖结果时阻塞收取，检查终态、部分结果和现有文件后更新待办、汇总。指引不含场景名称、批次号或检查文本。没有新增白名单、限次、审计层或审批例外，记忆插件和界面未改。

## 原 action-07 结果

| 运行 | 原检查 / 用时 | 委派与结果收取 | 报告重复写入 | 成功压缩：主 / 子 | goal（目标）/ todo（待办） |
|---|---|---|---|---|---|
| LAN 第 1 次 | **失败 / 781.46 秒** | 同步子任务，结果已返回，随后写汇总；无 `job_output`，因为未选择后台作业 | 0 | 0 / 1 | complete / 全部 completed |
| LAN 第 2 次 | **失败 / 769.25 秒** | 同步子任务，结果已返回，随后写汇总；无 `job_output`，因为未选择后台作业 | 0 | 0 / 1 | complete / 全部 completed |
| MiMo `mimo-v2.6-flash` | **通过 / 488.91 秒** | 未委派，模型自行处理 | 0 | 0 / 0 | complete / 全部 completed |

两轮 LAN 全部 24 份分报告通过内容检查，各自 24 份源文件原样保留；汇总均使用 `24,300` 和 `2,400`，与预期金额语义一致，但原 `file_contains`（文件文本包含检查）要求连续文本 `24300` 和 `2400`，各两项失败，均为 98/100 项检查通过。保留原失败，不改文件、不放宽检查、不替换为通过记录。模型将目标标为完成不能代替评测通过。

第 1 轮主会话完成第 1–3 批后同步委派后续范围，子任务写第 4–24 批；第 2 轮主会话完成第 1–4 批后同步委派第 5–24 批。两轮均在工具结果返回后才写汇总，没有重现 M1-3 的后台委派后重复写报告及覆盖审批。实际模型选择了同步路径，**不能据此宣称真实 LAN 后台 `job_output` 路径已验收**；该路径与一次未收取提醒由下述固定 DSH 确定性测试验证。两轮主会话都未压缩，主会话跨压缩目标/待办保留未验证，子会话压缩不替代该验收。

结构化原结果见 [lan-1.json](lan-1.json)、[lan-2.json](lan-2.json)、[mimo-long.json](mimo-long.json)。记录仅含检查、计数、已知合成报告路径、状态和用量，不含模型地址、密钥、完整回复或账户/会话标识。报告重复写入统计来自原生 `write/edit` 调用；它不声称观察任意 shell（命令解释器）内部写入。

## MiMo action-01..06 回归

| 场景 | 结果 | 用时 |
|---|---|---:|
| action-01-organize | 通过 | 31.02 秒 |
| action-02-web-document | 通过 | 123.35 秒 |
| action-03-read-code | 通过 | 37.30 秒 |
| action-04-research-script | **失败：未声明审批** | 66.42 秒 |
| action-05-stop-resume | 通过 | 96.06 秒 |
| action-06-delete-approval | 通过 | 49.54 秒 |

共 **5/6**。action-04 已创建合成 `sum.mjs`，调用 `pwsh` 执行脚本时触发现有 `overwrite`（覆盖文件）审批；场景没有匹配决定，评测器保留 pending（待审批）并取消。未委派，未改审批策略或场景。详见 [mimo-regression.json](mimo-regression.json)。

## 用量与验证

| MiMo 批次 | 请求 | 返回用量 | 输入令牌 | 缓存输入令牌 | 输出令牌 | 已知估算费用 |
|---|---:|---:|---:|---:|---:|---:|
| 长任务 | 60 | 60 | 5,729,953 | 5,550,528 | 14,005 | ¥0.31844556 |
| 六项回归，含失败 | 42 | 38 | 518,827 | 426,112 | 8,923 | ¥0.11908324 |
| 合计 | 102 | 98 | 6,248,780 | 5,976,640 | 22,928 | **¥0.43752880 下界** |

回归有三笔 HTTP 429（请求限流）响应和一笔停止测试中断请求未返回用量。按 [MiMo 官方价格](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash) 缓存输入 ¥0.02、未缓存输入 ¥1、输出 ¥2 / 百万 token（令牌）计算，推理已包含在输出；这是已知用量估算下界，不是账户账单。LAN 没有已知云 API（应用接口）计费，电费未测。

本地相关测试 **21/21**，LAN 转发桥 **3/3**，`npm run typecheck` 通过。新用例使用固定 DSH 作业注册表与工具层，仅子任务生产者为合成夹具，验证委派→阻塞收取→汇总、运行中未收取提醒一次、空闲唤醒一次、原生工具描述保留。两条既有原生压缩集成测试仍验证阈值压力与输出预留恢复后目标、完整待办保留并继续完成。

额外运行的旧 `personal-remote-tool-scope.test.ts` 有一项失败：其组装夹具缺少 `sections`，报 `assembly.sections is not iterable`。使用未修改的基线预设重跑也复现同一失败，本包没有修权限逻辑或新增 CI（持续集成）例外。新原生测试在缺少固定编译依赖的干净 CI 环境明确跳过；本地实际运行通过，CI 不能替代真实模型验收。

测试入口最初两次在旧 `#login-name` 登录选择器上超时，场景未开始、模型请求 0。入口已接现有离线登录流程；启动失败和凭据扫描保留在 [startup-attempts.json](startup-attempts.json)。所有运行日志留在仓库外，最终公开产物另行扫描；不读取日用账号、保险库或运行数据。

```powershell
node --test tests/personal-delegation-results.test.ts tests/dsh-web-profile.test.ts tests/long-task-compaction.test.ts
node --test tests/integration/baseline-lan-model.test.mjs
npm run typecheck
# 按 parallel-rules.md 原子取得 LAN 占用锁后，串行执行两次：
node tests/integration/personal-long-task.mjs --lan --delegation-evidence
node tests/integration/personal-long-task.mjs --mimo --delegation-evidence
node tests/integration/personal-long-task.mjs --mimo --regression --delegation-evidence
```

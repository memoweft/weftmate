# BUG-2 · 早停后任务续做

QV-1 的首轮在原生输入已领取、`user.message` 尚未持久化时停止。原生回合已 `aborted`（已停止），任务控制却仍是 `cancel_requested`、`pendingReceipts=1`、`canResume=false`。定位背景见 [QV-1 第 1 条产品问题](../qv-1/README.md)。

停止执行侧已有 `agent/inbox/claimed`（原生输入领取）关联。本修复让读取侧从同一次领取的持久 `agent/inbox/spliced`（收件队列变更）纯删除记录恢复回执，同时保留 `user.message` 来源。领取与用户消息去重；取消和替换不算领取，未知身份或无关输入不会证明整个目标已停止。原生范围读取支持跨页恢复领取前的插入；内部领取证据只返回回执，不返回输入正文或 source（来源）对象。客户端接口和公开时间线结构不变。

确定性测试使用模拟时钟，修复前原生读取与历史回退两条路径均停在 `cancel_requested`，预期 `stopped` 的断言均失败。修复后首轮原生 `turn/end` 到达时立即得到 `stopStatus=stopped`、`pendingReceipts=0`、`canResume=true`，无需超时兜底。另覆盖领取后持久化、未持久化插话、无关和无效回执、下一回合隔离、取消/替换与跨页查找。

真实 Electron（桌面程序框架）合成模型用例在测试加载层暂停固定 DSH（执行框架）的领取到用户持久化边界，直到原生取消到达。它确认停止前首轮没有 `user.message` 且没有前台模型请求；精确停止把已经领取但尚未提交的原始输入通过 DSH 原生 `user/message` 和 `surfaceOp:append` 保存一次，然后执行取消。随后确认已停止、无关队列继续完成、同一个根任务的续做完成，并确认续做模型请求仍有原始目标。原本已持久化的输入不重复保存，排队目标不被提前提交。加载钩子只在显式 `--early-stop` 测试入口启用，不修改产品代码、固定依赖或日用数据。普通停止续做及 M1-0b 插话/取消/按序执行用例也通过。

```powershell
node --experimental-strip-types --test tests/personal-task-early-stop.test.ts tests/personal-source-range.test.ts tests/personal-task-stop.test.ts tests/personal-task-control.test.ts tests/personal-task-queue-steer.test.ts tests/personal-task-stop-dsh.test.ts tests/personal-task-stop-backend.test.ts
$env:WEFTMATE_SYNTHETIC_STOP_E2E='1'
node tests/integration/personal-task-stop-electron.mjs --early-stop
node tests/integration/personal-task-stop-electron.mjs
node tests/integration/personal-task-queue-steer-electron.mjs
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --only action-05-stop-resume
```

MiMo（云端对照模型）原场景通过，36.65 秒，4 项确定性检查全部通过。最终补充修复再次通过 38.29 秒。相关任务控制/来源测试 28 项通过，审批/项目来源/回复证据/合成配置 31 项通过，LAN（局域网）串行转发器 2 项和评测器 12 项通过；类型检查通过。扩展检查发现的新投影多读步骤记录已修正，只读取实际 inbox splice，原有 22,000+ 与 230,000+ 历史读取次数断言保持通过。完整测试交 [PR（合并请求）#76 的 CI（持续集成）](https://github.com/memoweft/weftmate/pull/76/checks)。

初次仅修控制状态的 LAN（局域网）同批成绩为 2/3：53.19 秒通过、600.37 秒超时、38.11 秒通过。第二轮已发出续做，但原任务尚未进入原生历史，模型只有“接着做汇总”，搜索后请求补充信息。这项产品缺口由上述原生输入保存补齐；没有代答澄清或改场景。最终代码的独立三次同批验收正在执行，初批失败保留。两批分别原子取得锁、各预热一次、结束后立即释放；原目标、600 秒预算和原检查保持：

```powershell
node tests/integration/personal-scenario-baseline.mjs --lan --only action-05-stop-resume --repeat 3
```

私有 LAN 地址和所有模型密钥只在进程中引用；复用 QV-1 的回环转发、上游错误脱敏与请求串行机制。只运行 `local-quality`，没有使用 8081、切换共享模型或启动/重启模型服务。所有宿主为独立合成账号、随机端口与临时目录；MiMo 实际 199 个隔离文件密钥扫描零命中。真实模型原始报告保留仓库外，公开证据不含地址、密钥、账号/回执标识或完整回复。

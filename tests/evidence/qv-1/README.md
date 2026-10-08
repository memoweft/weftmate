# QV-1 · 局域网本地模型完整复验

2026-10-08，真实 Electron（桌面程序框架）+ 固定 DSH（执行框架）+ MemoWeft Core（记忆核心），使用独立合成账号、随机端口与系统临时目录。WeftMate 实测基线为 `715e9b2`（含 M1-0b、M2d、S1e），Core 为已合并 M2d 的 `53f1b06`。收尾合入 `origin/main` 的 `2d8ffd8`（含 FE-1a、BUG-1、UI-3 与 FE-1b），定向测试再核对，完整门禁交本分支 CI；没有在合并后重复这 14 项真实模型场景。本包只改场景测试入口及直接辅助，没有修改产品代码或客户端契约。

模型只标记为 `lan/local-quality`。地址读 Windows User（用户）环境变量 `WEFTMATE_LAN_MODEL_BASE_URL`，密钥读 `WEFTMATE_LAN_MODEL_KEY`，仅在测试进程中引用。测试进程中的随机回环转发器持有真实地址和密钥，Electron 只接触回环转发地址和临时令牌；子进程环境清除 `WEFTMATE_*`、`MEMOWEFT_*` 与模型密钥变量。上游错误正文不转发，避免私有服务诊断进入日志。未请求其他局域网模型，未请求 8081 Qwen，未启动、停止或重启共享模型服务。

仅发送一个预热请求，耗时 0.56 秒；后续批次使用 `--lan-warmed`，不再次预热。所有批次顺序运行，转发器对前台、标题、记忆形成及元数据请求统一串行，持有槽位直到响应体结束；排队客户端取消不能提前释放当前请求的槽位。每批实测最大并发为 1。原目标、场景预算、检查和声明审批决定均保持；没有代答澄清或允许未声明审批。`memory-03` 按原 `$alternate` 流程从 LAN（局域网）换到 MiMo（云端对照模型），本批后台形成保持 LAN，不能把该项当作纯单模型测分。

## 成绩与历史对照

| 场景 | LAN（局域网） | 8081 Qwen 历史 | MiMo 历史 | 对照来源 |
|---|---|---|---|---|
| action-01-organize | 通过 / 63.00s | 通过 / 180.37s | 通过 / 99.73s | m0-7c |
| action-02-web-document | 通过 / 152.72s | 通过 / 510.84s | 通过 / 111.27s | m0-7c |
| action-03-read-code | 通过 / 63.34s | 通过 / 77.11s | 通过 / 37.43s | m0-7c |
| action-04-research-script | 通过 / 331.88s | 通过 / 379.98s | 通过 / 76.80s | m1-1d |
| action-05-stop-resume | 失败 / 600.53s | 通过 / 57.20s | 通过 / 111.11s | m0-7c |
| action-06-delete-approval | 失败 / 600.36s | 通过 / 145.53s | 通过 / 262.86s | m1-1d |
| memory-01-preference | 失败 / 162.68s | 失败 / 600.63s | 通过 / 79.09s | m2d |
| memory-02-correction | 失败 / 148.42s | 失败 / 900.66s | 通过 / 76.69s | m2d |
| memory-03-switch-model | 通过 / 72.27s | 通过 / 136.77s | 通过 / 73.81s | m2c |
| memory-04-person | 通过 / 134.87s | 通过 / 276.84s | 通过 / 107.43s | m2c |
| M2d/memory-01-preference | 通过 / 82.27s | 失败 / 600.63s | 通过 / 79.09s | m2d |
| M2d/memory-02-correction | 失败 / 900.37s | 失败 / 900.66s | 通过 / 76.69s | m2d |
| M2d/memory-correction-new-sessions | 失败 / 82.93s | 未测 / — | 通过 / 39.24s | m2d |
| m1-0b/action-05-stop-resume | 通过 / 51.86s | 失败 / 600.48s | 通过 / 111.11s | m1-0b result / m0-7c MiMo inherited |

基础十项与专项复验使用不同隔离账号，不挑最高分覆盖失败。历史列采用最近已有结果，并在来源列注明批次：办事 01/02/03/05 来自 [M0-7c](../m0-7c/README.md)，04/06 来自 [M1-1d](../m1-1d/README.md)，记忆 03/04 来自 [M2c](../m2c/README.md)，记忆 01/02 与三段对话来自 [M2d](../m2d/README.md)。M1-0b 的 Qwen 两次失败为 600.61/600.48 秒；该专项没有独立 MiMo 结果，表内 MiMo 沿用较早 action-05 的 111.11 秒通过，不能声称它是在 M1-0b 合入后重跑。不同批次的代码版本、服务竞争与模型条件不同，耗时不能单独作为模型速度比较。

基础 **6/10**：办事 **4/6**，记忆 **2/4**。含 M2d 三项与 M1-0b 独立复验，全部 **8/14**，失败 **6**。专项结果不覆盖基础失败。专项 M2d 原纠正附加断言：**failed（失败）**；三段对话的严格来源检查：**未执行（原场景已失败）**，界面来源核对：**未执行（原场景已失败）**。

可选 LLM judge（模型评判）沿用未启用状态，记为 skipped（跳过）；通过成绩代表原确定性检查通过。网页文档没有新增全文事实核验，跨端人工场景、长期稳定性及产品修复均未做。

## 失败检查与归因

- **基础/action-05-stop-resume · 600.53s**：失败检查：无已执行检查失败，场景在控制／交互等待处超时。未执行检查：file_contains（第2轮） 汇总.md、turn_status（第2轮）。产品控制状态问题：首轮 aborted（已停止）的可见终态没有变成可续做回执，第二轮未发出。
- **基础/action-06-delete-approval · 600.36s**：失败检查：无已执行检查失败，场景在控制／交互等待处超时。未执行检查：approval_seen（第2轮）、file_contains（第2轮） 还要保留.txt、turn_status（第2轮）、reply_matches（第2轮）。场景歧义／模型澄清交互：第一轮允许和删除完成；第二轮模型先询问操作，未产生预期拒绝审批。历史 MiMo/Qwen M1-1d 均能通过，但不能仅凭旧版本成绩断言纯模型能力。
- **基础/memory-01-preference · 162.68s**：失败检查：reply_matches、memory_used。未执行检查：无。模型形成行为：原偏好事实已记入 Evidence（原话证据），形成模型返回 no_change，未生成偏好认知。独立专项同目标通过，保留两次差异。
- **基础/memory-02-correction · 148.42s**：失败检查：reply_contains、memory_used。未执行检查：无。模型形成信息不足：周三原说法形成返回 no_change；周五项已形成但不带锻炼主题，新对话未召回／采用。MiMo 历史原场景通过，暂归模型形成能力，未证明 Core 召回代码缺陷。
- **memory-correction/memory-02-correction · 900.37s**：失败检查：无已执行检查失败，场景在控制／交互等待处超时。未执行检查：reply_contains、turn_status、memory_used。模型形成信息不足／召回交互：周三锻炼原话存在，形成返回 no_change；纠正只形成缺锻炼主题的周五时间项。第三轮询问日期和时间，等回答至 900 秒。旧主题没有形成，不能把缺少取代链认定为 M2d 已有链处理回归。
- **memory-correction/memory-correction-new-sessions · 82.93s**：失败检查：reply_contains。未执行检查：无。模型未按当前问题作答：三轮 completed（已完成），最后原生用户消息确为游泳问题，但回复确认了旧技术表达偏好，未答周六；memory_used 通过只证明用了那条旧表达偏好。模型回答／记忆指引交互待查，不能据此确认纯产品缺陷，严格来源与界面来源未完成。
- **M2d 原纠正附加断言**：原 memory-02 失败，原“通过并采用当前周五项”的断言保持失败，已记录并继续核对独立三段对话。

## 产品问题复现与定位（只读）

1. **早停回合已 aborted（已停止），根任务长期不可续做**。在同一基础批次先运行 action-03/04，再按原 action-05 在约 1 秒停止。可见首轮约 2.83 秒结束、没有 user.message；停止与无汇总检查通过。600.53 秒截止时还没有第二轮；随后只读控制快照仍为 canResume=false、stopStatus=cancel_requested、pendingReceipts=1、后台作业 active/unconfirmed 均 0、resumes=0、replyEvidence.turn=null。独立账号专项为 **通过 51.86s**；说明不是每次停止都失败，仍须修复前述早停／形成等待边界。

   定位：`src/personal-access/tasks.mjs` 的 `taskStopEvidence` 由 user.message 建 receiptTurns（回执到回合映射），要求对应 turn 已结束且含目标回执；`taskDetail` 只在 evidence.ready 时开放 canResume。`src/personal-access/source-history.mjs` 的 `readSourceEvents` 回退同样依赖 user.message。对照 `src/plugins/weftmate-personal-task-control.mjs` 的 `stopExactTask` 与 agent/inbox/claimed（原生输入领取）关联：它能停止尚未持久化 user.message 的已领取输入，停止证据端可能未采用同一关联。可见回合结束与根任务证据不一致是实测事实；具体修复需产品包确认。JSON 的基础首批 stopState、时间线与未执行检查提供复现证据。

除该控制状态问题外，本包没有确认新的产品缺陷。记忆形成 no_change／丢主题、删除澄清及专项来源缺口各按证据保留，不把所有失败统一归因。

## 复跑、验证与清理

完整基础集可以串行一次执行；本次实际分为两个互不重叠的基础批次，随后两个专项批次，每批采用独立账号。命令中的 `--lan-warmed` 仅用于同一顺序批次中模型已经预热的情况。

```powershell
node tests/integration/personal-scenario-baseline.mjs --lan --only action-01-organize,action-02-web-document,action-03-read-code,action-04-research-script,action-05-stop-resume,action-06-delete-approval,memory-01-preference,memory-02-correction,memory-03-switch-model,memory-04-person
node tests/integration/personal-scenario-baseline.mjs --lan --lan-warmed --memory-loop --memory-correction
node tests/integration/personal-scenario-baseline.mjs --lan --lan-warmed --only action-05-stop-resume
node --test tests/integration/baseline-lan-model.test.mjs
node --experimental-strip-types --test tests/eval-runner.test.ts
```

`--lan` 不与 `--mimo` 混用；不传 `--lan` 时原 Qwen/MiMo 行为保持。LAN（局域网）纠正专项将原纠正附加断言失败单独记下并保留非零退出状态，继续核对已经运行的独立三段对话；不放宽原断言。原始报告、日志与数据库在仓库外保留，只导出 [verification.json](verification.json) 的检查、状态、数量、时刻、形成结果标签及合成事实布尔检查。没有完整回复、账号/会话/回执标识、真实服务地址、密钥或个人信息；没有提交截图。

本地定向验证：串行／上游错误脱敏／排队取消 2/2，评测器 12/12，脚本语法与 git diff --check 通过。完整测试交 [PR（合并请求）#73 的 CI（持续集成）](https://github.com/memoweft/weftmate/pull/73/checks)，不在本地跑全量。各隔离批次退出后清除测试登录凭据，扫描统计见 verification.json；最终公开文件与私有目录另行扫描，无真实地址、密钥或个人信息命中。本包不访问日用宿主保管库，不碰日用数据。

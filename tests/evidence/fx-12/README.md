# FX-12 · 遗留停止请求收尾

基线提交：`8e3f0ed7afb95c476ec2d23b8ad0c913e5efb582`（含 HF-2 / FX-10）。全部账号与模型状态为合成夹具；使用系统临时目录、随机端口与真实 Electron（桌面程序框架）窗口。未访问本人日用程序、18186、8081 或日用数据，没有真实模型费用。

先复现四种情况：现有停止证据只查原生持久结束事件；事件缺失时不查询实际回合状态，停止请求一直未确认。最初单元复现 4/4 保持 `stop_requested / unconfirmed`，原生状态查询次数为 0。改前桌面加载基线的停止模块及全部本包改动的界面资源，不用新界面冒充旧截图。

| 合成情况 | 改前 | 改后启动核对 | 截图 |
|---|---|---|---|
| DSH（助手运行时）重启，旧回合无活动 Agent（原生执行实例） | 未确认，不能续做 | 已结束，待确认回执 0 | [前](before-runtime-restart.png) / [后](after-runtime-restart.png) |
| 回合记录缺失，原生执行实例已空闲且无待执行输入 | 未确认，不能续做 | 已结束，待确认回执 0 | [前](before-missing-turn.png) / [后](after-missing-turn.png) |
| 模型切换失败，实际回合为错误终态但旧投影无结束证据 | 未确认，不能续做 | 已结束，待确认回执 0 | [前](before-model-switch-failed.png) / [后](after-model-switch-failed.png) |
| 上游断开，结束事件缺失但实际执行实例已空闲 | 未确认，不能续做 | 已结束，待确认回执 0 | [前](before-upstream-disconnect.png) / [后](after-upstream-disconnect.png) |

实际基线窗口在这些合成场景显示「等待模型回复…」与「尚无结束记录」，并非所有任务行都直写「正在停止…」。原始截图保留这个事实；接口四项均未确认。改后任务状态行显示「已结束」，工具进展行显示「读取了 1 个文件 · 已结束」。没有给历史添加 `turn/end`，也没有把异常终止改成成功完成目标。

原始接口与计数：[before.json](before.json)、[after.json](after.json)。改前原生查询 0、停止调用 8；改后原生查询 12、停止调用 4（仅初次停止）、终态后额外重试 0。改后重复同一个明确续做请求只派发一次，原命令和回执不替换。这里验证的是合成后端派发幂等性；实际副作用未知仍拒绝续做，不能据此承诺任意模型永不重复动作。

实现直接读取现有 DSH `sessionPersistence.readFrom / list`、当前会话和原生执行实例状态。`inspect` 对冷日志可能返回内存恢复结束记录，本包用物理原生事件前缀，避免将恢复记录误当成取消证据。不存在必须由成功的原生列表核对；读取失败、同一运行时未解释的缺失、运行中或待执行输入都不能收尾。冷启动还检查可恢复的原生待执行输入。查询跨运行时切换时丢弃结果。

原生取消 / 移除沿用「已停止」；其他终态或确认已不在运行沿用「已结束」。完成核对结果持久保存一次，停止重试和定时器。`control.state` 保留既有 `stop_requested` 冻结意图，终态以 `stopStatus` 和 `canResume` 表示。未知副作用或后台作业未结束仍阻止确认；取消已受理但未结束也按原退避定时核对。界面只绑定同账号、同会话、同回合 / 回执的停止证据，旧任务不会覆盖新无关回合；FX-10 快照排序保持。

验证命令与结果：

- `node --test tests/personal-task-orphan-stop.test.ts tests/personal-task-stop-state.test.ts tests/personal-task-stop-backend.test.ts`：19/19。覆盖六种原生终态、重启 / 缺记录 / 真正不存在、存储错误、活动执行实例 / 待执行输入、异步核对期间新执行实例出现、定时核对 / 清理 / 重启持久结果、未知副作用。
- `node --test tests/personal-task-stop.test.ts tests/stage1-gateway.test.ts`：原停止退避、精确冻结和丢失回执恢复，以及只读原生查询端点、输入验证通过。
- `node --test tests/personal-task-stop-dsh.test.ts tests/personal-task-early-stop.test.ts tests/personal-task-control.test.ts tests/personal-access-ui-interaction.test.ts tests/personal-access-backend.test.ts`：原分组 76/76。后增界面回归单独 1/1，确认终态进展且不制造历史、不覆盖新回合。
- `node --test tests/personal-general-execution.test.ts tests/personal-tool-approvals.test.ts`：首次 7 项夹具漏了项目模块导入，其余 27 项通过；补两处夹具导入后 general-execution 15/15，审批 19/19 原断言保持。已停止拒绝新工具，重启后未完成副作用不重放，后台命令只按原回执清理。
- `node --test tests/mobile-ui-core-assets.test.ts`：5/5；共享界面资源逐字节一致。`npm run typecheck` 通过。
- `node tests/integration/fx-12-orphan-electron.mjs --baseline` 与不带参数运行：真实桌面改前 / 改后四场景、访问服务重启后自动核对、明确续做请求重放不重复派发通过。
- `WEFTMATE_SYNTHETIC_STOP_E2E=1` 下运行 `node tests/integration/personal-task-stop-electron.mjs`：真实 `src/main.mjs` / 固定 DSH / 合成流式模型，目标中止、上游关闭、无关排队回合继续、明确续做完成，进程正常退出。

本人升级后：新宿主启动会自动核对那四个旧停止请求。若它们如问题描述已结束、已取消，或旧运行时重启后已不可能继续运行，会自动显示「已结束」或「已停止」，保存一次核对结果并停止重试，无需清理 `store.json`、删除任务或重置账号。原目标 / 回执 / 步骤 / 成果保留；只有明确点继续并提供下一步才派发新命令。若仍存在真实活动回合、待执行输入、未知副作用或原生存储读取失败，继续保留「正在停止…」并退避；未读取日用数据，不能在隔离测试中声称逐一核验了日用四项。

完整测试交 GitHub CI（持续集成），最终检查见本包 PR（拉取请求）。未做日用升级、外部真实模型异常注入或长期浸泡。

4c：已清理进程：1（按 PID〔进程标识符〕主动结束启动等待卡住的隔离 Electron；其余测试正常关闭退出）。最终本工作树 / 合成目录匹配的 node / electron / python / wsl 残留 0；没有启动模拟器。正常截图夹具全部删除自己的临时账号目录。自动审批以 `blocked by policy` 阻止了失败启动遗留临时目录的清除；该小型隔离目录保留，失败截图移到忽略的 `.local`，没有提交。公开证据不含真实凭据、运行数据或私人地址。

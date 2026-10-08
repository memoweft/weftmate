# M2f · 完整来源形成、主题召回与盲测结果

> 本页保留上一轮失败，不覆盖历史结果。本轮返工最终结论见 [FINAL.md](FINAL.md)：约定门槛达标，原题 LAN（局域网模型服务）13/14，A+C 10/12；逐轮确定性/语义与残余失败见新证据。

**固定候选未通过验收：留出失败仍存在，原题出现退步。不能宣称记忆已对未见说法可靠。**

Core（记忆核心）候选 `f5d615e85d3691e3e7271e6f236f496c50a7dd00`；[Core PR（拉取请求）#90](https://github.com/memoweft/memoweft/pull/90)，[WeftMate PR #93](https://github.com/memoweft/weftmate/pull/93)。Core 只在新 worktree（工作树）修改，日用主目录仍为 main；由 Claude squash（压缩合并），之后须更新 Observed bridge（真实核心集成）到实际合并提交。

先在 `b6bc07f` 单独提交三个留出 B 场景，开发期间封存，固定候选进入最终矩阵后才读取结果。原 memory-01..04 与留出 A 的输入、检查、预算、审批决定逐字不改。所有失败保留，没有用复跑替换不利结果，没有放宽来源或解析校验。

形成 payload（输入数据）新增可显式选择的完整 sentences/sentence_id（句来源），原 segments/segment_id（分句来源）及 quote/span（逐字引用/范围）继续兼容。仅所选来源派生命题，不自动扩展未选内容，重叠/无效来源拒写。关系分类消除命名规则的矛盾；稳定使用数值属于持续安排。召回未命中时可尝试推荐请求原有主题名词、明确否定的旧值；召回仍只读、确定性，并沿用权限和当前项投影。提示未加入题目内容或答案。

[逐题定位表](DIAGNOSIS.md)与[实际请求/输出/存储/注入](diagnosis.json)保留 M2e 三轮来源和新增未改 Core 的 MiMo（云端对照模型）补跑。历史批次未留提示正文，明确标为 checkpoint（检查点）证据；新补跑捕获真实形成输入及最终回合第一/最后实际推理消息，工具/多模态内容在公开证据中仅留摘要哈希，完整原件保留于隔离临时目录。

| 分组 | M2e LAN（局域网模型服务）确定性 | M2f LAN 确定性 | M2f LAN 语义 | M2e MiMo 确定性 | M2f MiMo 确定性 | M2f MiMo 语义 |
|---|---:|---:|---:|---:|---:|---:|
| 原四项＋纠正专项三项 | 14/14 | 11/14 | 9/12 | 7/7 | 7/7 | 6/6 |
| 留出 A | 2/6 | 4/6 | 3/6 | 1/3 | 3/3 | 3/3 |
| 盲测 B | — | 3/6 | 3/6 | — | 2/3 | 2/3 |

语义评判默认关闭，本矩阵显式启用 `--memory-semantic-judge`，MiMo 裁决、理由、原始 JSON（结构化数据）、用量与错误并列保留，不替代确定性检查。换模型项没有预置语义判据，语义分母不含该项。LAN 的 A 语义列包含一笔格式错误（保留在分母中），不把错误按通过计。严格来源检查独立于字面失败，仍核对正式种类、当前项采用、精确原话、独立会话、零未声明审批；纠正另核对旧项失效/未采用与旧原话。

| 场景 | LAN 1 确定性 | LAN 1 语义 | LAN 2 确定性 | LAN 2 语义 | MiMo 确定性 | MiMo 语义 |
|---|---|---|---|---|---|---|
| 表达偏好 | 通过 / 71.17s | 通过 | 通过 / 67.00s | 通过 | 通过 / 31.93s | 通过 |
| 自然纠正 | 通过 / 187.00s | 通过 | 通过 / 200.34s | 通过 | 通过 / 49.55s | 通过 |
| 换模型称呼 | 通过 / 94.22s | — | 通过 / 63.87s | — | 通过 / 40.09s | — |
| 人物背景 | 通过 / 87.00s | 通过 | 失败 / 105.08s | 失败 | 通过 / 36.20s | 通过 |
| 表达偏好（纠正专项） | 通过 / 77.40s | 通过 | 通过 / 71.77s | 通过 | 通过 / 83.80s | 通过 |
| 自然纠正（纠正专项） | 失败 / 900.37s | 失败 | 通过 / 189.86s | 通过 | 通过 / 92.94s | 通过 |
| 三段独立对话（纠正专项） | 失败 / 84.59s | 失败 | 通过 / 89.57s | 通过 | 通过 / 82.76s | 通过 |
| A：音乐偏好 | 通过 / 60.97s | 通过 | 通过 / 62.68s | 通过 | 通过 / 53.86s | 通过 |
| A：园艺纠正 | 失败 / 159.04s | 失败 | 通过 / 157.00s | 通过 | 通过 / 43.47s | 通过 |
| A：陶艺师生 | 失败 / 68.05s | 失败 | 通过 / 62.71s | 错误 | 通过 / 48.67s | 通过 |
| B：住宿偏好 | 失败 / 66.43s | 失败 | 失败 / 65.11s | 失败 | 失败 / 61.20s | 失败 |
| B：频道纠正 | 通过 / 106.75s | 通过 | 通过 / 107.11s | 通过 | 通过 / 49.20s | 通过 |
| B：攀岩搭档 | 失败 / 69.81s | 失败 | 通过 / 66.81s | 通过 | 通过 / 33.17s | 通过 |

原题三个退步的前台请求、形成输出与回合状态见 [regressions.json](regressions.json)；其中一次澄清超时、一次临时指令误形成并抢占召回、一次关系附带不合法字段而拒写。

逐轮理由、回复、正式项采用及原话检查见 [verification.json](verification.json)；B 的形成/存储/实际模型输入见 [blind-b.json](blind-b.json)。每批使用随机端口、新合成账号和隔离目录、真实 Electron（桌面程序框架）/DSH（执行框架）；同批场景共享该批账号。LAN 全部持原子占用锁串行，只用 local-quality，包含反向换模型；没有重启服务。换模型分别为 LAN→MiMo（背景固定 LAN）、MiMo→LAN（背景固定 MiMo），该项不是纯单模型成绩。

新增未改 Core 的 MiMo 留出 A 补跑 2/3；两个开发候选各确定性 3/3，仅用于定位和开发，不合并进最终成绩。初版 512 token（令牌）评判存在截断/无效 JSON 与不准确否定意见，全部保留；之后评判用 2048 token、关闭思考并要求简短理由。已运行进程的旧结果不覆盖。

MiMo 九项主矩阵在场景结果保存后发生附加截图重载失败：运行中的宿主保留旧资源映射，合入最新 main 后页面引用了新 schedules 模块。该批入口退出码 1，九项按各自 status 判分。后续新宿主的 MiMo 纠正专项已通过完整当前项/旧项/原话检查与真实程序浅深色来源展示：[浅色](memory-source-light.png)、[深色](memory-source-dark.png)。

定向验证：WeftMate 最终合入 main 后定向22/22（无跳过）、类型检查通过；Core 形成相关51/51、召回/当前项78/78、新增与相关45/45（集合有重叠，不累加）、3文件严格类型检查通过。Core 完整 CI（持续集成）1758/1758、205文件严格类型检查及其余门禁全绿；首轮 WeftMate CI 根必过用例876通过、0失败、20既有跳过，真实 Core 集成及其余六项门禁全绿。未新增 CI 例外；完整测试只交 CI。最终提交检查以两个 PR 的最新结果为准。

本包所有诊断、开发与最终批次的 MiMo 共开始 212 个请求，208 笔完整用量：输入 1,055,528 token，缓存输入 725,440，输出 31,957。按[官方价目](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)（2026-10-08核对）缓存输入¥0.02、未缓存输入¥1、输出¥2／百万，已知费用下界 **¥0.40851080**；4 笔没有完整用量，不按零费用计。包括可选语义评判，不是账户账单。

清理：10个隔离批次共扫描2280个实际文件，真实密钥/私有LAN地址命中0；所有LAN桥最大同时占用1，所观察背景均在最后用户消息前。测试凭据文件0、登记隔离进程0，锁已释放；日用Core仍为main。公开新增证据在推送前另扫描。

模型矩阵宿主主要源版本为 `5948de8`（首个MiMo主矩阵为`9bb25ac`，记忆路径相同）；收尾合入最新main，新增备份写入屏障包住记忆outbox（发件队列）/journal（日志）文件写入，未改形成/召回匹配或插件请求顺序。未在收尾合并后重跑整个模型矩阵；追加相关22项与类型检查，完整验证交最终CI。

未做：完整八步 M2 出口、长期稳定性验收，以及尚未解决的形成资格判断、纠正动作一致性、隐含同义主题召回与原题澄清超时。客户端契约无本包变化。

复跑时先按并行规则取得 LAN 锁；每个 LAN 命令各两次，MiMo 一次。最后立即释放锁。原始失败仍以本证据为准，重跑生成新隔离批次：

```powershell
node tests/integration/personal-scenario-baseline.mjs --lan --memory-loop --memory-trace --memory-semantic-judge --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2f-memory-heldout/py/src
node tests/integration/personal-scenario-baseline.mjs --lan --lan-warmed --memory-loop --memory-correction --memory-trace --memory-semantic-judge --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2f-memory-heldout/py/src
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --alternate-lan --lan-warmed --memory-loop --memory-trace --memory-semantic-judge --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2f-memory-heldout/py/src
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --memory-loop --memory-correction --memory-trace --memory-semantic-judge --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2f-memory-heldout/py/src
```

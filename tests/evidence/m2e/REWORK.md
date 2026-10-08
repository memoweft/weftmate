# M2e · 去污染返工与留出验证

最终固定候选：原场景及纠正专项 LAN（局域网）14/14、MiMo 7/7；新增留出集 LAN 2/6、MiMo 1/3。整体 LAN 16/20、MiMo 8/10。**留出验收未通过，不能宣称本地模型记忆可靠性已经完成。**

旧形成提示直接包含了原评测场景的原句或近原句，因此旧 LAN 14/14 不能证明对新说法有效。旧结果、失败及费用仍完整保留在 [原证据](verification.json)；本次所有批次见 [逐轮证据](rework-verification.json)。

Core（记忆核心）去污染候选 `2c1b1ef` 把中英文示例换为早餐、地铁通勤、书籍版本和家人关系，删除重复完整 JSON（结构化数据）案例，每类规则最多一个短示例。持续偏好／安排、最近不是拒绝形成的理由、取代链消解、一个纠正一个 item、完整 ID（标识）复制及关系 target_entity 规则均保留；解析、权限、单 JSON 围栏、predecessor_context、快照顺序和计费路由修复均保留。

去污染首批原四项仅 3/4，留出 1/3。原自然纠正仍输出 action=form 却附 corrects_cognition_id，重写后仍是同样错误，Core 以 unexpected_correction_target 拒写，场景 900.39 秒超时。留出纠正引用了非权威的 60 字符 ID，Core 以 correction_target_unknown 拒写。**原成绩下降确实说明之前的场景示例帮助了通过，不能把旧成绩当独立验证。**

随后只强化通用规则：纠正先选 action=correct；action=form 不能带 corrects_*；完整选择改口原话；ID 是不透明字符串，只能逐字符复制，不能生成、压缩、截断或由命题推导。最终 Core 候选为 `b0f8d15cb98eb610c9bd8ef163df7a2d5621136d`。没有把原题或留出题的内容写入提示，也没有放宽编译校验。

## 原场景与留出集

新增三个 memory-1x 场景分别覆盖音乐偏好、园艺用量的省略主题纠正、陶艺师生背景。原 memory-01..04 文件逐字未改。每批使用新合成账号、随机端口、系统临时目录及真实 Electron（桌面程序框架）／DSH（执行框架）；同批场景共享该批账号，与原矩阵相同。没有预植事实或改预算、审批决定；可选模型评判维持关闭，跳过项逐条保留。

除原样回复及回合检查外，留出集检查独立会话、未声明审批为零、对应正式当前项确实被回复采用、精确原话来源；纠正还检查旧项失效、旧项未采用和双方原话保留。人物场景要求对应正式关系。回复碰巧出现答案数字不会被算成通过。

| 场景 | 仅去污染 LAN（2c1b1ef） | 通用规则 LAN 1 | 通用规则 LAN 2 | MiMo 1 |
|---|---|---|---|---|
| 表达偏好 | 通过 / 81.94s | 通过 / 81.86s | 通过 / 67.51s | 通过 / 48.35s |
| 自然纠正 | 失败 / 900.39s | 通过 / 135.44s | 通过 / 133.71s | 通过 / 58.51s |
| 换模型 | 通过 / 80.55s | 通过 / 70.33s | 通过 / 64.67s | 通过 / 29.90s |
| 人物背景 | 通过 / 76.07s | 通过 / 77.73s | 通过 / 89.95s | 通过 / 42.96s |
| 留出：纯器乐偏好 | 失败 / 80.88s | 失败 / 73.34s | 失败 / 77.36s | 失败 / 59.32s |
| 留出：盆栽浇水量 | 失败 / 170.09s | 失败 / 160.32s | 通过 / 177.66s | 通过 / 114.33s |
| 留出：陶艺师生 | 通过 / 96.73s | 失败 / 81.70s | 通过 / 73.43s | 失败 / 30.60s |

memory-03 保持原流程：LAN→MiMo，后台固定 LAN；MiMo→LAN，后台固定 MiMo。该项不是纯单模型成绩。旧 LAN 两轮四项均 4/4，旧具体时长见 [历史矩阵](README.md)。

## 纠正专项

| 场景 | LAN 1 | LAN 2 | MiMo 1 |
|---|---|---|---|
| 表达偏好 | 通过 / 78.50s | 通过 / 71.02s | 通过 / 52.84s |
| 自然纠正 | 通过 / 133.24s | 通过 / 200.55s | 通过 / 47.65s |
| 三段独立对话 | 通过 / 105.19s | 通过 / 99.09s | 通过 / 75.49s |

两轮 LAN 及 MiMo 的专项均检查三段独立对话、当前纠正项采用、旧项排除、原话保留和真实程序浅深色来源展示。结果及扫描统计在逐轮 JSON 中保留。

## 失败的实际含义

- 仅去污染 LAN：原纠正被 action/form 与纠正目标组合拒写；留出纠正使用非权威 ID；音乐偏好形成，但回复没有采用对应当前项。
- 通用规则 LAN 第一轮：园艺两次形成被判 no_change，回复泛泛给出 150–250ml，数字检查虽过，正式记忆采用检查拒绝通过；人物回复以“老师好”称呼，已采用对应正式关系，但未包含规定姓名，严格字面检查失败；音乐偏好已形成，对应当前项未采用。
- 通用规则 LAN 第二轮：园艺纠正与人物正式关系、当前项采用及精确原话来源均通过；音乐偏好再次未采用，形成时未保留主题片段。
- MiMo：园艺纠正及严格来源通过。人物回复联系“陶泥、捏泥巴、做陶”，但未命中预设“陶艺/拉坯”检查词，并且形成的是第三方属性而非正式关系；这不等于完全没有联系背景。音乐偏好形成时漏选了主题所在片段，最终回复未采用对应当前项。

留出输入、检查词和评分条件在看到失败后均未调整。人物的语义联系与字面失败分别记录；音乐项在新对话开始时尚未形成，后续当前项也未被采用，原因未完全定论。跨模型失败列为待查，不能全部归为本地模型能力。

## 测试、CI 与清理

最终提示／解析定向 Python 29/29；前批形成相关 83/83。WeftMate 评测器 12/12、相关宿主及 LAN 桥 8/8，类型检查通过。Core 完整 CI（持续集成）1,748/1,748，204 模块严格类型检查通过；完整 WeftMate 测试只交 CI。[WeftMate #77 当前检查](https://github.com/memoweft/weftmate/pull/77/checks)、[Core #89 当前检查](https://github.com/memoweft/memoweft/pull/89/checks)。

LAN 全部串行，原子取得占用锁，只用 local-quality；MiMo 反向换模型也持锁。整批立即释放锁，最后一轮再次原子取得锁。没有重启共享模型服务，没有切换日用 Core 主目录。私有地址与密钥未写入公开证据；每批退出删除测试凭据并扫描隔离产物。7 批共扫描 1,573 个实际文件，真实密钥／私有地址命中 0；各 LAN 桥最大同时占用槽位均为 1，实际请求中所有已观察背景均在最后用户消息之前。

Core 继续在原 worktree（工作树）完成，WeftMate Observed bridge（真实核心集成）固定最终 Core 候选。Core 仍由 Claude squash（压缩合并），之后更新实际合并提交。客户端契约无本包变更；完整八步 M2 出口与长期浸泡未做。

## 费用与复跑

本次 7 批 MiMo 共开始 72 个请求，70 笔完整用量：输入 355,922 token（令牌），缓存输入 285,440，输出 12,511。沿用原证据记录的价目公式，已知费用 ¥0.10121280；2 笔未返回用量，费用未知，不按零计。加上原 26 批，33 批累计已知费用下界 ¥0.70174160，17 笔无用量。入口退出码不作为场景通过依据，逐项按 status 与严格来源检查计分。

先按并行规则原子取得 LAN 占用锁，以下 LAN 两项各顺序跑两次，MiMo 两项各一次；只用 local-quality，整批立即释放锁。每次均产生新隔离账号；原四项、三个留出集会由 --memory-loop 自动加载。

```powershell
node tests/integration/personal-scenario-baseline.mjs --lan --memory-loop --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2e-local-model/py/src
node tests/integration/personal-scenario-baseline.mjs --lan --lan-warmed --memory-loop --memory-correction --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2e-local-model/py/src
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --alternate-lan --lan-warmed --memory-loop --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2e-local-model/py/src
node tests/integration/personal-scenario-baseline.mjs --mimo --mimo-machine --memory-loop --memory-correction --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2e-local-model/py/src
```

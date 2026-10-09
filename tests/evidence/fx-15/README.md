# FX-15 · 确认决定与迁移备份核对

交付：[WeftMate PR #156](https://github.com/memoweft/weftmate/pull/156)、[Core PR #98](https://github.com/memoweft/memoweft/pull/98)。两仓均未合并、未部署。Core（记忆核心）由 Claude squash（压缩合并）；宿主暂固定 `2d403fc95632178f7939d44cce65a63d3dab4c3c`，合并 Core 后需把 Observed bridge（真实核心集成）的 ref 改为 squash 提交。

## QA3-01 根因与修法

宿主 `boundaryForCompletedTurn` 每次只发送本轮用户／助手的原话与消息 ID（标识）。上一轮助手提议已经作为 `InteractionContext` 持久保存；它不在下一轮确认 Evidence（原始证据）的 `preceding_ai_context` 字段里。Core 给形成模型看了此前四轮上下文，编译器却只查空字段，因而模型选 `confirmed` 就可能得到 `assistant_claim_context_missing`。MF-2 的近期纠正桥接和 M3-A 的离线补交没有截断这条提议；问题在 Core 两条上下文读取路径不一致。

固定 `a9b115f` 上的新回归先复现：短确认“行，就这么办”得到该错误；“好”还被无上下文快速判断为无事实。修复共用已有账号、会话、时间和权限过滤后的上下文；确认必须逐字匹配实际助手提议。编译器保存提议所在交互与助手消息引用，并把该回合的依据加入既有权限／遗忘依赖。助手文字仍是上下文，不冒充用户 Evidence。显式重述保留用户逐字命题；唯一同人物的前置提议可作为来源上下文保留，原话或指代不唯一时不猜。

来源接口兼容增加助手角色、消息和会话标识，原界面直接显示双方原话。实际短确认还暴露“开黑／找队友”与“组队”召回不匹配，现沿用既有查询扩展，并随正式决定提供已关联的助手原话，解释“他”指谁。没有新增前台形成等待、放宽无依据确认、修改宿主摄取边界或建立原话缓存。MEM-2／M3-A 的摄取路径保留。

## 真实程序成绩

均为真实 Electron（桌面程序框架）、固定 DSH（助手运行时）、真实 Core、MiMo；新会话使用 LAN（局域网）`local-quality`，遵守独占锁。题集在 [固定用例](../../fixtures/fx15-confirmed-decisions.json)，汇总在 [acceptance-summary.json](acceptance-summary.json)。

| 用例 | 结果 | 双方原话在来源页可见 | 新会话换模型采用该正式决定 |
|---|---:|---|---|
| 王小明原八步 | **8/8** | 是 | 是，核对决定自身的 `memoryUsed` ID |
| “行，就这么办” | **4/4** | 是 | 是 |
| 中间两轮问一周天数、17＋23，再确认先前提议 | **4/4** | 是 | 是 |

原题第 05–08 步同时通过纠正与旧关系失效解释、重启、真正遗忘、备份原始字节／数据库零残留，以及实际停止 Core 后聊天降级。变体只验证 01–04 步，不冒称另外跑了八步。

- [原八步原件](acceptance-original/baseline-mimo.json)、[决定来源页](acceptance-original/confirmed-decision-sources.png)。
- [短确认原件](acceptance-alternate/baseline-mimo.json)、[来源页](acceptance-alternate/confirmed-decision-sources.png)。
- [隔轮确认原件](delayed/baseline-mimo.json)、[来源页](delayed/confirmed-decision-sources.png)。

原八步判据未放宽。新增变体按“同一正式决定＋用户确认原话＋真实助手提议”识别决定，不要求助手原话使用固定同义词或重复人名；第 04 步必须采用那个决定 ID。`alternate-final` 中旧姓名字符串检查失败、较强的决定 ID 检查成功，原件保留；修正新增变体运行器后重新以新账号完成 `acceptance-alternate`，未覆盖失败成绩。

复现命令（环境变量依并行规则，密钥只进进程）：

```powershell
node tests/integration/m2-exit-desktop.mjs --model mimo --eight-only --confirmation-case original --memory-core-source <Core工作树>/py/src --memory-trace --lock-owner FX-15 --out <证据目录> --require-pass
# 两个新增用例分别执行；独立账号、随机端口与临时数据目录：
node tests/integration/m2-exit-desktop.mjs --model mimo --eight-only --confirmation-case alternate --confirmation-only --memory-core-source <Core工作树>/py/src --lock-owner FX-15 --out <证据目录> --require-pass
node tests/integration/m2-exit-desktop.mjs --model mimo --eight-only --confirmation-case delayed --confirmation-only --memory-core-source <Core工作树>/py/src --lock-owner FX-15 --out <证据目录> --require-pass
```

## 失败原件与版本边界

`before` 是首次探索性运行，误用运行器默认 Core 目录的 `5d91823`，8/8 只说明模型选择显式重述时可能绕开旧确认分支；不计作固定版本的改前验收。未切换或修改 Core 主目录。随后所有真实运行显式指定本包 Core 工作树，基于固定 `a9b115f`。

`after-initial` 保留模型把条件提醒变成阻塞频率问题的失败；`original` 保留模型擅自建定时任务、导致备份中的任务文件仍有姓名的失败。工具说明现明确仅用于用户指定时间的任务，不凭条件性的共同决定编造日期。`original-final` 保留确认主题字段编译失败；`eight-verified` 保留过严要求显式重述再次提供助手字段的失败；修复后的原题是 `acceptance-original`。[形成失败汇总](formation-failures.json)保留对应作业／重写结果，未用成功重跑覆盖失败。

开发验收在工作树中执行，报告的 `revision` 记录开跑时 HEAD，不表示当时没有未提交改动。原题验收跨过 Core 提交与 IA-3 主干合入；重启步骤加载了合入后的宿主。最终固定提交另经相关测试、类型检查及两仓 CI（持续集成）；未冒称每轮从头到尾都在同一干净提交运行。

## QA3-B02：指定备份的数量结论

[只读库存](backup-inventory.json)只有匿名序号、布尔、版本与表行数；[隔离查询](backup-query.json)只有布尔、数量与 HTTP（网页传输协议）状态，没有私人原话、姓名、账号标识或记忆内容。

- 4 个保存账号，2 个有规范 Core 库。共发现 7 个 Core SQLite（嵌入式数据库）文件，均为 `user_version=20`；另 5 个是原账号记忆目录中的非当前库。
- **7 库的 `entity / relationship / cognition / world_event` 全部 0 行**。原账号规范库有 `evidence=1`、`interaction_context=1`、`memory_world_job=1`、`boundary_evidence_content=1`、`terminal_outcome=1`、`interaction_commitment=1`；这些不是正式 World（世界记忆）项。其余库相关表为空，`memory_state=0`。
- 规范路径由宿主固定为 `<dataDirectory>/personal-access/accounts/<ownerId>/memory-home/memoweft/memoweft.sqlite3`。依据归属与账号映射一致，没有旧格式转换或空间错位证据。本次未访问其它运行目录，不能据此宣称用户在所有地方都没有旧记忆。
- 原账号三类 `200 + 0`；其他三个账号 `503`，底层累计24次 `MEMORY_MODEL_UNAVAILABLE`。两个账号没有可用模型；另一个有私有模型，仅补合成凭据仍503，选择可用后台模型后三类变为 `200 + 0`。这是已授权模型路由不可用，不是查询到0，也不是安装升级丢失记录。
- 演练用原账号身份的临时本地登录替身，密钥库排除；凭据替身仅内存保存，网络仅允许随机回环并拒绝8081／18186，没有向模型发送私人内容。副本均在脚本 `finally` 中删除。

指定备份原本没有可搬迁的正式记忆，因此不增加数据库迁移或改写 `migrate-installed-desktop.ps1`。迁移当天必须按 [更新后的检查清单](../../../docs/WINDOWS_RELEASE.md)重新取当天数量，逐账号区分200空表和503，先处理模型选择／凭据；如预期存在旧记忆，先确认另一个明确授权的数据源。FX-14 负责 Verify（迁移验证）401；本包未动它的脚本分支。QA-3 已有同备份源码／安装版／回退空表证据，本包没有把空库核对称为非空旧记忆迁移成功。

## 测试、用量与清理

Core 定向112项通过；完整 CI **1,902项通过、218个模块严格类型检查通过**，其余应运行门禁全绿，发布步骤按标签条件跳过。宿主确认／纠正／即时桥接7项、来源／边界／提示13项及 `npm run typecheck` 通过；完整 CI 与 Observed bridge 以 PR #156 当前提交为准。

[用量汇总](usage-total.json)：232次实际 MiMo 请求，230笔返回用量、2笔缺用量；已知输入620,520，其中缓存362,112，输出23,939 token（词元）。包含失败、取消、重写和复跑，代理不重复计数。原运行器单价下已知费用下界0.31352824元，不是账户账单，缺用量不按免费算。

[隐私扫描](privacy-scan.json)：公开证据及10个合成根目录共3,556文件，密钥／私有模型地址0命中。[清理核对](cleanup.json)：已清理进程 **4**（故障测试显式结束的两个父子进程对）；各真实运行器正常退出并关闭子进程，最终本包产品进程0、16次已记录 Core 启动的残留0、本人备份副本0、自有LAN锁0、未启动模拟器。Claude 的两个 `stall-watch.py` 编排监控不属于本包启动的进程，未停止。

自动审批审查拒绝批量删除10个合成临时目录，仅返回 `blocked by policy`；这些目录保留，已扫描无模型密钥和私有地址。本人备份副本已独立删除。没有操作日用程序、计划任务、日用数据库或密钥库，也没有请求8081／18186。

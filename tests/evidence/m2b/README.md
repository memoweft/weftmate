# M2b 记忆形成准确

2026-10-08。Core（记忆核心）[PR #86](https://github.com/memoweft/memoweft/pull/86)，WeftMate [PR #54](https://github.com/memoweft/weftmate/pull/54)。真实 Electron（桌面程序框架）+ 固定 DSH（执行框架）+ 隔离 Core、账号与数据目录。原目标、检查及 M0-7b 的每场景600秒总预算保持；未启用可选 LLM judge（模型评判），没有代答或放行未声明审批。

形成结果中的 `stated`（用户直接陈述）命题由所选原话片段派生，保留名字、称呼、数字和日期；旧版单条解释也不能绕过。结构实体名必须有原话锚定，无法核对就不写入。事件日期只从原话唯一明确的完整数字日期确定性归一；相对或歧义日期保留原话时间表达，不保存猜出的日历日期。宿主没有猜名字或代填事实。

非法 JSON（结构化数据）、缺必填字段及截断解释，把具体编译错误、首个返回与原话证据反馈给后台模型，完整重写一次。首个返回、重写预约、错误和最终结果进入既有持久任务记录；恢复不再重写第三次。HTTP（网络请求）层启用 `response_format` JSON模式，隐藏推理不当作解释保存或反馈。原有网络失败重试与这一次解释重写分别处理，未修改传输重试策略。

| 场景 | M2a Qwen / MiMo | M2b最终 Qwen / MiMo | 核对 |
|---|---|---|---|
| memory-01 偏好 | 通过269.43s / 失败83.72s | **超时600.56s / 通过59.16s** | MiMo新对话使用买菜例子与采用依据；Qwen后台网络超时、原有重试与等待超过场景预算，偏好后来准确形成 |
| memory-03 换模型称呼 | 失败100.73s / 通过69.28s | **超时600.64s / 通过84.33s** | 分别Qwen→MiMo、MiMo→Qwen；最终Qwen已保存“小禾”，但后续采用未在预算内完成；MiMo完整通过 |
| memory-04 人物背景 | 失败133.02s / 通过39.77s | **超时600.63s / 通过35.44s** | MiMo正确形成并采用阿岚背景；Qwen人物工作退出时仍处理中，未写入错误人物 |

最终选定三场景：**Qwen 0/3，MiMo 3/3，M2出口未达**。memory-03是混合模型方向，不能将整项当作纯前台模型能力对照。Qwen本轮失败有后台网络超时/重试/积压的实际证据；这不是缺字段编译错误，不能把它概括成仍抄错姓名，也不据此断言纯模型能力或某一代码根因。

开发首轮Qwen：偏好失败432.32秒（原话已形成，但原“如何称呼和讲解”查询没召回）；称呼**通过119.25秒**；人物失败541.96秒（解释把阿岚写成阿朵，反馈重写后仍不合格，Core零写入）。首轮完整保留，未用它替换最终超时成绩。WeftMate改用Core既有显式词汇查询召回语言/例子/术语偏好，身份单独查询；未将买菜或具体姓名塞进召回问题。真实Core单测证明原话偏好可召回。

三份隔离World（记忆世界）均没有写入“小莓”或“阿朵”。最终Qwen保存“小禾”和原话买菜偏好；MiMo保存“小禾”“阿岚”。后台错误返回留在私有任务检查点，拒绝写入的错误解释不当作World事实。结果、回合统计、形成审计与费用见 [verification.json](verification.json)。公开JSON不含完整回复、账号/会话/审批标识或临时路径。

开发相关批次272/272、日期/事件32/32、准确性/HTTP43/43（批次有重叠）；WeftMate相关11/11、`npm run typecheck`和严格Python类型检查通过。包含专名/数字/日期不一致、缺字段/非法JSON重写、第二次仍失败零写入、截断解释与重写恢复不重复、结构输出穿过后台路由。真实场景使用名字/必填字段/原话查询实现；事件日期与截断字段补丁在宿主启动后追加，这两条另用定向测试与完整Core CI（持续集成）验证，原场景没有事件日期输入。

完整测试只在CI运行：Core最终实现提交Python **1,710/1,710**，严格类型检查202个模块；[Core检查](https://github.com/memoweft/memoweft/pull/86/checks)与[WeftMate检查](https://github.com/memoweft/weftmate/pull/54/checks)以PR最新提交为准。合入Apple A4b时只解决STATE冲突。证书CI曾出现`CLOUD_UNAVAILABLE`/续签连接失败，仅重跑失败项后通过；未改证书代码、断言或CI例外。

MiMo本包全部前台/标题/形成共 **17个实际请求**，全部有用量：输入75,783 token（令牌），其中缓存43,200、未缓存32,583；输出3,384，合计79,167。按[官方价目](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)缓存输入¥0.02、未缓存输入¥1、输出¥2/百万计算，**¥0.040215（约¥0.04）**。包含首轮和最终两个方向中的MiMo请求；无缺失用量估计，推理计入输出，这是请求用量计价，不是账户账单。JSON模式使用[官方结构化输出文档](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output)。

三个隔离根498个文件密钥扫描零命中，测试凭据文件和宿主进程剩余0；8081保留`qwen3.8-27b-original`、切换/活动/排队/维护租约0，`/props`可读98,304/单槽。没有读取日用保管库、启动其他本地模型或停止/重启8080。模型请求记录只出现指定8081 Qwen及官方MiMo。

复跑（Core使用独立工作目录，解释器复用现有虚拟环境）：

```powershell
node tests/integration/personal-scenario-baseline.mjs --memory-loop --memory-accuracy --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2b-formation-accuracy/py/src
node tests/integration/personal-scenario-baseline.mjs --memory-loop --memory-accuracy --mimo --mimo-machine --memory-core-source D:/AIProjects/MemoWeft/Worktrees/m2b-formation-accuracy/py/src
```

Core仅由Claude squash（压缩合并）到main，之后须将WeftMate CI的固定Core提交更新为实际合并提交。当前WeftMate CI仍固定前版Core，不能当作未合并形成改动的验证；新Core由自身CI与上述隔离程序复跑验证。M2-3纠正不在本包：M2a `memory-02`第三轮弹出未声明审批的现象保留，未复跑或自动批准；完整八步闭环与模型服务长期稳定性另验。

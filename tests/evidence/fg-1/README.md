# FG-1 · 真正遗忘、记忆导出与故障提示

Windows-4，2026-10-09。只处理 EX-2（出口验收）第⑥至⑧步及设置导出；没有修改 M2f 的 Formation（记忆形成）或 Recall（记忆召回）。测试使用真实 Electron（桌面程序框架）、固定 DSH（助手运行时）、独立 MemoWeft Core（记忆核心）工作树及合成账号；原验收的全部模型调用为 MiMo `mimo-v2.6-flash`，不使用 LAN（局域网）或本地共享模型。

返工：清除范围修正、只读遗忘预览、级联名称／数量和 D33 原话选项已交付；新增真实桌面与手机网页截图、测试和范围说明见[返工证据](rework/README.md)。

## 结果与证据

| 验证 | 结果 | 原始证据 |
|---|---|---|
| ⑥ 完整退出、复用隔离目录重启 | 当前表弟关系持久化，回复完成并采用最新记忆 | [存储验收](storage-final.json) 第06步 |
| ⑦ 记忆页看来源并「忘掉」 | 原话来源可见；Core 与宿主清理完成；原生聊天中的用户原话默认保留 | 同上第07步 |
| ⑦ 重启后勾选遗忘删除全部关联对话 | 两个真实对话均200；来源证据被真正遗忘，正式条目不再含姓名 | 同上第07步 |
| ⑦ 记忆导出与新 BK-1（备份引擎）备份 | JSON（结构化数据）和 Markdown（文本标记格式）均无被遗忘内容；新备份解包后的102个文件无可恢复姓名；数据库查询与全文件字节核对均通过 | 同上第07步 |
| ⑦ 新会话再问原问题 | 回合完成、不采用记忆、不回答姓名 | 同上第07步 |
| ⑧ Core 真进程停止且后续启动失败 | 普通问候完成、无记忆注入；桌面与手机宽度网页有轻提示 | [故障与恢复验收](outage-final.json) |
| ⑧ Core 恢复 | 恢复读取能力后提示自动消失；待交付来源不冒充已完成形成 | 同上 |
| 设置 → 记忆 → 导出 | 桌面经原生保存接口实际写出 JSON、Markdown 两个文件；另在390像素宽 Chromium（浏览器引擎）网页中实际下载 Markdown | [实际保存和浏览器下载](settings-export-final.json) |
| 定向回归 | 64项主要相关测试通过，追加实体无直接来源的开关用例通过；原生桌面 IPC（进程间通信）／界面13项、完整装配交互与记忆界面62项通过；类型检查通过 | 对应 `tests/fg-1-*.test.ts` 等；完整测试交 CI（持续集成） |

截图：[设置导出](settings-export.png)、[记忆页导出](memory-export.png)、[真实手机宽度浏览器导出](mobile-browser-memory-export.png)、[原话来源](mimo-sources.png)、[勾选遗忘删除](mimo-forget.png)、[桌面故障提示](mimo-core-unavailable-chat.png)、[手机宽度故障提示](mimo-core-unavailable-mobile-web.png)、[恢复后提示消失](mimo-core-recovered-mobile-web.png)。

`storage-final.json` 的⑥／⑦通过，旧⑧恢复门要求 `ready` 而失败，原始失败保留。Core 恢复后可以先进入 `degraded`（待处理来源状态）；最终故障门改为实际可读能力恢复，提示只表示 Core 故障，来源处理状态继续在记忆页显示。`outage-final.json` 用正在进行的真实对话测故障与恢复，没有把故障后新建会话的其他失败算成普通对话不可用。

## 根因与修复

[原生删除诊断](deletion-diagnostic.json)：重启后原生返回 HTTP（网络请求状态）400 `agent-busy`。DSH 的 `session.models` 内部通过 `agentFor()` 恢复冷会话，句柄归 API proxy（接口代理）私有；宿主随后只有会话对象，没有 disposer（生命周期清理句柄）。现在模型访问前通过宿主的原生入口持有句柄，模型读写、恢复、遗忘清理与删除按会话串行，其他会话继续独立运行。错误日志／响应携带受限的原生状态与代码。

Core 清除来源与混合来源派生对象，删除没有直接来源登记、也没有剩余依据的人物及别名，返回完整受影响标识。Core 的原话上下文副本和派生前置上下文也清除；聊天原件由宿主管理。删除对话勾选遗忘还清除该对话剩余 Core 上下文，能从原生来源身份恢复已失去批次任务索引的来源，避免一条记忆的遗忘删掉批次索引后漏掉同批次的其他原话。SQLite（嵌入式数据库）使用 `secure_delete`（删除时清零）、`VACUUM`（数据库重整）和 WAL（预写日志）截断；未完成返回待清理，保留重试入口。

宿主清除记忆注入、采用标记、持久投影和相关纠正日志。会话遗忘的证据标识在宿主中保存到删除结束，来源任务已从 Core 移除时仍可重试。记忆页遗忘默认保留原生对话；`deleteConversationSnippets:false` 是默认接口选项，显式 `true` 另清除含来源原话的原生片段及个人命令副本，D33返工已在两类确认框暴露默认不勾的开关，且先读取级联范围，详见[返工证据](rework/README.md)。

桌面导出使用已有鉴权接口和原生保存对话框，选择位置后重新取得当前导出并核对账户；不接受渲染器指定文件内容或任意读取路径。浏览器使用同源下载。导出包含完整记忆及来源摘要，Core 没有摘要时使用有读取权限的原话短片段，不导出整个聊天或内部形成日志。

## 失败保留与边界

最新重复闭环另见 [final-repeat.json](final-repeat.json)：⑥及⑧通过，⑦来源／遗忘／两类导出／新备份字节与数据库检查全部通过；原问句回合没有完成，因而该次⑦仍判失败，不把存储成功改成整步通过。较早的 `storage-final.json` 中原问句完成且不采用或回答被遗忘姓名，成功证据与重复失败都保留。

首轮 WeftMate Linux CI 的装配测试因旧 DOM（页面元素模型）桩缺少 `before()` 失败；只补齐测试桩的相邻插入能力，随后受影响62项通过。生产行为与测试例外未修改。

所有开发批次保留在 `diagnostic.json`、`development-*.json`、`settings-*-failure.json` 等文件中：原始400、孤立实体、清理待完成、压缩日志头帧格式、Core 原话副本、旧恢复门、新建会话的偶发原生传输失败、原始问句触发工具审批、桌面 Blob（内存文件）下载，以及手机测试未先展开侧栏。没有把早期失败覆盖成成功。最终存储门、故障门和真实文件导出分开计，不宣称完整王小明八步通过。

保留的原生对话及以前生成的备份仍可含原话，这是本包明确的默认行为；专用记忆导出不含被遗忘记忆。新完整备份的全字节检查是在对应对话也永久删除后进行。没有删除日用 Runtime（运行数据）或历史备份，未测试 LAN、安卓模拟器或长时浸泡；最终两仓已合入 M2f 完成后的 main（主分支），没有再宣称完整八步验收。

Core PR（拉取请求）：[memoweft #91](https://github.com/memoweft/memoweft/pull/91)，由 Claude 审查并 squash（压缩合并）。Core 最终代码以各仓 PR 最新提交为准；[源码指纹](validated-source.json) 记录最终待交付实现。Core 修改仅限删除实现、删除 RPC（远程过程调用）分发、存储清理、相应测试和说明。WeftMate 本包依赖此 Core 版本；WeftMate [PR #102](https://github.com/memoweft/weftmate/pull/102)；两仓完整 CI 见各自 PR。

## 费用、隔离与复跑

[全包计量与私密扫描](audit.json) 按实际 MiMo 上游请求去重，包含失败／中断批次和后台调用。已知178次请求，178笔有用量、0缺失；输入2,073,305 token（令牌），其中缓存1,210,688，输出34,995。按项目缓存输入¥0.02、未缓存输入¥1、输出¥2／百万token计算：**¥0.95682076**，不是账户账单。设置与下载验收没有模型推理费用。

密钥只在进程中使用；公开证据及隔离目录均扫描。审计根据进程创建时间排除已被系统复用的 PID（进程标识），不停止后来占用该 PID 的其他进程；已记录测试进程均退出。最终16个隔离根扫描4815个文件，0私密命中；已记录测试进程仍存活0，公开扫描0私密命中。详见 `audit.json`。

```powershell
# 只跑⑥至⑧，MiMo；无 LAN 环境或锁依赖。
node tests/integration/m2-exit-desktop.mjs --fg-1 --require-pass --memory-core-source D:/AIProjects/MemoWeft/Worktrees/fg-1-forget/py/src --out C:/Temp/fg-1-replay
# 单独故障／恢复；先初始化真实 Core，再在原对话里测试。
node tests/integration/m2-exit-desktop.mjs --fg-1 --fg-1-outage --require-pass --memory-core-source D:/AIProjects/MemoWeft/Worktrees/fg-1-forget/py/src --out C:/Temp/fg-1-outage-replay
# 原生桌面保存和手机宽度浏览器实际下载；不调用模型。
node tests/integration/m2-exit-desktop.mjs --fg-1 --fg-1-settings --require-pass --memory-core-source D:/AIProjects/MemoWeft/Worktrees/fg-1-forget/py/src --out C:/Temp/fg-1-export-replay
node --test tests/fg-1-*.test.ts tests/session-experience.test.ts
```

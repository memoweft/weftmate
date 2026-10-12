# CI-1 验收证据

Windows 一轮实测墙上时间为 18分29秒至24分29秒，相比原80轮成功样本的作业中位数41分03秒缩短；六轮均超过15分钟目标，未宣称达标。
连续六轮同一代码提交 0ed278501ad1e52b9444432b17ddafab9db14f14 的完整 CI（持续集成）中，Windows 红灯 1 次；完整流程结果 5/6 成功，逐检查结论见完整表。
计时敏感清单共六项：ASAR项目读取、M4/S1同步、早期原生审批2秒、宿主关闭500毫秒、空主聊唤醒700毫秒、桌面运动50毫秒；仅实际失败过的预算用例，完整名称与次数见清单。

| 轮次 | Windows 1 / 2 / 3（秒） | Windows墙上时间 | 结论 | 重跑才通过 |
|---|---|---|---|---|
| [round-1](https://github.com/memoweft/weftmate/actions/runs/38240068237) | 1189 / 1114 / 1187 | 19分51秒 | success | 0 |
| [round-2](https://github.com/memoweft/weftmate/actions/runs/38242324905) | 1135 / 1082 / 1142 | 19分2秒 | success | 0 |
| [round-3](https://github.com/memoweft/weftmate/actions/runs/38244530406) | 1125 / 1075 / 1224 | 20分24秒 | success | macos-latest: BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s<br>windows-latest: BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s |
| [round-4](https://github.com/memoweft/weftmate/actions/runs/38246865321) | 1108 / 1109 / 1019 | 18分29秒 | success | 0 |
| [round-5](https://github.com/memoweft/weftmate/actions/runs/38248916985) | 1173 / 1113 / 864 | 19分33秒 | success | 0 |
| [round-6](https://github.com/memoweft/weftmate/actions/runs/38251122859) | 1469 / 903 / 1157 | 24分29秒 | failure | 0 |

[六轮各检查及通过／失败／跳过数](cloud/six-rounds.md)；[原80轮失败表](flaky-table.md)；[打包80轮失败表](package/flaky-table.md)；[分支后续观察](followup-table.md)；[决策证据](decisions.md)；[本机验收与名额记录](local-verification.json)。

原80轮：Windows成功作业中位2463秒、required中位2150秒；Linux成功作业中位833秒，超过12分钟，因此同样拆三片。最长映射文件492秒，云端文件期限600秒、作业25分钟。失败按每次历史尝试统计，重跑后成功不能抹掉原失败；超一小时取消仅标疑似卡死。Windows打包五次冒烟失败，三次审批按钮等待、两次首窗口等待，根因未确定，保持严格。

确定性夹具修复（未改产品代码、预算或断言）：

- 长历史审批读计数：停止并等待活动观察者关闭，再安装精确计数器；避免正常后台读取7≠6。
- M1错误恢复：用真实BrowserWindow可见性发布前台状态，等待桥状态与所有进行中的刷新结束，再注入八类错误；替换夹具强制前台和固定sleep。
- 活动快照：等待真实问题帧已登记，再执行原三个未读项断言。
- 原生注销／重新授权：停止独立活动观察者、读新游标、等待实际原生等待注册后触发被挂起的查询；原401与监听器断言不变。
- memory-plugin假Cordis生命周期：登记并等待effect返回的清理函数，恢复DSH_HOME前排空旧持久化任务，消除同PID临时文件重叠导致的JSON损坏。
- 早期审批探针：把嵌套Electron临时数据与报告纳入本次隔离目录，在finally按归属回收；超期文件也清理继承输出管道。

策略固定测试17/0：清单外及混合失败不重跑、清单内仅一次、再次失败仍红、摘要记录、不存在的名称报错；文件期限结束自有进程树且后续文件继续。云端故意验证：[清单外必败红灯](cloud/fault-unlisted-red.json)、[清单内首次失败后恢复绿灯](cloud/fault-listed-green.json)。两种临时用例均在最终六轮之前删除。

本机 required 315文件1763通过／0失败／14既有跳过；vendor 33文件230通过／0失败／0跳过；相关18/0；固定17/0；类型检查通过；公开卫生0命中。非CI保持原Windows两文件并发与不重跑；vendor及夜间严格单次。名额起止时间保存在local-verification.json。

检查名称：旧 test (windows-latest) → test (windows-latest, shard 1/3)、2/3、3/3；旧 test (ubuntu-latest) → 同名Linux三片；旧 test (macos-latest) → test (macos-latest, shard 1/1)，仍仅按原手动／定时条件触发；新增阻断 Required unit tests (summary)。每片内部并发1，固定文件名哈希，不因新增文件移动旧文件。通过／失败／跳过数字仍见分片与总摘要。

遗留：15分钟目标未达到；Windows依赖准备（含每台新VM的Media Foundation）与顺序测试仍有开销，不能用原叶用例时间代替作业墙上时间。跨步骤后台安装实验失败已撤回，保留已验证的顺序安装。ROB-1两次历史功能失败（初始化退出74、重启值null）无确定根因，只补不含凭据的错误name/code；本机ia-2a测试工作进程曾0xC0000409退出，单文件复验通过，仍无重试例外。早期审批曾两次尝试均超期，六轮中恢复情况逐项公开。打包窗口／审批失败需后续查凭据初始化、运行时重启与审批投影，未改烟测预算。用户提到但原80轮未出现的NETWORK预算、3≠2计数、ROB-1 0xC0000409不据印象注册。安卓／苹果／云服务检查与DATA-1／SEC-1手机系统栏取证流程未改。真实模型请求0，未安装测试身份程序。

PR：[#242](https://github.com/memoweft/weftmate/pull/242)。

第6轮（38251122859）明确遗留：Windows tests/next-suggestions.test.ts 的 UX-7 account switch synchronizes across devices, isolates another account, and PATCH off truly aborts active provider 在 f.aborted 原断言 false≠true 后，清理未结束，600秒文件期限终止自有进程，后续文件继续；本片584通过／1失败／14跳过，未被重跑。macOS tests/bl-29-timing-sync.test.ts 到600秒文件期限，无完整叶用例退出结果，因此即使名称在清单内也不重跑；后续文件继续，1721通过／1失败／54跳过。Windows第1片最终1469秒（24分29秒），低于25分钟作业期限；总汇严格红灯。根因未唯一确定，不能把功能性abort失败登记为计时例外。

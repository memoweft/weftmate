# MEM-D · 日用记忆摄取诊断与修复

全部使用合成账号、隔离临时目录和随机端口。没有读取本人日用数据或操作日用程序，没有请求8081／18186，没有操作计划任务。公开记录中的合成目录路径会作占位替换；原始诊断保留在本包合成目录。

固定 DSH（助手运行时）为 `0.1.0-rc.5 / 47f9438`，`npm run vendor:verify` 通过；Core（记忆核心）只读固定到 FX-15（确认决定来源修复）合并提交 `85438df`。没有修改 Core、放宽确认编译或调整证据支持规则。

## 复现与根因

| 场景 | f787c3c | 开工主干 d93ffc11 | 修复后 |
|---|---:|---:|---:|
| 三会话六轮、路由始终有效、假本机单槽模型 | 6条Evidence（原始证据）／6条正式记忆 | 6／6 | 正常通路保持 |
| 五会话十轮，分别注入路由不可用、MEMORY_BUSY、摄取IPC（进程间通信）失败、Core退出 | 最终4／10送达 | 最终6／10送达 | 同类五会话20轮：20／20送达、20条正式记忆；含宿主重启 |
| MEMORY_BUSY解除后不发新请求，等2.5秒 | 只尝试1次，仍积压1条 | 同左 | 尝试2次，积压0条 |
| 用户原话20,000字符 | 不生成boundary（回合边界） | 同左 | 完整生成并通过宿主边界校验 |
| 假本机模型切换实际等待125秒 | 未另跑旧版此时长 | 未另跑旧版此时长 | 两轮都完成、2条Evidence／2条正式记忆 |
| 真实MiMo（小米模型服务），同类20轮故障与重启流程 | 未跑旧版MiMo矩阵 | 未跑旧版MiMo矩阵 | 20／20送达，20个作业均applied（已应用），20条正式记忆与逐字来源 |
| 3个历史会话×2轮，另加1个临时会话 | — | — | 预览3会话／6轮，确认／暂停／继续／取消／再次确认，最终6条；二次预览0轮，临时内容排除 |

对应原件：`before-f787c3c/`、`before-main/`、`faults-f787c3c/`、`faults-main/`、`queue-before-*.json`、`queue-after.json`、`final-synthetic/`、`final-mimo/`、`slow-switch/`、`final-backfill/`。目录里的 `results.json` 保留每轮终态、请求状态、队列、健康、摄取计数、最终数量及来源；截图来自真实Electron（桌面程序框架）和390×844远程手机网页。

已确认的代码原因与修法：

1. **先判路由、后入队**：宿主完成回合处理器原先在 `manager.ingest` 前调用 `memoryProcessingRouteForSession`，返回空就拒绝；插件的失败分支只吞掉异常。现在先在账户与冻结回合策略核对后写持久outbox（待提交队列），模型路由与进程状态不再决定是否保存边界。前台召回仍独立检查精确模型目的地权限。
2. **持久原生日志未用于恢复**：插件虽然写了“DSH回合可供重试”，实际没有恢复调用者。新增账户投递回执与原生边界分页；升级后新回合的IPC漏投、宿主重启窗口会自动恢复。游标在持久入队后推进，未结束回合跨页后完成仍可读回。升级前历史不自动跑。
3. **忙后没有定时重试，直接提交还能越过队列**：原队列主要在初始化时重放。现在每账户一个串行排空任务，失败按1／2／4／8／16／30秒退避，启动读取已有outbox；显式硬删除来源丢弃并计数，来源冲突仍阻断，不为成功率绕过遗忘／溯源规则。
4. **长可见原话被静默跳过**：原边界构造器直接跳过超过16,384字符的用户或助手消息。移除此截断判断并沿传输边界检查完整负载；不靠截断原话伪造支持。旧200条／8MiB队列硬上限移除。超出单帧能力的异常仍可见，原生日志保留供处理，没有宣称无限单帧支持。
5. **后台默认路线与当前聊天不一致**：f787c3c在无会话时回退到启动 `authRef`，BL-9已记录。开工主干已有当前聊天模型选择修复，本包保留。另将本机形成改成账户独立凭据的稳定调度入口；每次等待／让位后重新选当前已授权本机模型和凭据。不会为了后台工作切回旧模型，不能借此把本机证据发送给云端。
6. **模型变化重建Core，打断正在形成的作业**：真实MiMo开发运行观察到被打断作业的5分钟原生租约。稳定本机路线消除同一入口换模型引起的进程重建；暂时选不出本机路线也保留受宿主调度约束的现有进程。真正的宿主／Core重启仍遵守Core原生租约恢复，不擅自改数据库或压短租约。

排除的猜测：`restoreInternalRoute=false`本身不会使 `sessionModelBinding` 返回空；两版本getter（读取函数）都仍读出profileId。`routeReady`来自Core是否构造出调用路线，不是上游HTTP可用性；有完整模型、地址和凭据时，换模型或503不应把它解释成永久未配置。现在健康同时展示宿主待提交数、Core待形成／失败数及模型等待状态，无法获取时也不伪装成空记忆。

**日用归因的边界**：没有读取私人日用日志，所以这些是合成可复现的丢失路径，不是声称逐条还原本人两周的每次失败。正常六轮两版本均成功，也证明“使用本机单槽”本身不足以解释全部缺失。

## 历史整理与客户端

CLIENT_API（客户端接口契约）第11节新增 `GET/POST /memory/backfill`；预览只返回数量和粗略词元估算，不调用形成模型。确认后按时间提交；重复提交沿原边界身份和账户回执去重，并排除Core已接受的边界。每步重新核对临时／关闭记忆／已遗忘状态。暂停、取消停止后续提交，已提交的作业继续形成，界面明说这一点。

记忆页顶部与设置健康项共用可读状态；Windows（视窗系统）程序、远程手机网页及Android（安卓）界面包已接。安卓现有记忆业务桥可承载新端点，无新增权限。Apple（苹果端）需接健康字段、预览／确认与任务控制；旧客户端兼容。迁移当天先确认健康正常、队列无积压，再由本人决定是否整理历史。

## 验证与重跑

```powershell
node --test tests/personal-memory-ingestion.test.ts tests/personal-memory-outbox.test.ts tests/model-scheduler.test.ts
node tests/integration/mem-d-queue-probe.mjs . tests/evidence/mem-d/queue-after.json
node tests/integration/mem-d-daily.mjs --faults --restart --verify --groups 5 --turns 4 --out tests/evidence/mem-d/final-synthetic
node tests/integration/mem-d-daily.mjs --model mimo --faults --restart --verify --groups 5 --turns 4 --out tests/evidence/mem-d/final-mimo
node tests/integration/mem-d-daily.mjs --slow-switch --verify --groups 2 --turns 1 --out tests/evidence/mem-d/slow-switch
node tests/integration/mem-d-daily.mjs --backfill --verify --groups 3 --turns 2 --out tests/evidence/mem-d/final-backfill
```

运行器默认Core源码是本包只读临时工作树，可通过 `--core <py/src>` 指向固定85438df；`--repo`用于隔离旧版工作树，复用已校验的依赖。测试钩子只注入路由／IPC／进程忙与离线，不生成正式记忆。历史测试先暂停实时投递，生成合成历史后设置升级接入时点，模拟已有旧会话；正式形成仍走真实宿主和Core。MiMo从机器环境读取密钥，仅在进程内使用；用量见 `usage-total.json`，含失败和重跑，不把缺用量当免费。

相关测试、类型检查、固定依赖检查与真实Core观察／纠正／近期原话集成均通过；完整单测和Observed bridge（真实核心集成）交PR的CI（持续集成）。`related-tests.txt`、`scheduler-tests.txt`、`ui-tests.txt`、`core-integration.txt`保留专项结果。设计检测器唯一警告在手机既有引用样式，未修改该无关样式。

开发失败保留：`backfill-synthetic/`的默认Playwright浏览器缺失，改用系统Edge；`verified-synthetic/`手机登录重载后未等界面绑定完成，后续等待可见页面修复；`verified-mimo/`宿主重启后评测凭据仍指向旧随机端口，后续更新评测入口修复。早期 `after-mimo/`在恢复完成前取样并关闭，16条不冒充最终结果。早期真实重启留下的Core作业等待原生租约，最终运行等到全部applied。未用成功目录覆盖失败目录。

这些运行发生在开发工作树，`revision`是启动时HEAD（当前提交），不代表当时无未提交改动。之后的账户凭据隔离、游标分页和主干合并另有专项／合并后验证，最终以PR提交的CI为准。没有做日用迁移、长期浸泡或修改本人模型配置。

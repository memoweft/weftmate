未解决：历史及续做首轮 Node（JavaScript 运行环境）0xC0000409 原生触发原因仍未查清；Linux vendor（固定运行时集成组）的1031–1033毫秒关闭已定位为释放后仍持有IPC并补修，真实Linux结果等待云端复验；Windows打包一次文件夹注册MIGRATION_SMOKE_TIMEOUT未查清（后续同源码检查通过）；中继业务86.94秒通过但收尾330秒超时，真实收尾仍待云端复验；上一会话最终 required（必过单测组）的一次 N4 失败缺少端名和变化类别，不能确定具体触发条件。确定的账户通知问题、正文竞态和父层进程清理缺口已修，以下逐项区分修复与证据边界。

BL-29c 沿用 [PR（合并请求）#208](https://github.com/memoweft/weftmate/pull/208)，分支 wp/bl-29-quiet-when-idle，最终验证的产品／测试源码提交为 `af36919db03b19a9d1cef08023d295247a078c8b`，证据交付提交见PR。本包中途续做过一次；续做先将上一会话全部进度提交并推送为 df7ae848，再合 origin/main（主线）、完成下列重新验证。此前未提交的改动保留，没有重写产品机制。所有运行使用合成账号、宿主、模型、随机端口与专属临时目录，真实模型请求 0；未访问 8081／18186／16384、本人日用数据、保管库、MuMu（安卓模拟器）或本人桌面。共享 vendor（固定运行时构建）未修改。

| 项 | 根因 | 做法 | 审查脚本／修前数字（rev-bl29b.result.md） | 续做后修后数字 | 固定测试名 | 是否修好 |
| --- | --- | --- | --- | --- | --- | --- |
| N1 | 指纹直接摘要全部后端目录，且提交水位全宿主共享 | /models 与通知共用 visibleModels 完整可见投影；账户域 HMAC（带密钥的消息认证码），修订与唤醒按账户隔离 | model-scope.mjs：四值 false/true/true/true，修订9→10 | 四值 false/true/false/false；修订10→10；已知候选摘要两项均不匹配 | BL-29c N1/N4 public model projection is scoped, domain keyed and covers account display name/revision；N1 an unrelated account commit cannot wake this account subscriber | 已修好 |
| N2 | 最后正文查询后新增异步目录间隙，正文代次不再核验 | 全部异步工作完成后同步核验聊天存在、内容代次及设备身份 | catalog-generation.mjs：200，旧代次1／当前2，旧正文返回 | 409，旧合成正文返回=false | BL-29c N2 final catalog gap cannot return a retired body generation | 已修好 |
| N3 | 目录等待不服从取消域，目录拒绝把已读取正文变成503 | 每请求取消竞速；共享目录服从关闭；拒绝省略models标记，正文照常返回 | catalog-close.mjs、account-probe.mjs：3002／3001毫秒，fetch failed；目录拒绝正文503 | 两关闭场景3／1毫秒，均503 SERVICE_CLOSING；目录拒绝正文200；目录间隙注销401 | BL-29c N3 catalog close during snapshot and after a real commit wake drains 503, logout reauth remains；N3 cancellation during shared catalog read removes each HTTP request listener；N3/mixed revision catalog failure preserves body and catalog snapshot keeps its starting revision | 已修好 |
| N4 | 原始目录摘要不含账户显示名及账户模型修订 | 共用完整公开投影；目录／设置／个性化／列表分别提交并在真实两端观察 | model-scope.mjs、ui-extra.mjs：改名摘要全不变；电脑33063／手机30584毫秒 | 仅models标记变化；三遍五类独立同步全部≤154毫秒；逐项数字见下表，联合配置最慢1801毫秒 | BL-29c N4 real Electron and mobile independently sync catalog, settings, personalization, rename and list within 7s | 功能验证通过；历史偶发触发条件未确定 |
| N5 | 驱动异常时探针finally无法执行，父层没有专属目录／进程所有权 | 父层预建weftmate-*根；每格Electron（桌面程序框架）入口立即登记PID（进程标识）、创建时间及目录；父层三重核对整组收尾，记录原退出码十进制／十六进制、阶段、提交内存与TCP（传输控制协议）概况 | 退出探针及父层监督：审查3轮2次异常，各遗留5个Electron | 最终vendor五格、强制终止与父层超时三用例均通过，协议与时间断言不变；具体数值见vendor/run.log | BL-29b M5 real tray/update shutdown and both runtime orders drain protocol waits；BL-29c N5 parent cleans the whole owned Electron set when the driver is terminated after first window；N5 parent deadline cleans owned children without retrying or changing product limits | 清理缺口已修好；原生触发原因未查清 |
| 修订混合竞态 | 目录始于修订13，完成时却采用最新修订14 | 目录与纯账户字段同时绑定读取开始快照 | account-probe.mjs::mixedRevision：旧目录标14，同14随后摘要又变 | 旧目录13→13；新目录14，模型标记不同 | BL-29c N3/mixed revision catalog failure preserves body and catalog snapshot keeps its starting revision | 已修好 |
| S4 | 每次全量序列化账户字段，暖缓存仍重复散列 | 按账户及提交修订记忆化，不用新包装对象作WeakMap（弱引用映射）键；保留深度冻结写路径检查 | account-probe.mjs、frozen-state.mjs：500／2000会话p50（中位数）0.718／4.064毫秒 | 500／2000会话p50 0.0009／0.0010毫秒；暖读250次新增散列0，提交后1；深度冻结7步通过 | BL-29c S4 warm snapshots hash once per account revision, including a fresh wrapper on every read；S4 deep frozen committed fingerprint fields remain immutable across real read/write/close paths | 做了，已验证 |
| S5 | 向下抖动再被1500毫秒下限截平 | 在下限以上直接抖动，保留请求频率与1750毫秒上限 | policy-probe.mjs：7个随机值首轮全1500毫秒 | 首轮1500/1525/1575/1625/1675/1725/1750毫秒；全宿主原探测上限仍明确29999毫秒 | BL-29c S5 first retry jitters directly above the old request floor without extending the recovery cap | 做了，已验证 |
| S6 | 只数网络请求，零延迟空转仍绿 | 保留总请求、恢复、后台预算，增加实际执行次数及失败后计时器延迟断言 | make-mutation.mjs、zero-browser.mjs：单变异1/0仍绿；真实3秒694次调度／2次changes | 单延迟变异被600次调度／30秒击红；完整风暴仍被600次changes／30秒击红，原断言不变 | BL-29c S6 zero-delay-only and full request-storm mutations both fail the production mobile budget；手机BL-29b full empty logical main用例 | 做了，已验证 |

续做后的三遍真实两端独立同步，7秒断言原样保留：

| 轮次 | 变化 | 电脑毫秒 | 手机毫秒 |
| --- | --- | --- | --- |
| 1 | modelSettings | 55 | 41 |
| 1 | personalization | 57 | 37 |
| 1 | modelCatalog | 68 | 43 |
| 1 | modelRename | 68 | 44 |
| 1 | sessionList | 107 | 74 |
| 2 | modelSettings | 82 | 63 |
| 2 | personalization | 77 | 45 |
| 2 | modelCatalog | 100 | 67 |
| 2 | modelRename | 95 | 68 |
| 2 | sessionList | 154 | 95 |
| 3 | modelSettings | 57 | 42 |
| 3 | personalization | 57 | 36 |
| 3 | modelCatalog | 80 | 61 |
| 3 | modelRename | 81 | 50 |
| 3 | sessionList | 133 | 86 |

原失败证据保留在 final/required.log 与 final/required.json：1458通过／1失败，用例总时长29612.8848毫秒，原始错误为 page.waitForFunction: Timeout 7000ms exceeded.。原固定测试临时报告已被删除，原日志没有端名、变化类别或等待时点，无法补造现场。续做占名额后 ui-extra 三遍通过；新增N4按仓库真实Electron集成测试惯例登记到 .github/vendor-test-suite.json，属于独立阻塞组，完整bl-29-rework.test.ts在vendor运行，兄弟断言仍执行。只有此新增用例在required选择阶段转组；未改7秒、删除用例或增加产品故障重试。用例新增结构化诊断，今后失败与成功均保留类别、端名和耗时。分组选择固定测试13项相关检查通过。历史失败不能仅凭三遍绿灯归因于负载。

账户提交晚于原生审批／提问帧的补读修复保留：每次账户修订改变重新核对权威决策及其源任务，不沿用持久登记前的空读取。固定测试为 BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s，四项均保留2秒上限。

续做云端检查另发现确定的准备缺口：Linux required为1480通过／3失败，vendor为211通过／7失败／1既有环境跳过；浏览器用例报Chromium可执行文件不存在，退出三用例在启动前报origin/main...HEAD不存在。提交4e49ed8d给ci.yml及vendor-tests.yml补齐浏览器安装与完整Git历史，原失败摘录保存在resumed/cloud-failure-excerpts.json，未修改产品／测试源码、失败断言或本地运行中的快照。最终云端状态在.done后的检查附录报告，不把历史失败称为已验证绿灯。

本次续做首轮required完整运行1511通过／1失败：BL-29b M2/M3 HTTP race探针在2162.0536毫秒后以3221226505／0xC0000409原生终止，stdout（标准输出）与stderr（标准错误）为空，未到产品断言。原始日志及摘要保存为required-initial.log/json；事后内存69.5／97.8GB、316条已建立TCP连接，不冒充崩溃瞬间；14:39–14:43未查到匹配的Application（应用程序）1000/1001或System（系统）2004/4227。独立审查脚本随后通过，固定用例明确单独诊断3遍均1/0通过；仍未查清原生触发原因。9349aeff只补该探针包装的退出码／信号／原生报告诊断，原功能和时间断言不变。手工诊断后再执行完整required-final，首轮失败始终保留，不存在自动重试到绿的代码。

本次续做重新跑的完整门禁、重活名额和起始时刻：

| 执行 | 通过 | 失败 | 退出码 | 秒 | 名额／起始UTC（协调世界时） |
| --- | --- | --- | --- | --- | --- |
| approval-10 | 场景通过，见内层记录 | 0 | 0 | 154.962 | 单文件轻活／2026-10-11T06:31:13.608Z |
| scheduler-mutations | 1 | 0 | 0 | 4.890 | 单文件轻活／2026-10-11T06:37:59.631Z |
| required | 1511 | 1 | 1 | 1190.525 | D:\AIProjects\WeftMate\Runtime\Orchestrator\heavy-3.lock／2026-10-11T06:39:49.741Z |
| http-race-diagnostic | 场景通过，见内层记录 | 0 | 0 | 5.295 | 单文件轻活／2026-10-11T07:00:18.887Z |
| http-test-1 | 1 | 0 | 0 | 5.743 | 单文件轻活／2026-10-11T07:01:19.070Z |
| http-test-2 | 1 | 0 | 0 | 5.599 | 单文件轻活／2026-10-11T07:01:24.814Z |
| http-test-3 | 1 | 0 | 0 | 5.705 | 单文件轻活／2026-10-11T07:01:30.415Z |
| cancel-stress-final | 场景通过，见内层记录 | 0 | 0 | 122.402 | 单文件轻活／2026-10-11T07:04:54.898Z |
| posix-ipc-close | 场景通过，见内层记录 | 1 | 1 | 372.688 | 单文件轻活／2026-10-11T07:32:15.504Z |
| posix-ipc-close-fixed | 12 | 0 | 1 | 17.721 | 单文件轻活／2026-10-11T07:38:28.602Z |
| required-final | 1512 | 0 | 0 | 1245.073 | D:\AIProjects\WeftMate\Runtime\Orchestrator\heavy-3.lock／2026-10-11T07:21:36.134Z |
| posix-ipc-close-final | 13 | 0 | 0 | 7.901 | 单文件轻活／2026-10-11T07:42:16.733Z |
| vendor | 219 | 0 | 0 | 448.656 | D:\AIProjects\WeftMate\Runtime\Orchestrator\heavy-3.lock／2026-10-11T07:42:21.209Z |
| mobile | 111 | 0 | 0 | 48.626 | D:\AIProjects\WeftMate\Runtime\Orchestrator\heavy-3.lock／2026-10-11T07:49:49.866Z |
| approval-1 | 1 | 0 | 0 | 15.626 | 外层stream-repeat名额或审批单文件 |
| approval-2 | 1 | 0 | 0 | 15.367 | 外层stream-repeat名额或审批单文件 |
| approval-3 | 1 | 0 | 0 | 15.481 | 外层stream-repeat名额或审批单文件 |
| approval-4 | 1 | 0 | 0 | 15.463 | 外层stream-repeat名额或审批单文件 |
| approval-5 | 1 | 0 | 0 | 15.534 | 外层stream-repeat名额或审批单文件 |
| approval-6 | 1 | 0 | 0 | 15.505 | 外层stream-repeat名额或审批单文件 |
| approval-7 | 1 | 0 | 0 | 15.435 | 外层stream-repeat名额或审批单文件 |
| approval-8 | 1 | 0 | 0 | 15.503 | 外层stream-repeat名额或审批单文件 |
| approval-9 | 1 | 0 | 0 | 15.494 | 外层stream-repeat名额或审批单文件 |
| approval-10 | 1 | 0 | 0 | 15.468 | 外层stream-repeat名额或审批单文件 |

最终required与vendor的计数以resumed/required-final.json、vendor.json为准；vendor按本次用户减量要求续做1遍，另2遍交审查，历史vendor三遍记录保留但不冒充最终源码复验。续做手机交互五文件全部运行；审批10遍的最终结果在resumed/repeat/。stream-1b-interactions.mjs和stream-1b-timeline.mjs --budgets上一会话各3遍通过的记录保留，续做末轮各1遍已在.done后复验通过并追加；最终源码各3遍没做；依本次90分钟及减量交付要求明确区分，不冒充最终源码三遍。类型检查、公开卫生0命中，node apps/mobile-ui/src/build-ui-core.mjs生成后受管手机资产无差异。最终重活批次只占一个名额并在finally（退出清理）释放；未删除别人锁或占用超30分钟。

不许退步项：M1八类立即失败电脑≤3次／4.5秒、手机≤2次／3秒；正文端点恢复≤2秒（全宿主故障仍是既有最长30秒探测）。M2续做直接0毫秒、HTTP竞态30毫秒，三读者三排列19／18／20毫秒，账户／原生等待均0；M3首读取消20次等待余数0，上一会话2分钟1000次取消余数0。M5真实五格在最终vendor重新执行，网关503、关闭时间保持原断言。S1原50／200毫秒延迟保护在required／vendor重新执行；续做三遍500毫秒场景改名最慢1611毫秒、前台恢复最慢836毫秒。之前全请求普查电脑86／61.003秒=1.410次／秒、手机106／61.010秒=1.737次／秒，含30秒配置兜底；后台0请求，最终时间线与流式交互重复组另保留首字≤250毫秒、后台预算、11弹层与中文组合输入断言。详细数值见原README及续做报告，历史证据不冒充所有场景都续做重跑。

Apple（苹果端）接线清单：

- accountChanges.revision在当前宿主进程内按账户隔离；标记只比较相等性，不重算、不跨账户比较；宿主重启接受新水位与标记。
- models可选，缺失保留此前标记；名称、状态与账户模型修订变化都重读目录，继续30秒兜底。
- 目录失败的200正文正常接纳；最终代次409重建游标，设备401停止；SERVICE_CLOSING进入连接恢复。
- 只有正常changed／timeout立即续订；失败1500–1750毫秒抖动，禁止零延迟空转；401停止、404清源、持续409只一次尾页重建。
- 本账户提交水位推进时补读当前权威审批／提问及源任务，覆盖原生事件先到、持久登记晚到。
- 后台撤销等待，前台并行恢复正文、决策与概览。无新路由、权限、壳版本；Apple原生接线、编译及真机由苹果端包验收。

Linux退出超时的后续根因已定位：云端三种退出为1078／1083／1099毫秒，两种显式运行时关闭均1037毫秒；宿主服务只1–4毫秒，DSH原生关闭1031–1033毫秒。bootstrap（子进程启动入口）在持久化释放后保留IPC（进程间通信）；SIGTERM（终止信号）处理只重复既有释放，因此始终触发原1秒兜底。补修为POSIX（类Unix系统）收到disposed回执后保持IPC并收尾已释放根进程；未确认释放仍保留原SIGTERM／1秒强杀兜底，Windows进程树收尾不变，未改共享vendor。新增固定协议用例验证释放回执→保持IPC→收尾根进程，生命周期整文件13/0通过，真实Linux退出由云端阻塞vendor验证。此前强制在Windows真进程上走POSIX信号语义的夹具出现卡住／超时，原记录保留，后改为便携协议顺序验证；现有真实Windows进程树用例原样保留。Windows完整required在本轮运行中已执行旧生命周期文件；新增POSIX协议用例另用整文件13/0补验，明确不冒充它已包含在1512计数中。

Windows打包云端另一次失败：包内容／身份／凭据／用户数据卫生均0命中，安装版主对话合成首发成功；文件夹注册等待报MIGRATION_SMOKE_TIMEOUT（installed-smoke.mjs:75），清理无残留。摘录保留，本包未修改该入口或放宽其时限；最新状态见最终云端检查。

未做：Apple真机／原生编译、安卓系统栏、生产中继全链、完整物理遗忘流水线、系统锁屏／睡眠、更新安装器及安装后重启。原生快速失败未抓到原生栈，仍不宣称消除了所有系统原生异常。上一会话登记数0/5与未改动weftmod原生异常均保留原始失败日志，没有自动重试到绿。

清理结果与.done之后合主线复验、云端检查另附；正常fixture（测试夹具）关闭不算额外强制清理，N5故障注入的父层清理按最终vendor诊断实数汇总。


.done之后的合主线复验与补充：

- 15:53写.done后fetch及merge origin/main，已是最新；定向账户通知及DSH（助手运行时）生命周期22通过／0失败／0跳过，重建手机51项共享资产后整个工作区无差异。
- 流式交互末轮104.973秒、时间线预算末轮77.199秒，均0失败；电脑／手机各11项弹层与中文组合输入保留，systemBarsVerified=false（未验原生系统栏）。最终源码各3遍没做；上一会话各3遍记录仍保留。
- 后续云端中继报告业务场景passed=true，86.94秒完成首次输入、3次审批、文件内容和成果预览，但外层在330秒、任务在6分钟因收尾超时而失败。原报告摘要保存为cloud-relay-teardown.json，不能把场景通过冒充整个检查通过。
- 先前POSIX断开IPC让根进程自然退出的方案已撤掉；31902668改为原生持久化释放已确认后保持IPC直到收尾根进程，未确认仍保留旧SIGTERM／1秒兜底，Windows路径不变。便携协议用例确认drain→drained→SIGKILL及IPC保持，生命周期13／0、类型检查通过；实际Linux性能及中继完整收尾待云端验证，未宣称已解决。
- 本包额外清理进程8，剩余0；首次组合计算路径强制清理被自动审批拒绝，后逐个明确绝对路径非强制删除两条夹具目录成功。

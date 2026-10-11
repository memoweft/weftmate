# BL-29c · 第二次审查返工证据

沿用 [PR #208](https://github.com/memoweft/weftmate/pull/208)，只收敛 N1–N5、修订混合竞态与 S4–S6。修前审查数字来自 REV-BL29b 全文，本树修前脚本输出保存在 `before/`。修后是本轮工作树实测；交付提交见PR及编排结果。只用合成账户、宿主、模型和随机端口，真实模型请求0。

本包中途续做过一次。下文保留上一会话的开发记录；最终门禁、续做后的三遍独立同步、逐项根因与修复结论，以 [续做交付证据](resumed/README.md) 为准。上一会话 `final/required.json` 的1458通过／1失败与原始超时日志仍保留，不能用此前成功记录覆盖它。

| 项 | 修之前 | 修之后 | 复现与固定测试 |
| --- | --- | --- | --- |
| N1 | 审查与本树修前：四项 false / true / true / true；本账户修订 9→10 | 四项 false / true / false / false；修订 8→8；普通 SHA-256（安全散列算法）候选重算不匹配 | `model-scope.mjs`；`bl-29-account-changes.test.ts` 的 N1/N4 与跨账户等待用例 |
| N2 | 200，返回代次1／当前代次2，含旧合成正文 | HTTP（网络协议）409，未发出旧合成正文 | `catalog-generation.mjs`；N2 final catalog gap |
| N3 | 3002／3001毫秒，均 fetch failed；目录拒绝使正文503 | 2／2毫秒，均503 SERVICE_CLOSING；目录拒绝正文200；目录期间注销401 | `catalog-close.mjs`、`account-probe.mjs`；N3关闭／取消／目录失败用例 |
| N4 | 改名四摘要不变；审查电脑33063／手机30584毫秒 | 仅 models 标记变化；改名电脑／手机 55 / 43 毫秒；下表五种独立变化均≤7秒 | `model-scope.mjs`、`ui-extra.mjs`；N4 real Electron and mobile independently sync |
| N5 | 审查3组中2组 Node（JavaScript运行环境）驱动以3221226505／0xC0000409终止，各留5个Electron（桌面程序框架） | 父层预建 weftmate-* 根；Electron入口登记真实PID（进程标识）／创建时间／目录；父层以时间、可执行文件、目录核对整组收尾；正常五格、强制终止与超时记录见各vendor日志 | `bl-29-runtime-close.test.ts` 三用例；`exit-entry.mjs`／`exit-supervisor.mjs`／`owned-processes.ps1` |
| 修订混合竞态 | 旧目录始于13，最后被标为14；同修订14随后摘要又变 | 旧目录标为13，新目录为14；账户字段同样来自开始时快照 | `account-probe.mjs::mixedRevision`；N3/mixed revision |
| S4 | 审查500／2000会话p50 0.718／4.064毫秒；本树修前0.6825／3.5916毫秒，每读序列化481478／1929974字节 | 500会话 p50（中位数）0.0009／p95（第95百分位）0.0018毫秒；2000会话 p50（中位数）0.0010／p95（第95百分位）0.0014毫秒；暖读250次新增会话散列0；真实提交后新增1；深度冻结7步通过 | `account-probe.mjs`、`frozen-state.mjs`；S4 warm snapshots／deep frozen用例 |
| S5 | 七个随机值首轮均1500毫秒 | 首轮 1500, 1525, 1575, 1625, 1675, 1725, 1750 毫秒；后续仍在1500–1750范围 | `policy-probe.mjs`；S5 first retry jitters |
| S6 | 审查与本树修前：只改续订为0仍1／0通过；审查真实浏览器3秒694次调度、2次changes | 同一单延迟变异被600次调度／30秒击红；完整风暴变异仍被600次changes／30秒击红；生产断言保留请求总量、恢复与隐藏预算，并新增实际执行数／计时器延迟断言 | `make-mutation.mjs`、`zero-browser.mjs`；`bl-29-scheduler-mutation.test.ts`；手机完整空主对话用例 |

公开 `/models` 与失效标记复用 `account-models.mjs::visibleModels` 的同一完整可见投影；HMAC（带密钥的消息认证码）使用进程随机密钥及账户／字段域。修订与缓存按账户隔离，纯账户字段按提交修订记忆化，未使用每次新建的账户包装对象作 WeakMap（弱引用映射）键。目录失败省略本次 `models` 标记，客户端保留此前标记；正文一致性与设备鉴权在全部异步工作后同步核验。

四类配置／列表及模型改名各自提交并观测，电脑是实际Electron窗口；手机是实际交付网页，在390×844 Chromium（浏览器引擎）中运行，不计为原生手机／真机系统栏验收。

| 独立变化 | 电脑毫秒 | 手机毫秒 |
| --- | --- | --- |
| modelSettings | 45 | 44 |
| personalization | 38 | 33 |
| modelCatalog | 54 | 44 |
| modelRename | 55 | 43 |
| sessionList | 113 | 89 |

上一会话门禁与重复执行记录（历史失败另列，续做后的最终记录见上方链接；同一条命令的日志与JSON〔结构化数据〕对应）：

| 执行 | 秒 | 通过 | 失败 | 退出码 |
| --- | --- | --- | --- | --- |
| required | 1111.084 | 1458 | 0 | 0 |
| vendor-registration-failure | 211.756 | 206 | 1 | 1 |
| vendor-pre-native-abort-1 | 200.001 | 207 | 0 | 0 |
| vendor-pre-native-abort-2 | 213.286 | 207 | 0 | 0 |
| vendor-native-abort | 206.642 | 206 | 1 | 1 |
| vendor-1 | 198.920 | 207 | 0 | 0 |
| vendor-2 | 207.299 | 207 | 0 | 0 |
| vendor-3 | 197.594 | 207 | 0 | 0 |
| approval-1 | 14.962 | 1 | 0 | 0 |
| approval-2 | 14.995 | 1 | 0 | 0 |
| approval-3 | 15.003 | 1 | 0 | 0 |
| approval-4 | 14.989 | 1 | 0 | 0 |
| approval-5 | 14.998 | 1 | 0 | 0 |
| approval-6 | 15.068 | 1 | 0 | 0 |
| approval-7 | 15.021 | 1 | 0 | 0 |
| approval-8 | 15.104 | 1 | 0 | 0 |
| approval-9 | 15.009 | 1 | 0 | 0 |
| approval-10 | 15.067 | 1 | 0 | 0 |
| mobile-1 | 39.738 | 111 | 0 | 0 |
| mobile-2 | 40.064 | 111 | 0 | 0 |
| mobile-3 | 43.662 | 111 | 0 | 0 |
| interactions-1 | 104.280 | 场景通过 | 0 | 0 |
| interactions-2 | 104.420 | 场景通过 | 0 | 0 |
| interactions-3 | 103.752 | 场景通过 | 0 | 0 |
| timeline-1 | 75.275 | 场景通过 | 0 | 0 |
| timeline-2 | 75.435 | 场景通过 | 0 | 0 |
| timeline-3 | 75.539 | 场景通过 | 0 | 0 |

两次开发门禁失败均保留：`vendor-registration-failure.*` 为206／1，真实五格协议与时间断言通过，但登记数0／5。根因为 Playwright（界面自动化框架）在Windows使用带引号的shell（命令解释器）命令，外层启动钩子既未匹配命令，也不代表真实Electron进程；已改为程序入口立即登记自身进程。`vendor-native-abort.*` 为206／1，未改动的weftmod-plugin测试进程以3221226505／0xC0000409原生终止。隔离诊断13／0，故障时段无匹配的Application（应用程序）1000/1001、System（系统）2004/4227记录；原生触发原因未查清。`vendor-native-abort-resources.json` 为事后资源采样，不冒充故障瞬间。按要求暂停后继续验证，未自动重试、删用例、增加skip（跳过）或放宽断言。最初移入脚本时的createRequire相对路径、两条新测试缺省个性化字段、变异子测试继承NODE_TEST_CONTEXT的夹具问题均已修正；不是产品错误或系统异常。

vendor-1 真实退出五格：

| 动作 | 退出毫秒 | 宿主关闭毫秒 | 运行时关闭毫秒 | 等待结果 |
| --- | --- | --- | --- | --- |
| window-tray-exit | 390 | — | — | 退出码0 |
| tray-exit | 355 | — | — | 退出码0 |
| update-restart | 383 | — | — | 退出码0 |
| runtime-first | 138 | 3 | 229 | 503 SERVICE_CLOSING |
| access-first | 122 | 4 | 209 | 503 SERVICE_CLOSING |

| 父层故障场景 | 原退出码／信号 | 最后阶段 | 核对／额外终止数 | 残留 |
| --- | --- | --- | --- | --- |
| exit-driver-killed | None / None / SIGKILL | first-window | 5 / 3 | 0 |
| exit-driver-timeout | None / None / SIGKILL | first-window | 5 / 3 | 0 |

vendor-2 真实退出五格：

| 动作 | 退出毫秒 | 宿主关闭毫秒 | 运行时关闭毫秒 | 等待结果 |
| --- | --- | --- | --- | --- |
| window-tray-exit | 405 | — | — | 退出码0 |
| tray-exit | 353 | — | — | 退出码0 |
| update-restart | 343 | — | — | 退出码0 |
| runtime-first | 126 | 3 | 210 | 503 SERVICE_CLOSING |
| access-first | 117 | 4 | 234 | 503 SERVICE_CLOSING |

| 父层故障场景 | 原退出码／信号 | 最后阶段 | 核对／额外终止数 | 残留 |
| --- | --- | --- | --- | --- |
| exit-driver-killed | None / None / SIGKILL | first-window | 5 / 2 | 0 |
| exit-driver-timeout | None / None / SIGKILL | first-window | 5 / 3 | 0 |

vendor-3 真实退出五格：

| 动作 | 退出毫秒 | 宿主关闭毫秒 | 运行时关闭毫秒 | 等待结果 |
| --- | --- | --- | --- | --- |
| window-tray-exit | 389 | — | — | 退出码0 |
| tray-exit | 384 | — | — | 退出码0 |
| update-restart | 347 | — | — | 退出码0 |
| runtime-first | 130 | 2 | 202 | 503 SERVICE_CLOSING |
| access-first | 132 | 4 | 268 | 503 SERVICE_CLOSING |

| 父层故障场景 | 原退出码／信号 | 最后阶段 | 核对／额外终止数 | 残留 |
| --- | --- | --- | --- | --- |
| exit-driver-killed | None / None / SIGKILL | first-window | 5 / 4 | 0 |
| exit-driver-timeout | None / None / SIGKILL | first-window | 5 / 2 | 0 |

probe-desktop-errors 八类立即失败（恢复指正文端点恢复；全宿主不可用有既有最长30秒探测）：

| 错误 | changes次数 | 观测秒 | 恢复至等待毫秒 |
| --- | --- | --- | --- |
| NOT_FOUND | 1 | 4.5 | 停止 |
| SESSION_ARCHIVED | 3 | 4.501 | 998 |
| BACKEND_UNAVAILABLE | 3 | 4.5 | 999 |
| CURSOR_RESET_REQUIRED | 3 | 4.5 | 999 |
| UNAUTHORIZED | 1 | 4.501 | 停止 |
| NETWORK | 3 | 4.501 | 999 |
| HTTP_502 | 3 | 4.5 | 1000 |
| HTTP_504 | 3 | 4.5 | 1000 |

probe-browser 八类立即失败（恢复指正文端点恢复；全宿主不可用有既有最长30秒探测）：

| 错误 | changes次数 | 观测秒 | 恢复至等待毫秒 |
| --- | --- | --- | --- |
| NOT_FOUND | 1 | 3.0 | 停止 |
| CHAT_ARCHIVED | 1 | 3.001 | 94 |
| BACKEND_UNAVAILABLE | 1 | 2.999 | 160 |
| CURSOR_RESET_REQUIRED | 1 | 3.002 | 236 |
| UNAUTHORIZED | 1 | 3.001 | 停止 |
| NETWORK | 1 | 3.001 | 120 |
| HTTP_502 | 1 | 3.001 | 130 |
| HTTP_504 | 1 | 3.003 | 101 |

probe-race 原始结构化结果见 `probe-race/race.json`。

probe-http-race 原始结构化结果见 `probe-http-race/http-race.json`。

three-readers 原始结构化结果见 `three-readers/three-readers.json`。

probe-latency 原始结构化结果见 `probe-latency/latency.json`。

首读取消20次与2分钟1000次取消均保留。1000次实测 120010 毫秒，账户／原生等待、关闭监听、等待定时器均0；显式GC（垃圾回收）后的首／末采样堆内存 20.44／16.52 MiB（二进制兆字节），RSS（进程驻留内存）96.79／143.81 MiB。不把RSS波动称为完全不变。

请求普查包含全部桥方法／界面HTTP及30秒配置兜底；不含手机原生后台通知或DSH内部请求。

| 端 | 窗口 | 秒 | 总请求 | 每秒 |
| --- | --- | --- | --- | --- |
| electron | foreground-idle | 61.003 | 86 | 1.410 |
| mobile | foreground-idle | 61.01 | 106 | 1.737 |

保留项 M2／M3：直接漏唤醒 0 毫秒、HTTP 30 毫秒（含固定30毫秒观察窗）；首读取消20个请求后账户／原生等待均0；入口已取消 0 毫秒。

| 读者排列 | 毫秒 | upserts（增量条目） | 账户／原生等待 |
| --- | --- | --- | --- |
| native-first | 13 | 1/1/1 | 0/0 |
| commit-first | 12 | 1/0/1 | 0/0 |
| same-turn | 11 | 1/1/1 | 0/0 |
commit-first 的第二读者在原生事件前被提交唤醒，空增量合法，后续立即续订；不把它当作漏消息。

S1的50／200毫秒传输延迟保护：

| 场景 | 额外延迟毫秒 | 电脑／手机或单端毫秒 |
| --- | --- | --- |
| rename  | 50 | 258/197 |
| foreground desktop | 50 | 103 |
| foreground mobile | 50 | 100 |
| rename  | 200 | 285/1304 |
| foreground desktop | 200 | 297 |
| foreground mobile | 200 | 287 |

退避期间真实点发送：

| 端 | 到合成后端毫秒 | 回复可见毫秒 |
| --- | --- | --- |
| desktop | 71 | 1854 |
| mobile | 97 | 1852 |

把既有连接策略推进到封顶后让全宿主读取503，再恢复：29038／6331毫秒。它是封顶策略实验，不声称经历了数分钟真实停机；两端关闭状态connecting（正在连接），无正文错误／错误toast（临时提示）。

真实浏览器单零延迟变异：3001毫秒内690次实际调度，仅2次changes。新增固定调度断言捕获这种空转；600／30秒是50毫秒步长虚拟时钟数据，不冒充真实峰值。

三轮时间线（30秒前台／后台请求预算均计入配置兜底）：

| 轮次 | 电脑首字毫秒 | 手机首字毫秒 | 电脑长度种类 | 手机长度种类 | 前台电脑／手机请求 | 后台电脑／手机请求 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 102 | 40 | 12 | 12 | 44 / 44 | 0 / 0 |
| 2 | 169 | 40 | 11 | 12 | 44 / 44 | 0 / 0 |
| 3 | 111 | 25 | 11 | 12 | 44 / 44 | 0 / 0 |

流式交互1：electron 11项全部通过，中文组合输入保留；mobile 11项全部通过，中文组合输入保留。实际结果与打开状态截图见对应目录；systemBarsVerified=false，不计为系统栏验收。

流式交互2：electron 11项全部通过，中文组合输入保留；mobile 11项全部通过，中文组合输入保留。实际结果与打开状态截图见对应目录；systemBarsVerified=false，不计为系统栏验收。

流式交互3：electron 11项全部通过，中文组合输入保留；mobile 11项全部通过，中文组合输入保留。实际结果与打开状态截图见对应目录；systemBarsVerified=false，不计为系统栏验收。

Apple（苹果端）接线清单：

- `accountChanges.revision` 按账户、设备身份与宿主进程生命周期接纳；标记仅作不透明相等比较，不重算、不跨账户比对。宿主重启接受新水位与新标记。
- `models` 是可选字段：缺失时保留此前标记，其他字段继续处理；后续有效标记及既有30秒配置兜底重读目录。模型名称、状态及账户修订变化均会通知。
- 正文及配置读取解耦：目录失败的200正文正常接纳；最终内容代次失效409需游标重置，等待后的设备鉴权401仍停止。
- 首轮与后续失败直接在1500–1750毫秒区间抖动；正文端点恢复至多1750毫秒加请求耗时，桌面另有至多250毫秒检查间隔。全宿主故障仍有最长30秒连接探测；不能宣称无条件2秒恢复。
- 只有正常changed／timeout等待才立即续订；401停止当前身份、404清源、持续409仅一次尾页重建，禁止失败后的零延迟调度。后台撤销等待，前台并行恢复正文／决策／概览。
- 无新路由、权限、原生壳方法或版本号；未改安卓壳。Apple原生接线／编译及真机仍由苹果端包验收。

可重复运行：`node tests/integration/bl29-rework/run-rework-2.mjs` 串行运行全部审查探针与保留项，可在后面指定场景名。`node tests/integration/bl29-rework/validate.mjs` 执行完整required、连续三遍vendor、审批10遍、手机五文件3遍、两类流式各3遍（时间线带 --budgets）。启动失败会终止批次并保留原失败码及诊断。

未覆盖真实生产中继全链、完整物理遗忘流水线、Apple真机、安卓原生壳系统栏、系统锁屏／睡眠、更新安装器及安装后重启。原两次Node快速失败缺原生栈，本轮另见一次未改动weftmod测试原生异常；不宣称已查清或消除了所有系统原生异常。未访问8081／18186／16384，未使用MuMu、本人桌面、日用数据或保管库；未修改共享vendor构建。收尾清理与最终检查见交付结果。

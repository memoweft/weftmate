# QA-2 · 本人试用前第二轮五端验收

**是否建议本人开始试用：否。** 已修问题明显减少，新云账号手机办事与完整本地中继均通过；但跨对话省略主题的即时纠正两次回答旧值，手表实时批准／拒绝仍缺实测，Android 设置还有可重复的脚本异常。完整问题、步骤、实际／期望、截图和定位见 [issues.md](issues.md)。本包只提交证据与 STATE 的 Windows-5 一行，没有修改产品代码。

验收版本：Windows `93a7b75eca241d5f3794bd67eab02a23f15945e6`；Mac 指定只读工作树 `d1c6bd62ffed29d211028015ab48240c016e37df`，未切分支、未修改源码。Apple 使用已构建的 A11 原生二进制与当前捕获器。Mac 选择**本机随机端口的隔离宿主**，真实 HTTP／账号／项目存储，执行事件为明确合成；不是连接本人电脑、也不是 Mac 真实 DSH 执行宿主。

Core 固定 `cb10a16a7cfe112f5bee2b0e19ad49586b161b79`，用于王小明、即时记忆与 LAN（局域网模型服务）复验。六个办事题使用既有普通基线 Core `5d91823`，其成绩只用于办事，不用于 MF-1 即时记忆结论。所有真实模型请求仅 MiMo 与持锁的 `local-quality`；未请求 8081、未访问 18186，未碰本人日用账号、程序或数据。

## QA-1 逐项复验

| 原问题 | 本轮判定 | 证据 |
|---|---|---|
| QA1-01 新云账号不能办事 | **已修**。原生安卓首次云账号手机发任务、两次审批、电脑写入并读回；旧本地账号绑定与第二账号隔离也通过 | [原生安卓](android-new-retry/phone-task.json)、[旧账号](legacy/mobile-web-visual-verification.json)、[第二账号](second/mobile-web-visual-verification.json) |
| QA1-02 回复后仍发送未确认 | **已修**。安卓草稿为空，无待核对／重试状态，任务详情 200 | [原生确认](android-new-retry/phone-task.json)、[实际结果画面](android-new-retry/android-task-result-light.png) |
| QA1-03 停止控件超过12秒 | **原故障已修**。完整状态夹具30分钟64/64，无12秒超时；两秒目标未稳定达到，另列 QA2-05 | [逐轮](desktop/results.json)、[汇总](stability-summary.json) |
| QA1-04 整理文件额外审批 | **本轮已修**。原题 MiMo 54.794秒、LAN 57.283秒通过；未自动批准未声明审批 | [MiMo](m1-mimo/results.json)、[LAN](m1-lan/results.json) |
| QA1-05 网页成文过慢 | **未修**。本轮710.981秒，原轻量检查通过 | [结果](m1-mimo/results.json)、[阶段计时](m1-mimo/requests.jsonl) |
| QA1-06 默认即时记忆 | **原三题行为3/3**，旧正式对象检查1/3；纠正采用周五、人物采用海报／展览，偏好先用买菜例子。新留出题两次回答旧值，另列 QA2-01 | [原三题](immediate-original/results.json)、[留出题](memory-holdout/results.json)、[独立复验](memory-holdout-retry/results.json) |
| QA1-07 iPhone归档摘要版本号 | **已修**。首页显示“1条”，实际归档列表可打开；浅深设置都完成 | [首页](apple/settings-light/review-iphone-settings-home-light-20261009T141013Z.png)、[浅](apple/settings-light/validation-a6-light.json)、[深](apple/settings-dark/validation-a6-dark.json) |
| 阻断1：Mac登录后未验通 | **已解除**。A10自动登录、13分类、发送恰好一笔queue、审批条，浅深各通过 | [浅](apple/a10/mac-light/validation.json)、[深](apple/a10/mac-dark/validation.json) |
| 阻断2：iPhone关于遍历失败 | **已解除**。含关于、返回位置、搜索、设备操作、用量深链，浅深各通过 | [逐批计时](apple/apple-timings.json)、`apple/settings-light/`、`apple/settings-dark/` |
| 阻断3：实时Watch与完整中继 | **中继已补完，Watch仍阻断**。手机网页经真实隧道发任务、批准3次、看到电脑完成；单Watch无手机可达回执 | [中继手机任务](relay-complete/phone-task.json)、[链路请求](relay-complete/mobile-web-visual-verification.json)、[Watch](apple/watch/verification.json) |

## 本轮清单与覆盖边界

| 检查项 | 本轮结果／截图 | 耗时口径 |
|---|---|---|
| Windows 首次云身份／旧本地绑定／第二账号 | 真实 `src/main.mjs`、Electron、合成云签名；[三起点](second/mobile-web-visual-verification.json)、[旧数据保留](legacy/mobile-web-visual-verification.json) | 报告各批 startedAt／finishedAt；手机任务分别另记 |
| Windows 设置、浅深、480像素窄窗口 | 13分类均可打开，窄窗无横向溢出；[逐页](settings/results.json)、`settings/*settings*`／`*narrow*` | 每分类毫秒计时；打开与截图合计 |
| Windows 模型设置／目录诊断／无目录推理／后台跟随 | [通过](models/report.json)，真实宿主／合成模型，浅深与手机390窗口截图在 `models/` | 旧运行器未单独计时，不推造数字 |
| Windows 对话菜单、置顶、未读、重命名、分叉后续聊、分组、归档恢复删除 | [真实MiMo通过](menus/desktop-verification.json)，删除确认保留默认未勾选；`menus/`截图 | 原生请求阶段在 `menus/requests.jsonl`；菜单操作未逐一计时 |
| 首条立即显示、发送／停止同控件 | [64轮](desktop/results.json)与[D36](d36/checks.json) | 每轮首条显示与停止按钮延迟独立记录 |
| Windows／手机网页排队、引导、偏好持久化、审批与窄窗 | [通过](d36/checks.json)，浅深截图；合成执行事件，不冒充真实MiMo排队压力验证 | 原运行器未单独计时 |
| 单行进展、详情展开、原始数据二级展开、审批、成果、失败、停止 | Windows／网页见 `d36/`、`projects/`、`orphan-stop/`；iPhone[A9流程通过](apple/phone-flow/validation-a9-after-light.json) | iPhone188.672秒；FX12与部分旧运行器无单项计时 |
| FX-12旧正在停止收尾 | [四异常均终态](orphan-stop/after.json)，待回执0、可继续、终态后重试0、同一续做仅派一次；截图在同目录 | 合成异常状态专项；不访问本人四条旧任务 |
| Windows项目、权限、自定义组合框、首个write成果 | [通过](projects/mobile-web-visual-verification.json)，普通／项目／手机首写均有读回成果；`projects/`浅深图 | 手机写入49.540秒；桌面子场景原报告未单独计时 |
| 手机网页项目入口、Windows项目生命周期 | [真实MiMo与隔离宿主通过](project-lifecycle/verification.json)：项目说明带入、文件／命令、只读及越界拒绝、移动后下轮执行、移除保留文件；手机网页与界面包列表／新建／移动入口截图在同目录 | 请求时间见 `project-lifecycle/requests.jsonl`；部分UI操作未单独计时 |
| Android首次登录、浅深、手机任务与发送确认 | [通过](android-new-retry/android-visual-verification.json)，真实MuMu／原生桥；任务36.172秒 | 逐批起止时间、任务独立毫秒计时 |
| Android设置完整遍历 | 适用分类均打开；真实弹出层脚本异常保留；[原始计时](android-all-retry/extra-checks.json)、[判定](android-adjudication.json) | 每页1–2秒为导航等待加截图，具体值见JSON |
| Android项目列表／新建项目对话／移动入口 | [真实原生通过](android-projects/extra-checks.json)，浅深列表和项目对话／菜单截图 | 项目流程4.359秒 |
| Windows／手机网页贴底与上翻 | [浅深4/4通过](scroll-focused/results.json)，新内容到来时历史位置变化0像素，回到底部可用 | 每项442–752毫秒；合成执行事件，见JSON |
| Mac项目远程入口与受限账号 | [浅](apple/projects-mac-light/validation.json)、[深](apple/projects-mac-dark/validation.json)通过；本机创建／执行仍为A11明确未交付边界 | 项目旧捕获器无单项计时；另[A10完整计时复验](apple/mac-timed/timings.json)浅21.370秒／深20.102秒，含登录13分类发送审批 |
| iPhone设置 | 浅深完整通过，归档摘要正确、关于可达；系统状态／备份在手机不适用 | 浅172.088秒、深168.672秒 |
| iPhone项目、发送、移动、受限说明 | [浅](apple/projects-phone-light/validation.json)、[深](apple/projects-phone-dark/validation.json)通过，原生UI／真实隔离存储／合成执行 | 精确测试耗时见 [apple-timings.json](apple/apple-timings.json) |
| iPhone运行中排队／引导、重启偏好、详情按钮 | [A9完整通过](apple/phone-flow/validation-a9-after-light.json)，BL-12按钮已为描边可点击控件 | 188.672秒；该完整流程本轮浅色，深色设置与项目另验 |
| Mac模型箭头、iPhone详情按钮（BL-12） | [Mac主界面](apple/a10/mac-light/main.png)只剩一个箭头；[iPhone详情](apple/phone-flow/a9-iphone-detail-light-20261009T142855Z.png)描边按钮；已修 | 包含在对应原生批次 |
| BL-13项目权限／泛称进展，BL-14直接write | [权限控件](projects/create-project-permission-light.png)、[读回成果](projects/phone-task.json)通过，摘要按操作类型显示；Apple远程入口已复验 | 见项目批次，不以历史FX-11结果替代 |
| BL-9后台跟随、BL-10日志、BL-11旧停止 | 模型设置、30分钟日志正文／密钥扫描、四旧停止状态均复验；不访问本人8081 | 见 `models/`、`stability-summary.json`、`orphan-stop/` |
| Watch | 实际单Watch截图通过；实时批准／拒绝**未通过验收** | 24秒启动，见阻断B01 |
| 完整中继传输 | [CI同款443](relay-ci.json)通过：真实HAProxy/frp、TLS（传输层加密）、2200条历史、附件、重连、证书固定与撤权；撤权9毫秒 | 完整用例11.709秒 |
| 完整中继手机任务 | [通过](relay-complete/phone-task.json)：真实Windows执行／MiMo，3次手机审批、电脑文件读回、任务200、无未确认；449个宿主请求走中继来源 | 任务40.936秒，不含注册与搭建 |

未覆盖成“通过”的项目：实体设备／推送／触感；Watch手机可达审批；iPhone到真实Windows DSH的完整模型审批链；Mac本机文件夹登记和执行；所有端逐项搜索、原生手机上翻不拉走、全部菜单的全面原生复验；完整本地六题与完整本地记忆四题／经验加速。部分旧运行器未逐项计时，本报告明确留缺，没有用历史成绩、文件时间或网页结果补成原生通过。

## M1、M2 与稳定性

| M1原题 | MiMo | 秒 |
|---|---|---:|
| 整理目录 | 通过 | 54.794 |
| 网页成文 | 通过，等待仍过长 | 710.981 |
| 读代码 | 通过 | 78.777 |
| 查资料写脚本 | 失败，额外审批；新账号复跑通过单列 | 66.807 |
| 停止继续 | 通过 | 37.903 |
| 删除批准／拒绝 | 通过 | 27.491 |

MiMo原六题 **5/6**；LAN原整理／读代码／停止继续 **3/3**，57.283／76.086／56.358秒。MiMo达到4/6数值门槛，但PLAN完整M1出口要求本地六题和Android、iOS跨端审批，本轮**不宣布完整M1出口通过**。新账号原生安卓任务与手机网页中继链路通过不替代iOS真实执行链。

王小明 MiMo→LAN **8/8**，真实Core来源、纠正、重启、遗忘及故障降级通过；[完整报告](m2/baseline-mimo.json)、[来源](m2/mimo-sources.png)、[遗忘](m2/mimo-forget.png)。即时原三题行为3/3、旧正式对象检查1/3；省略主题纠正留出题两个新账号均失败。不以八步单项宣布完整M2出口通过。

30分钟主批：**1801.445秒、64/64轮**；主进程事件循环p99 **31.998毫秒**，最大185.467毫秒；RSS（驻留内存）增长 **84.227 MiB**，保留64个新对话，不据此认定泄漏。停止按钮中位1.355秒、p95 3.364秒、最大4.313秒，0轮超过12秒。日志1文件71559字节，合成正文标记与合成密钥0命中。

主批收集1072次文件系统通知，**不等于写盘次数**。最初实际重命名计数器没有同步Node内置模块导出，零值无效；另用修正的计数器跑五分钟同类循环，结果在 `write-sample/results.json`，与主批分开记：补测303.802秒、成功原子替换89次、17.577次/分钟。绝不把通知频率或无效零值冒充实际写盘率。

## 中继夹具、失败保留与公开边界

完整传输先按CI在WSL Ubuntu安装HAProxy并运行443原用例；安装后系统服务立即停止，仅本包前台测试进程运行。手机任务使用同款SNI（服务器名称指示）分流与官方固定frp 0.71.0，随机入口端口，Windows真实宿主终止内容TLS，临时证书仅限本测试，不修改系统信任。

临时云为HTTP回环服务；HTTPS中继网页跨站访问它时，HTTP Cookie的SameSite（同站限制）会阻止测试登录。本包用进程内云Cookie传输保留标准云认证，精确登记本轮中继回调，再走真实云登录、邮箱验证码、电脑批准和可信交付。此适配只覆盖临时云HTTP传输，不替换宿主接口、任务、审批或模型；内容请求仍走完整中继。手机网页测试上下文使用 `ignoreHTTPSErrors` 接受隔离证书，未修改系统信任；证书／固定公钥拒绝负例由独立443原用例验证。生产公网证书部署不在本包。

原始探针失败分别保留：Android测试包名与既有探针要求不一致、未先返回列表的设置定位、项目按钮同时命中抽屉与主列表；旧进展定位未包含新等待计时后缀；旧滚动运行器的延迟路由在关闭时重复处理，补充专门的真实界面滚动检查4/4；Mac传入app目录而非二进制、SSH路径缺Node；iPhone运行器启动断开；中继Cookie／代理／重连／按钮定位适配。另一次即时记忆运行器误选办事题已停止，已知模型用量计入 `runner-aborted/`。这些失败不当成产品缺陷，也没有改产品或放宽语义判据。

## 用量、清理与交付

MiMo按实际上游请求去重，合计 **223次请求、210笔完整用量、13笔缺用量**；已知输入914085，其中缓存375872，输出36996 token（词元）。按本轮核对的[官方价格](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)，已知费用下界 **¥0.61972244**；不是账单，缺用量不记免费。所有成功、失败、补充题、取消的已追踪请求均计入，[usage.json](usage.json)列分组来源。

已清理进程：**33个**（按PID强制结束的精确计数；正常退出的子进程不编造总数）。Windows／Mac本包残留0，本包MuMu已关闭并核对停机、隔离APK卸载（随后其他任务重新启动的共享模拟器未动），Apple模拟器全部关闭，LAN锁释放，WSL测试中继进程0。清理和公开扫描见 `cleanup.json`、`privacy-scan.json`；全部账号、邮件、正文、任务文件为合成数据。运行器快照在 `runners/`，仅证据代码；真实密钥／LAN地址只从进程环境读取，不提交凭据、证书、运行存储或APK。

PR与最终CI记录在 `ci.json`。CI全绿不等于五端验收全通过；本报告结论仍为不建议本人试用。

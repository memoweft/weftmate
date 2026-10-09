# QA-3 · 本人试用前第三轮验收

**是否建议本人开始试用：否。** 正常手机接线的离线同步请求失败后，会反复用全屏离线页遮住正在进行的审批、设置和项目操作。王小明确认决定的正式形成、迁移 Verify（验证）脚本也有本轮实际失败。详见按严重程度排序的 [问题清单](issues.md)。

**可以迁移本人日用程序到安装版：否。** 安装更新链路通过不等于日用迁移已准备好；应先修复本轮迁移脚本错误和移动端使用阻断，再完成迁移当天的真实组件核对。

本包只增加验收运行器、合成截图和结果，并更新 STATE 的 Windows-4 一行；不修改产品代码。Windows 验收版本 `1bbc863aa664d58105c0f1b086c5f8dc702c9235`，Core（记忆核心）为当前 CI（持续集成）固定的 `a9b115f2d0de10bdf79bd7000057da6cbda7c046` 只读归档；没有修改 Core 工作树。验收期间主干又合入 UX-2，该包不属于本次已测版本；不把后来的代码冒充已测代码。

## QA-1、QA-2 逐条复验

| 原问题 | 本轮结果 | 本轮证据 |
|---|---|---|
| QA1-01 新云账号不能办事 | **执行权限原问题已修**。原生安卓新云账号能发任务并由电脑写入；正常交互被 QA3-B01 遮挡，点击返回后才完成 | [首次失败](android/android-visual-verification.json)、[恢复后任务](android-recovery/phone-task.json) |
| QA1-02 回复已有但发送未确认 | **已修**。恢复后任务详情 200、草稿清空、无未确认或重试状态 | [原生回执](android-recovery/phone-task.json)、[中继回执](relay-retry/phone-task.json) |
| QA1-03 停止按钮超过12秒 | **原故障未复现**。68/68 轮通过；两秒目标见 QA3-04 | [逐轮](desktop/results.json)、[统计](stability-summary.json) |
| QA1-04 整理目录多余审批 | **本轮未复现**。原题 MiMo、LAN 均通过，没有批准未声明审批 | [MiMo](m1-mimo/results.json)、[LAN](m1-lan/results.json) |
| QA1-05 网页成文很慢 | **本轮改善**，174.759 秒；只有一次本轮样本，不宣称稳定性能目标已全面通过 | [原题](m1-mimo/results.json) |
| QA1-06 默认即时记忆 | **原三题实际行为3/3**；旧正式对象判据2/3。先用买菜例子、纠正采用周五、人物采用阿岚及海报背景 | [原回复](immediate/results.json) |
| QA1-07 iPhone归档摘要是版本号 | **已修**。本轮真实首页显示“1条”，浅深完整设置通过 | [浅色原图与验证](apple/iphone-a6-light/)、[深色](apple/iphone-a6-dark/) |
| 阻断1：Mac登录后全流程 | **已解除**。A10浅深登录后13类设置、原生发送及实际宿主queue回执、审批条均通过 | [浅](apple/a10/mac-light/validation.json)、[深](apple/a10/mac-dark/validation.json) |
| 阻断2：iPhone设置关于页 | **已解除**。完整A6浅深遍历含关于、归档、搜索、设备操作及用量深链 | [浅](apple/iphone-a6-light/validation-a6-light.json)、[深](apple/iphone-a6-dark/validation-a6-dark.json) |
| 阻断3：完整中继与手表 | **原缺口已补验**。手表真实批准／拒绝通过；手机网页经完整中继完成，但需退出错误离线页1次，新QA3-B01仍在 | [传输443](relay-ci.json)、[手机任务](relay-retry/phone-task.json)、[Watch（手表）](apple/watch/validation.json) |
| QA2-B01 手表实时批准／拒绝 | **本轮已解除**。真实WatchConnectivity（手表通信）到手机、宿主的两笔回执；批准删除合成文件，拒绝保留；成功触感调用一次 | [实际回执](apple/watch/host-receipts.json)、[原图](apple/watch/) |
| QA2-01 省略主题纠正仍答300毫升 | **原题本轮已修**。回答150并明确300已作废；旧简单正则误把否定旧值计失败，原记录保留 | [原回复](mf2/results.json) |
| QA2-02 安卓 `:popover-open` 异常 | **本轮未复现**。真实原生浅深设置22页走完，无该脚本异常；有独立离线页遮挡问题 | [逐页](android-settings-final/extra-checks.json) |
| QA2-03 查资料写脚本多余覆盖审批 | **本轮未复现**，原题43.661秒通过 | [MiMo](m1-mimo/results.json) |
| QA2-04 网页成文711秒 | **本轮174.759秒**；文件和终态通过，文字匹配失败单列，全文事实问题仍在 | [原文件](m1-mimo/node24说明.md)、[问题QA3-03](issues.md) |
| QA2-05 停止按钮p95（第95百分位）两秒 | **本轮未达目标**，2.463秒；并行负载和运行器写盘影响未剥离，不认定产品性能回归 | [统计](stability-summary.json) |

## Windows、手机网页、安卓与接口

| 项目 | 结果与截图 | 耗时口径 |
|---|---|---|
| 首次云注册、电脑批准手机、新执行账号 | 原生链路已实际执行；错误离线页构成正常使用阻断 | `android*/` 的起止时间及 `phone-task.json` |
| 旧本地账号升级、绑定云身份 | 真宿主、合成云、原owner／设备／资料保留；手机任务通过 | [accounts/legacy](accounts/legacy/mobile-web-visual-verification.json) |
| 第二账号隔离 | `executionAccount:false`、动作403、旧会话0、受限说明可见；切回原账号时设备允许被离线页挡住 | [accounts/second](accounts/second/mobile-web-visual-verification.json) |
| Windows设置、浅深、480窄窗 | 13分类各两种主题打开；窄窗无横向溢出，截图人工查看 | [逐页计时](settings/results.json)、[深色窄窗](settings/dark-narrow.png) |
| 模型三分区、添加／编辑、诊断、无目录推理、后台跟随 | 真主程序及390网页通过，敏感输入不回显；无日用模型调用 | [models/report.json](models/report.json)、`models/*.png` |
| 对话菜单、置顶、未读、重命名、分组、分叉续聊、归档恢复删除 | 真实MiMo与主程序通过 | [menus/desktop-verification.json](menus/desktop-verification.json)；旧运行器未逐菜单计时 |
| 发送立即显示、发送／停止同控件、持续切换 | 68轮；首条本地显示中位约2.2毫秒 | [desktop/results.json](desktop/results.json) |
| D36排队／引导、偏好持久化 | 浅深真实程序和手机网页通过；明确合成执行事件 | [d36/checks.json](d36/checks.json)、`d36/*.png`；批次耗时见 `ui-batch.json` |
| 贴底、上翻不被拉走、回到底部 | 桌面／390网页浅深4项通过，合成流式内容 | [scroll-focused/results.json](scroll-focused/results.json) |
| 进展、审批、失败、停止与继续 | M1原题、D36、旧停止专项分别验证；没有把合成进展当作MiMo真实执行 | `m1-*`、`d36`、`orphan-stop` |
| FX-12旧“正在停止”收尾 | 四异常状态终态、无持续重试、可继续、同一续做只派发一次 | [orphan-stop/after.json](orphan-stop/after.json) |
| D37项目全部Windows／网页入口 | 可写／只读、说明、目录执行、越界拒绝、移动下轮生效、移除保留文件通过 | [project-lifecycle/verification.json](project-lifecycle/verification.json)、`project-lifecycle/*.png`；旧运行器无逐动作计时 |
| 原生安卓设置 | 常用11分类浅深22页可到达，操作前用真实“返回”退出错误离线页。“资料访问”补查浅色入口打开、截图尚在加载，深色被离线页遮挡；不能称全部设置正常无干扰 | [22页](android-settings-final/extra-checks.json)、[资料访问补查](android-resources/extra-checks.json) |
| 原生安卓项目 | 首轮新建被离线页遮挡，保留失败；返回后独立补查列表浅深、新建项目会话与移动入口通过，4.267秒 | [原失败](android-settings-final/extra-checks.json)、[补查](android-resources/extra-checks.json) |
| UX-1提问条、中文名称、隐藏选择器 | 真实Electron、手机网页、安卓界面包浅深通过，74张合成原图与可见文字；安卓此项是界面包浏览器，不冒充原生手指交互 | [ux-1/checks.json](ux-1/checks.json)、[文字](ux-1/screenshot-text.json) |
| BL-9／10／11／13／14 | 后台模型设置、日志、旧停止、共用项目权限控件及真实项目写入分别覆盖；BL-12 Mac单箭头与iPhone描边详情按钮已在本轮原图核对 | `models/`、`stability-summary.json`、`orphan-stop/`、`project-lifecycle/`、`apple/a10/`、`apple/iphone-a9-after-light/` |
| BL-19 | macOS原动效用例仍复现滚动位置0→72，原断言失败；未改断言，不用原生Mac通过抵消 | [本轮日志](apple/mac-motion.log)、[QA3-06](issues.md) |
| IA-2a迁移身份 | 104原生日志文件不变、旧消息／深链、分组归档、重启主身份、完整停机副本回退通过 | [ia-2a/identity-native.json](ia-2a/identity-native.json) |
| IA-2a历史／日期／搜索／旁聊API（应用接口） | 5项定向检查通过，含真实HTTP旁聊幂等、摘要更新与删除清理；界面尚未接 | [api-tests.txt](ia-2a/api-tests.txt) |
| M3-A离线引擎 | 网页和原生安卓：同步加密副本→关宿主→MiMo记忆问答→新增偏好→上线补交／形成→新会话采用→遗忘与清理通过 | [网页](offline/verification-web.json)、[安卓](offline/verification-android.json)、`offline/*.png` |
| M3-A正常产品接线 | **失败**。真实传输探针证明403；上述引擎运行器显式提供正确传输，不能覆盖此错误 | [production-transport-proof.json](offline/production-transport-proof.json) |
| 完整中继443传输 | CI同款HAProxy（传输代理）／frp（隧道）／TLS（传输层加密），2200条历史、附件、重连、证书固定、撤权通过 | [relay-ci.json](relay-ci.json)，用例12.148秒，进程总时30.541秒 |
| 完整中继手机办事 | 真实云身份、受信设备、MiMo、2次审批、写入读回、任务200、确认正常；**需退出错误离线页1次** | [phone-task.json](relay-retry/phone-task.json)，35.408秒 |

运行器的环境失败也保留：缺少当前 Playwright（浏览器自动化工具）浏览器、Windows临时目录斜线形式、旧停止文字同时命中提示条和状态行、一次早期Electron上下文失效。安装对应浏览器、统一测试目录和限定原控件后重跑；未改产品、未放宽业务判据。`ui-batch-environment-failures.json` 与最终 `ui-batch.json` 分开。

`android-resources` 的导航与项目结果先落盘，之后仅配置模型、未发送任务的补查没有生成模型推理轨迹文件，旧外层运行器复制该文件时产生ENOENT。该退出错误不当作产品故障；资料访问深色的离线遮挡失败仍保留，项目子项实际通过。

## 原生 Apple

资源释放后按本轮 `apple/batches.json` 记录：Mac本地随机端口隔离HTTP宿主，真实登录／项目／审批服务，确定性合成规划器；不连接本人数据，也不冒充真实Windows DSH模型执行。

指定工作树在开工时有A14未提交修改并持续构建，本轮等待其完成标记后才允许启动原生测试。只读使用既有A13二进制，逐项记录实际二进制哈希；运行器记录的Git提交表示夹具源码，不能自动当作该二进制的编译提交。最终测试结果、浅深截图、资源清理与已覆盖项在原生批次报告中列明。

本轮 **14个串行批次全部通过**：Mac六条原生流程、iPhone八项原生测试、Watch一项原生测试；A10一个批次内部含两种主题，所以流程数与批次数不同。iPhone／Watch均零失败、零跳过。实际开始、结束和耗时见 [batches.json](apple/batches.json)。

| 本轮原生项 | 结果／证据 | 批次秒数（含启动、模拟器与导出开销） |
|---|---|---:|
| Mac A10登录后全部设置、发送、审批条，浅深 | [通过](apple/a10/)，32张本App原图 | 两主题合计41.959 |
| Mac项目远程入口，浅／深 | [浅](apple/projects-mac-light/validation.json)、[深](apple/projects-mac-dark/validation.json)通过 | 10.987／10.922 |
| Mac A13提问条、中文名称、月份实际查询，浅／深 | [浅](apple/a13/mac-light/validation.json)、[深](apple/a13/mac-dark/validation.json)通过 | 28.158／28.175 |
| iPhone A6完整设置，浅／深 | 关于、归档数量、搜索、设备操作和用量深链通过 | 349.293／284.938 |
| iPhone A7会话菜单、归档和删除确认 | [浅色完整流程](apple/iphone-a7-light/)通过 | 260.093 |
| iPhone A9运行中排队／引导、偏好重启、详情按钮 | [浅色完整流程](apple/iphone-a9-after-light/)通过 | 235.341 |
| iPhone项目、新建项目会话、移动、受限说明，浅／深 | [浅](apple/projects-phone-light/validation.json)、[深](apple/projects-phone-dark/validation.json)通过 | 111.050／110.908 |
| iPhone A13提问条、名称与用量月份，浅／深 | [浅](apple/a13/iphone-light/validation.json)、[深](apple/a13/iphone-dark/validation.json)通过 | 146.766／147.242 |
| 最后一对iPhone＋Watch实时批准／拒绝 | [真实回执与文件操作](apple/watch/host-receipts.json)、[验证](apple/watch/validation.json)通过 | 140.532 |

二进制实现哈希与A13已记录实现逐一匹配；A13与本轮起点的整个 `apps/apple` Git树相同，见 [apple-provenance.json](apple-provenance.json)。只复用了二进制，所有截图和本轮结果重新生成，没有复用历史成绩。Mac读取和构建目录保持原样，所创建的两台模拟器及配对已删除，全部模拟器关闭，见 [清理](apple/cleanup.json)。开工前已有的Mac进程未动。

范围边界：Mac普通客户端按远程模式验证，不冒充可信嵌入宿主或Mac本机文件夹执行；Apple规划器／模型为合成，未补成iPhone→Windows真实MiMo任务链。Watch批准／拒绝走真实通信与持久HTTP回执，执行合成文件操作，未调用真实DSH；成功触感调用不等于实物手表触感验收。实体设备、推送、七日签名续期、所有原生手机滚动／键盘边界、菜单与排队流程的全部深色复跑未覆盖。原运行器没有每个原生点击的独立计时，表中不伪造用户响应速度。

## M1、M2、稳定性与用量

| M1原题 | MiMo原判据 | 秒 | LAN抽测 |
|---|---|---:|---|
| 整理目录 | 通过 | 315.884 | 通过87.48秒 |
| 网页成文 | 文字匹配失败；文件／终态通过，事实问题保留 | 174.759 | 未抽测 |
| 读代码 | 通过 | 40.787 | 通过80.61秒 |
| 查资料写脚本 | 通过 | 43.661 | 未抽测 |
| 停止与继续 | 通过 | 39.816 | 通过61.20秒 |
| 删除批准／拒绝 | 通过 | 53.807 | 未抽测 |

MiMo原自动成绩 **5/6**；LAN按本包要求 **3/3抽测**。不把三题扩成完整本地六题。PLAN完整M1出口还要求完整本地场景成绩及Android／iOS跨端审批，本报告不据此宣布完整M1出口通过。

王小明 **6/8**，正式确认决定及采用未通过；即时原三题实际行为3/3、旧正式对象判据2/3；QA2浇水原题实际回答150毫升。没有重跑完整本地记忆四题和经验加速，完整M2出口不通过。

稳定性：**1828.075秒，68/68轮**；主进程事件循环p99 **33.849毫秒**，最大78.119毫秒；RSS（驻留内存）增长 **78.824 MiB**，同时保留68个新会话，不能据此断言泄漏。首条立即显示中位2.2毫秒；停止中位1.384秒、p95 2.463秒、最大2.901秒，7轮超过2秒。实际成功原子替换 `store.json` **579次，19.004次／分钟**，1158次文件通知不当作写盘次数。日志78422字节，合成正文与密钥0命中。挂钩同步了Node内置模块导出；本轮与其他QA和构建部分重叠，性能解释有负载限制。

MiMo汇总见 [usage.json](usage.json)：已追踪168次请求，158笔完整用量、10笔缺用量；已知输入512,197，其中缓存263,232，输出31,982 token（词元）。按本轮核对的[官方价格](https://mimo.mi.com/models/zh-CN/mimo-v2.6-flash)：未缓存输入¥1、缓存输入¥0.02、输出¥2／百万token估算，已知费用下界 **¥0.31819364，约¥0.32**。这不是账单；取消、缺回执及未留完整轨迹的早期失败不记免费。

## 安装版与迁移当天风险

本轮从验收提交重新构建三个独立 `qa3` 身份版本、临时签名密钥、私有本地更新源。全新安装／登录、任务期间推迟重启、热更、正常差分升级、坏版自动回退／拒绝重装、卸载保留通过，[原始结果](installed/installed-report.json)。UI（界面）总包1,559,700字节只下载5,074；本体174,217,285字节只下载1,823,026，约 **1.0464%**。未发布、未购买签名、未安装到日用目录。

安装闭环使用合成本地登录；合成云注册与设备批准由同版源码主程序另验。首次安装截图中的“云服务尚未配置”来自该隔离配置明确关闭云服务，不将其作为默认正式安装行为的证据，也未宣称安装版公网登录已通过。

指定备份的演练只允许回环，额外拒绝8081／18186，不带public-origin。个人原文、凭据、备份和诊断原件不提交。脚本Prepare、实际源码／安装版／源码回退、Verify401和副本完整性结果由 `installed/migration-report.json` 汇总。原脚本Apply／Rollback的Rehearsal模式明确拒绝控制任务，本轮保持此限制。

最终补查保留所有账号身份，用仅存在于副本的合成本地登录替身遍历三类当前记忆：原本地账号返回200空列表，其他账号返回503；源码、安装版和回退相同，未取得“原记忆可见”的证据，不能称迁移丢失。原对话可见；恢复副本与原备份66,050文件均新增0、删除0、更改0。所有个人副本与私有诊断原件已删除。

迁移当天必须处理：

1. 修复Verify401并用隔离副本复验；不把匿名接口失败当作宿主未启动。
2. 核对旧账号的原对话、正式记忆与正确归属，先本地登录再绑定，避免首页新建另一账号。
3. 核对正式记忆桥、原模型配置、云身份、内容证书、中继和手机授权；隔离回环演练不证明公网配置已通。
4. 使用正式受信更新公钥重新构建发布包，确认发布源和回退包；本轮临时密钥不用于日用发布。当前未签名安装包的系统提示、免费Apple签名的安装有效期仍需当天处理。
5. 只在安排好的迁移窗口切换启动方式，保留原任务定义和源码回退路径，验证通过后再决定后续清理；本轮未执行日用任务切换。

## 公开边界与交付

全部模型、账户和任务证据为合成内容。真实备份仅发布不含正文的布尔／完整性结论。截图保持原图；私有路径仅在文本日志中必要脱敏，不重画产品画面。清理、精确密钥扫描、最终PR（拉取请求）与CI状态在收尾文件及仓库外 `qa-3.result.md` 中记录。CI全绿也不改变上述“不建议试用”的结论。

[PR #152](https://github.com/memoweft/weftmate/pull/152) 的最终提交检查以实时PR页面及 `qa-3.result.md` 为准；`ci-initial.json` 明确是首个证据提交的全绿记录，不冒充收尾提交。Mac定向动效失败独立保留。

已清理本轮产品测试进程与模拟器：收尾额外按PID强制结束 **0** 个，运行器内部关闭／升级回收的子进程未逐个计数。Windows本包进程0，Mac本包近期测试进程0、启动模拟器0、创建的两台设备及配对已删除；开工前已有Mac进程未动。MuMu测试包卸载、映射撤销，模拟器关闭；WSL（Windows的Linux子系统）中frps、HAProxy及本包云／中继进程0；LAN锁释放，26个已知合成临时根目录清理、个人备份副本0、临时签名私钥0。见 [cleanup.json](cleanup.json)、[临时根](temporary-cleanup.json)、[公开扫描](privacy-scan.json)。

自动审批审查拒绝了本地 `.local/qa-3/releases` 构建目录的删除，理由仅为 `blocked by policy`。该受忽略目录保留生成的测试安装包，不含个人副本或签名私钥，没有运行进程；Mac暂存证据已通过更小范围的操作删除。

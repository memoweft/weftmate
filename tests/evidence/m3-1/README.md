# M3-1 · 在线状态与接回

合成账号、临时标记数据目录、随机端口。未访问本人日用程序／数据，未向8081／18186发送请求。实际链路与呈现投影分开记录，不把状态投影当作真实撤权或断网。

## 已通过的真实链路

`relay-reviewed/presence-results.json` 与 `relay-reviewed/mobile-web-visual-verification.json`：固定DSH（助手运行时）47f9438、真实Electron（桌面程序框架）、真实云账号／邮件文件／设备批准、frp（隧道）、HAProxy（传输代理）、宿主TLS（加密传输）及390×844手机网页。

| 场景 | 核对 |
|---|---|
| 原生模型流中终止实际HAProxy，恢复相同链路 | 90段与原始回复逐字一致；模型调用1次；7个公开事件序号无重复 |
| 宿主HTTP（网页传输协议）监听停止／恢复 | 原生执行进程保留，90段原回复接回；没有重新生成 |
| 发送后丢受理回执 | 按原requestId（请求编号）查到已受理，不补发第二条 |
| 在宿主受理前丢请求 | 原编号查询404，显示未送达；重复手动重试仍为同一编号 |
| MiMo（小米模型服务）真实长回复中断手机网络 | 持久全文4798字，与实际上游接收字符数相同；全文详情核对覆盖4000字历史预览之外的内容 |
| 宿主停止后离线入口／恢复 | 明确电脑离线后可打开M3-A离线页；宿主恢复后同步并自动回到电脑对话 |
| 原生工具／审批 | 断网前后保留同一审批身份，批准回执与步骤状态恢复；真实`pwsh`后续有既有“requires approval, but no approval channel is available”失败，保留失败事实，没有冒称执行成功 |

这里的宿主重启验收是内容监听停止／恢复，原生执行进程仍存活。强制终止整个执行进程无法补出未生成的文字；本包按原回执／持久记录核对，不自动重新生成。D40云端加密电脑任务暂存属于S7，本包离线入口只接M3-A。

原Ubuntu的磁盘路径不存在，未重建发行版。测试使用现有docker-desktop的临时独立Alpine工具，原生frp与HAProxy仍是实际进程；依赖放在工作树忽略目录和本包`/tmp`目录，没有修改系统软件安装。运行中的合成云客户端仅登记实际分配的精确回调地址，未放宽认证、签名、PKCE（授权码校验）或设备批准。

## 状态判定与间隔

唯一实现：`src/ui-core/presence.js`；契约与完整表：`docs/CLIENT_API.md` 3.2。普通业务／模型／离线副本错误不判电脑离线。并发失败同一秒只计一次，至少3次、首尾至少2秒，加独立`/status`探测；云确认offline时也必须先确认内容通道不可达。仅独立状态探测解释中继502／503／504（包括空响应）为不可达，模型503保持在线。原生本机缓存不能作为电脑在线证据。

前台失败基础1秒，指数上限30秒；后台基础15秒，上限120秒，0.8–1.0倍抖动。在线独立探测前台15秒、后台60秒；切到后台先降为60秒检查，后续沿当前尝试级数退避。前台／网络恢复／手动重试立即探测。安卓`/status`连接与读取各5秒；网页／Electron独立请求预算5秒。后台系统挂起时由既有S3a接续，不宣称严格按秒唤醒。

## M3-1b 前端返工证据

M3-1c 已修复 M3-1b 的手机状态回归：手写 `apps/mobile-ui/www/components/chat.js` 恢复主线语义，普通进度进入 `#chat-status`，错误进入全应用红色 toast（轻提示），继续沿用页面上方位置。两处共享发送不确定的调用明确传 `message-pending`，只在原消息显示「发送结果待核对」与检查状态／重试按钮；读取失败调用明确传 `read-failure`，在线时显示内容区，非在线时并入连接条。桌面对应读取调用与提示同样按类别处理，去掉文案正则。手机未知电脑进度改为「电脑那边的进度还没确认」，离线时只保留「电脑离线 · 等待接续」。

M3-1c 受影响截图已同名重拍；新增 `rework/android-package/android-package-390-{light,dark}-{error-toast,online-read-failure,online-sync-failure,online-unconfirmed-turn,offline-unconfirmed-turn-merged}.png`，分别核对错误红色、toast 高于输入区、在线行内提示、未知进度人话与离线单行。`verification.json` 记录几何与文字断言；安卓界面包共22张、真实 Electron（桌面程序框架）与手机网页共72张，均为合成状态投影。MuMu（安卓模拟器）仍由 AND-1 使用，未操作原生模拟器或伪造系统栏。

M3-1c 测试记录位于 `checks/m3-1c-*`。手机原95条仅迁移一处发送待核对的位置断言，以及根据本次文案要求更新三处未知状态期望；错误toast、进度、节点数量与跨账户迟到结果的原断言保持。新增四项回归，手机99/99通过；云登录／手机交互／视觉／M3-1状态合跑120/120；共享层、桌面交互与母版128/128；离线与静态界面11/11。本地完整必过单测1371通过／0失败（14项既有跳过）；最终推送记录见本次 Orchestrator（任务编排）结果。

`rework/states/`：真实 Electron（桌面程序框架）1200／480、手机网页390×844／360×780，六态浅深48张；另有发送待确认＋离线、审批优先、提问优先浅深24张。`rework/android-package/`：实际安卓界面包在 Chromium（浏览器内核）中运行，390／360两尺寸，连接中／离线浅深8张，另补恢复统一轻提示浅深4张。状态投影仅用于界面验收，不冒充真实网络故障；实际故障与回执链路仍以上一节真实中继证据为准。

| 返工项 | 返工前（浅／深） | 返工后（浅／深） |
|---|---|---|
| 安卓提示叠加、发送核对重复 | `android-isolated/android-native-host-offline-light.png`／`android-native-host-offline-dark.png` | `rework/android-package/android-package-390-light-host_offline.png`／`android-package-390-dark-host_offline.png` |
| 桌面厚连接卡片与离线读秒 | `states/electron-1200-light-host_offline.png`／`electron-1200-dark-host_offline.png` | `rework/states/electron-1200-light-host_offline.png`／`electron-1200-dark-host_offline.png` |
| 手机连接条过重 | `states/phone-web-390-light-connecting.png`／`phone-web-390-dark-connecting.png` | `rework/states/phone-web-390-light-connecting.png`／`phone-web-390-dark-connecting.png` |
| 桌面发送仅原消息核对 | 原叠加见上述安卓截图；桌面原发送状态无截图，不虚构前图 | `rework/states/electron-1200-light-unconfirmed-offline.png`／`electron-1200-dark-unconfirmed-offline.png` |
| 读取／同步失败并入连接状态 | `android-isolated/android-native-host-offline-light.png`／`android-native-host-offline-dark.png` | `rework/android-package/android-package-360-light-connecting.png`／`android-package-360-dark-connecting.png` |
| 审批、提问压住连接条 | UX-7 主线已提供机制 | `rework/states/*-light-approval-priority.png`／`*-dark-approval-priority.png`、`*-light-question-priority.png`／`*-dark-question-priority.png` |

- [x] 1：沿用统一输入、按钮及现有控件，无新增原生控件残留。
- [x] 2：重试、离线入口与消息核对采用次级按钮；悬停、按下、键盘焦点、禁用四态齐全，手机触控至少40px。
- [x] 3：连接条由 UX-7 收入唯一上方条位，优先级审批 > 提问 > 连接 > 子任务 > 建议；恢复采用现有应用轻提示。
- [x] 4：固定40／44px，说明最多两行，条位／输入区无压线，无横向溢出；长说明在标题状态悬停提示。
- [x] 5：六态与原消息待确认／未送达／已接受分开呈现；断线进展等待接续并停表。
- [x] 6：1200／480、360×780／390×844浅深均有截图，颜色和尺寸沿用令牌。
- [x] 7：对照本仓库 UX-7 与已通过的现有输入区。未找到 `ref-products/`，不虚构外部参照审查。
- [x] 8：没有新增菜单、弹层或对话框；长说明采用原生悬停文本，不另加浮层。审批／提问与连接同时存在的优先级投影已截图。
- [x] 9：本次界面包、网页与真实 Electron 的可见区域已检查；早期截图保留为失败对照。
- [ ] 10：本次安卓原生整屏复拍待补。MuMu（安卓模拟器）上有 AND-1 的 `com.memoweft.weftmate.mobile.and1.test`／`and1`，按任务指示只拍实际界面包，未关闭模拟器、未卸载别人的包。系统状态栏问题交 AND-1；没有给 Chromium 图片伪造系统栏。旧安卓整屏证据保留，不能代表返工后原生复验。

第8a：未增加独立页面、刷新入口或筛选；离线页和原会话流程沿现有实现。状态恢复不再添加输入区第二行轻提示。

## 验证记录

本轮相关回归154项／0失败，`rework-targeted.txt`；`rework-typecheck.txt`类型检查通过。`rework-required-unit-tests-first.txt`保留合main后首轮1333通过／2失败：在线进展与计时夹具缺少在线连接状态，补齐后原断言保留。第二轮在同步新main时读到临时冲突标记，`rework-required-unit-tests-interrupted-by-merge.txt`保留为无效中间记录；清理冲突、定向及类型检查通过后冻结代码，最终完整必过单测1,356通过／0失败，14项既有跳过；`rework-required-unit-tests.txt`保存最终汇总。原安卓检查状态的未定义变量已修，修前失败见 `rework-native-check-before.txt`，修后用原编号核对且不发送新消息。

`checks/`保存完整必过单测、相关回归、类型检查、固定vendor（运行时依赖）核对与界面检测；本地使用与CI（持续集成）相同的`node .github/scripts/ci-unit-tests.mjs required`命令。首轮失败记录保留，补齐已有夹具与缺失依赖，保留原保护点，没有删除用例／新增skip（跳过）／放宽断言。

`checks/cloud-race-before.txt`是真实发现的令牌竞争修前失败：迟到凭据读取重放已消费的刷新令牌；修后使用原有队列同时覆盖读取与轮换，相关17项通过。安卓原生先接纳宿主会话，再由共享层启动设备读取，避免接入期间假401；另有专门次序测试。

安卓仅使用本包创建的隔离包`com.memoweft.weftmate.mobile.fx9qa`，不覆盖原应用、不改版本号。MuMu（安卓模拟器）实际实例0的ADB（安卓调试桥）端口以管理器快照为准；旧ADB服务器不响应时使用本包独立服务器，不重启共享ADB服务。原生实际结果与清理以安卓子目录及结果文件为准，失败尝试也保留。

## 用量与公开边界

`usage.json`按上游响应的编号＋时间去重，包含失败验收尝试中的实际MiMo用量；不把合成模型用量计入。凭据与私有局域网模型地址扫描见`checks/privacy.json`。截图与日志只有合成数据，配对／验证码／模型凭据不写入公开证据。

## Apple改动清单

1. 使用六态与同一失败计数／独立探测规则，系统联网与前后台事件立即触发探测；间隔与上限按本表。
2. 消费`/status.presence`及`/sync/events.presence`，分开宿主可达、运行时、模型、授权与启动变化；401走原身份边界，未批准走设备允许。
3. 保留会话／逻辑对话游标，按原生seq（序号）／逻辑eventId（事件编号）去重；409走原重置，重读工具、审批与问题当前状态。
4. 未确认消息显示待确认，按原requestId查回执；404后才明确重试，复用原文字、模型、附件与编号，已受理不重发。
5. 标题小点与输入区提示使用原生布局，不弹窗；恢复轻提示不遮控件，电脑离线接A14的离线模式。
6. 无新增业务路由。Apple原生实现未在Windows改写；已有操作名生成检查的CRLF（Windows换行）兼容已与main合并保持一致，本次无额外Apple代码差异。

需要新安卓壳版本：网络异常分类、5秒状态探测，以及合入FX-16的分页查询支持。版本／界面包默认最低版本保持主线值，由Claude合并发布时统一递增。

## 最后一次主线同步

完整必过日志在主线 `6fe4de93` 合入后完成：1,356通过／0失败，14项既有跳过。PR（合并请求）创建时 main 又合入 UX-8 回复动效与 FX-19 创建回执；已再次合入 `c3a69939`，保留动效、`creationReceipt`及本包离线／原消息核对行为。合并后 `checks/rework-final-main-tests.txt` 166项／0失败、`rework-final-main-typecheck.txt`通过；84个界面场景重新截图与检查。全量日志的版本边界明确保留，最新合并版本的完整跨平台验证由PR的CI（持续集成）执行。M3测试按主线显式DOM-free（无文档对象模型）目录加载业务状态模块；浏览器动效另由真实窗口与reply-motion测试验证，不删除或跳过状态／回执用例。

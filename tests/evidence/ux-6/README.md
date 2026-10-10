# UX-6 · D53 搜索面板与侧栏顶部

全部使用合成账号、系统临时目录、随机端口和合成执行回执。没有访问本人日用程序、数据、8081 或真实模型。私人参照图仅在本机查看，未复制、未进入截图或审稿页。

## A / B 对照

- [x] A1：搜索入口在主对话 WeftMate 上方，与侧栏内宽一致；放大镜、占位和 Ctrl K；原中间搜索行与就地输入监听移除。
- [x] A2：标题栏应用名旁只有一个开合按钮，展开／收起坐标相同；Ctrl B、提示和 no-drag（不可拖动）区域，480px抽屉同样可操作。
- [x] A3：桌面搜索 → 主对话 → 动态／目标／成果库 → 新旁聊及临时下拉 → 旁聊／分组 → 项目 → 头像；手机抽屉搜索 → 主对话 → 新对话及临时下拉 → 旁聊／分组 → 项目 → 功能 → 账户。保留D50状态位和分组间距。
- [x] B1：桌面680px、最大70vh、统一弹层；手机全屏、标签横滑；桌面固定键帽提示。浅深、160ms进入／120ms退出、减少动态效果。
- [x] B2：需要关注、最近使用、操作；最近记录按账号只保存类型、标识和打开时间，实体重新鉴权；临时与已删除实体不从缓存补回。
- [x] B3：标题＋主／旁聊正文、项目、成果文件名、定时任务、记忆；分组、默认每组3项、展开及分页、高亮和日期、正文定位；防抖与旧响应丢弃、骨架、空结果新建并发送首句、读取失败重试。
- [x] B4：类型图标、标题、弱信息、整行选中、更多菜单与回车提示；真实键盘与 dialog / combobox / listbox / option（对话框／组合框／列表框／选项）语义。原类型动作复用。
- [x] B5：`/chats?scope=search`复用原索引和清理代次，其他类型复用现有接口；账户隔离、D33、临时／混合临时过滤和过期游标测试。安卓原路径已支持，无新增壳能力；记忆沿匿名设备范围与原始宿主账户的既有绑定读取。
- [x] B6：旧侧栏就地搜索合入面板；已归档设置页的独立管理筛选保留。

## 截图索引

| 表面 | 浅／深、尺寸 | 场景与文件前缀 |
|---|---|---|
| 真实 Electron（桌面程序框架） | 1200×800、480×800 | `electron-{1200,480}-{light,dark}-`：sidebar-expanded／sidebar-collapsed、empty、grouped-results、五个type、row-menu-open、no-results、new-chat-menu-open |
| 真实 Electron | 1200×800 | main-body-located、side-body-located、keyboard-menu-open、loading-skeleton、project-dialog-open |
| 手机网页，真实宿主远程界面 | 390×844、360×780 | `phone-web-{390,360}-{light,dark}-`：sidebar、empty、grouped-results、五个type、row-menu-open、no-results、body-located |
| 安卓已生成界面资产＋原生桥契约夹具 | 390×844、360×780 | `android-bundle-{390,360}-{light,dark}-`：相同场景；运行实际打包资产，不冒称MuMu实屏 |
| 审稿页 | 桌面／手机、浅深 | `gallery/review-{windows,mobile-web}-search-palette-{light,dark}.png` 与来源JSON |

打开状态截图包含搜索面板、行尾更多菜单、新旁聊下拉及新建项目对话框，浅深均有。每个类型页断言真实合成结果存在；手机网页与安卓界面包也验证正文定位。首屏只显示需要关注中的实际项，其余结果与操作可滚动。

与参照结构对照：左上角固定图标位、侧栏顶部搜索入口、居中输入／标签／分区／固定键帽四层结构一致；宽度与密度沿本项目令牌，保留WeftMate主对话和三个固定页。手机按同一信息层级改为全屏。这里没有参照图及其私人正文。

## 并行规则8与8a自查

- [x] 1. 没有原生下拉、缩放把手、默认蓝焦点或原生滚动条；沿共用控件。
- [x] 2. 入口、图标按钮、类型标签、结果行和菜单有悬停／按下／聚焦；不可用或读取中的操作使用原禁用状态。
- [x] 3. 新入口在本人指定的侧栏／标题栏位置；新操作在统一面板和行尾菜单。
- [x] 4. 令牌间距、图标对齐、长标题截断；没有横向页面溢出、半截控件、重叠或同区双滚动。
- [x] 5. 标签和行选中明确；骨架、空状态、错误和重试；菜单沿原动作状态。
- [x] 6. 浅深、480px、390×844／360×780均取证；高亮用现有浅深成对颜色令牌。
- [x] 7. 对照参照层级与密度；私人图未提交。
- [x] 8. 每个新增弹层与菜单有浅深打开截图；沿统一dialog和WeftPopover（弹层组件）。
- [x] 9. 最终截图复核；窄窗最大高度、深色选中底色、手机关闭按钮与弱信息已修正。
- [x] 10. 本包采用本人明确指定的例外：MuMu 被 M3-1／AND-1 占用，手机证据使用真实界面包和手机网页的内容区截图。**没有系统状态栏／手势条，未验收原生沉浸式系统栏，也不冒称原生整屏截图。**后续原生包须按第10项另验。
- [x] 8a. 整行打开、行尾一个更多；进入原固定页使用该页标题，隐藏对话专属操作；无额外刷新大按钮，时间人话、标签统一、三态齐备。

## 性能与测试

`performance.json`：500个合成原生会话、真实账户隔离HTTP（网络接口）和真实Electron；没有模型请求。HTTP各20次，界面10次。

| 指标 | 实测 | 门槛 |
|---|---:|---:|
| 空输入接口冷读 | 70.04ms | 150ms |
| 空输入界面首批结果p95（第95百分位） | 112.81ms | 150ms |
| 正文搜索接口冷读 | 56.61ms | 300ms |
| 搜索接口p95 | 28.92ms | 300ms |
| 搜索接口p95＋160ms防抖 | 188.92ms | 300ms |
| 输入到界面首批结果p95，含防抖／接口／渲染 | 266.37ms | 300ms |

正文命中500项；优化为按当前分段快照分组，避免每个对话重复全表扫描。旧历史仍沿原9.3后台补索引，`indexState=building`有可见更新入口，未把局部历史称为完整。

- 搜索／对话／既有功能定向69项通过；记忆页与匿名范围绑定组合42项通过。
- 桌面交互3项、动效1项通过；保留原导航、输入、附件、审批、停止、减少动态效果及历史断言。
- `actions.json`：设置、项目、固定页、新旁聊、临时对话浅深16项＋空结果首句真实合成发送，共17项。
- 网页／手机账户与输入回归100项及UI-2真实视觉回归1项通过；兼容原主线渲染、图片页、资料与草稿保护。
- 安卓 `BusinessRouteUnitTest`（业务路由单测）14项通过，0失败；没有修改版本号或界面包最低版本。
- `design-detector.json`：机械设计检查0项；`verification.json`：页面错误0、无横向溢出、真实键盘及截图清单。
- 完整必过单测使用 `node .github/scripts/ci-unit-tests.mjs required`；完整日志见 `required-unit-tests.log`，1308项中1296通过、0失败、12按仓库既有配置跳过，1266.35秒；没有新增跳过或放宽断言。

没有运行系统读屏软件、安卓模拟器或Apple原生界面；不将语义与资产验证写成这些实屏验收。未发布安装包或更改日用程序。

最终代码验证提交 `cf57d94d` 的7项CI均通过；[PR #186](https://github.com/memoweft/weftmate/pull/186)。公开扫描77个改动文本文件，私人参照文件名／真实密钥／私有模型地址命中均0，见 `public-scan.json`。本包进程已自然关闭，按创建时间＋命令行／程序路径复核0残留。

收尾按要求并入 `origin/main` 的FX-18：指定 `merge-state.py` 保留双方契约行，搜索记忆兼容 `recovering`（继续整理中）且仍核对原能力／归属。该合并后定向43项、类型检查通过，见 `final-merge-regressions.log`；上面的完整单测与7项CI成绩属于代码验证提交cf57d94d，最终合并提交CI另行触发。

## UX-6b 返工（2026-10-10）

受影响截图已同名覆盖；修复前原图保留在 `rework-before/`。下表每项均提供浅／深对照，手机也覆盖360px。

| 必修项 | 修复前（浅／深） | 修复后（浅／深）与断言 |
|---|---|---|
| 1. 手机抽屉顶部 | [浅](rework-before/android-bundle-390-light-sidebar.png)／[深](rework-before/android-bundle-390-dark-sidebar.png) | [浅](android-bundle-390-light-sidebar.png)／[深](android-bundle-390-dark-sidebar.png)：搜索和主对话左右20px；搜索上下12px；选中主对话圆角、内宽与列表行一致；移除固定入口上方的“最近对话”；旁聊／未分组／项目／功能标题左边线统一24px。顺序为搜索 → 主对话 → 新对话及下拉 → 旁聊／分组 → 项目 → 功能 → 账户。 |
| 1. 新对话与临时入口 | 同上旧抽屉中的两个描边按钮 | [浅色下拉打开](android-bundle-390-light-new-chat-menu-open.png)／[深色下拉打开](android-bundle-390-dark-new-chat-menu-open.png)：一行新对话＋统一菜单内的临时对话；360px浅深同样取证。 |
| 2. 桌面少结果提示行 | [浅](rework-before/electron-1200-light-row-menu-open.png)／[深](rework-before/electron-1200-dark-row-menu-open.png) | [浅](electron-1200-light-row-menu-open.png)／[深](electron-1200-dark-row-menu-open.png)：提示行用自动上外边距贴面板底边；多结果 `grouped-results`、少结果 `row-menu-open`、无结果 `no-results`、加载 `loading-skeleton` 浅深均重拍。每张截图断言提示行到底边不超过2px。 |
| 3. 主对话下划线 | [浅](rework-before/electron-1200-light-sidebar-expanded.png)／[深](rework-before/electron-1200-dark-sidebar-expanded.png) | [浅色选中](electron-1200-light-sidebar-expanded.png)／[深色选中](electron-1200-dark-sidebar-expanded.png)；[浅色键盘聚焦](electron-1200-light-main-chat-focused.png)／[深色键盘聚焦](electron-1200-dark-main-chat-focused.png)：根因是最后加载的 `main-chat.css` 选中态规则，并非焦点回落；选中态用底色，聚焦沿统一聚焦环，实际计算样式无下划线。 |
| 4. 人话时间与完整日期 | [手机浅](rework-before/android-bundle-390-light-type-定时任务.png)／[手机深](rework-before/android-bundle-390-dark-type-定时任务.png)；[桌面浅](rework-before/electron-1200-light-grouped-results.png)／[桌面深](rework-before/electron-1200-dark-grouped-results.png) | [手机浅](android-bundle-390-light-type-定时任务.png)／[手机深](android-bundle-390-dark-type-定时任务.png)；[桌面浅](electron-1200-light-grouped-results.png)／[桌面深](electron-1200-dark-grouped-results.png)：按账户时区显示“今天 14:05”“昨天”“10月8日”，跨年才带年份；时间列不收缩、不截断，长标题可截断。390／360px均断言日期实际宽度未溢出。日期单测另覆盖跨时区与跨年昨天。 |
| 5. 更新原证据 | `rework-before/` | Electron（桌面程序框架）1200／480px、手机网页与安卓实际界面包390×844／360×780浅深原文件均重拍；搜索审稿页与项目对话框截图同步更新。 |

第8条清单重新逐项核对：1 控件／滚动条／焦点沿共用样式；2 搜索、选中行、新对话、菜单和下拉有可见交互态；3 入口沿原侧栏和统一菜单；4 上表间距、标题和完整日期有计算样式与截图证据；5 标签、菜单状态及加载／空／错误沿原设计；6 四种尺寸浅深已复核；7 沿原参照层级与密度，没有加入新视觉体系；8 新手机下拉与原面板／结果菜单／项目对话框浅深打开截图齐备；9 最终图像复核通过；10 使用本包明确授权的界面包例外，系统栏验收未完成。8a 时间已按上表修正。

`verification.json` 记录最终15类交互检查、全部截图及0页面错误；`ux-6b-interactions.log` 是最终完整取证日志。`ux-6b-related-tests.log`：45项通过、0失败，补齐假DOM（文档对象模型）的新抽屉容器，保留原账户／延迟响应／记忆保护断言。类型检查、母版资产生成通过。`ux-6b-design-detector.json` 的两项提示属于原有隐藏图片预览（打开时填入真实图片）与正文引用边线，本包新增样式无提示，未扩大返工范围。

并入 `origin/main` 的UX-7下一步建议及安卓36／0.8.23；资产清单与安卓路由测试保留双方新增项，STATE冲突用指定 `merge-state.py` 解决。本包未修改主线安卓版本号或最低壳版本，未新增接口／权限／原生能力。

UX-6b 最终完整必过单测：`node .github/scripts/ci-unit-tests.mjs required`，1343项，**1329通过、0失败、0取消、14仓库既有跳过**，1104.71秒，退出码0；没有新增例外、删除用例或放宽保护断言。完整日志：[ux-6b-required-unit-tests-final.log](ux-6b-required-unit-tests-final.log)。最初一轮发现假DOM容器缺失和合并资产清单顺序不一致，修正后重新完整运行并通过。最终类型检查、母版生成、45项定向、17项动作以及最终安卓界面包回归均通过。

已清理进程：2（停止最初已发现失败的本包单测父进程与调度进程）；界面取证进程经原有清理逻辑自然退出。按创建时间、可执行路径和本工作树／隔离目录命令行复核，0残留；未操作M3-1／AND-1模拟器、日用程序或8081。

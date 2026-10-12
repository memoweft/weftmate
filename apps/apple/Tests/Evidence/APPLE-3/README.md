# APPLE-3 · iPhone catch-up

原生 iPhone 视图与本机合成 HTTP 服务；合成账号、模型与健康数字。没有连接本人电脑、线上云端或真实模型，没有读取或造入 HealthKit 样本。测试场景入口属于 Debug 夹具。

## 实现

- 回复读取累计 `assistant.delta`，独立水位防止迟到回退；最终 `streamSeq` 替换同一呈现身份。暂态正文不进持久历史。正文生成时 250 ms 读取；决策／Watch 同步独立按 1.5 秒读取。停止复用原任务停止链。
- 审批显示一致、提醒与拿不准的意见；不一致或外部影响时拒绝作为主操作并取得焦点。`global-category` 使用原审批请求编号和回执；删除、对外发送、花钱不提供长期允许。Watch 只添加意见文字。
- 每个原生回合一份文件清单，默认三行；同路径保留最新，未知路径的同名成果保留。支持同一步 `artifacts` 数组，文件行身份使用成果编号。整轮完成／中断／失败决定提示强度，中途失败不让已完成回合变红。
- 健康分数两列；按钮使用应用强调色与共用样式，深色卡片使用软底色，各项分析只留详情页，展开箭头使用一个生成图标。
- 权限设置增加复核开关（旧电脑缺字段默认开启）；健康数据设置增加今日模型解读开关，两项各自 PATCH 对应字段。

## 验证与边界

Swift 全包：XCTest 13/13 与 Swift Testing 462/462，0 失败、0 跳过；包含累计替换、低水位、空快照、最终身份、历史缓存隔离、审批三态／全局范围与原请求重放、文件去重与多文件数组、折叠、整轮归类、不同宽度两列及两个设置请求体。停止沿既有 TaskStopSDKTests 回执、隔离与撤权测试。

设计令牌 5/5，文案回归 3/3，文案扫描通过，回调隔离 65 处／0 失败。最终原生 iPhone 测试工程以 x86_64／iOS 26.2 编译；嵌入 Watch 目标一起编译，不计 Watch 界面验收。HEALTH-4 的令牌失败先在 PR #246 修复并推送 `7b0e4702f`，再合入本分支。

界面最终结果及截图清单见下方；`attempt-1/` 保留未签名夹具停在登录阶段的失败，`attempt-2/` 保留浅色对话／设置已走通但夹具菜单被嵌套导航隐藏的失败。它们不作为整批通过证据。`attempt-3/` 保留外层导航栈仍显示设置详情、尚未进入健康场景的失败；第四批按场景重建测试导航栈。原始带本机路径的编译／测试日志与 xcresult 留在临时目录，没有提交。

真实电脑持续长回复、网络断开后继续生成、停止请求直到宿主终态、全局规则对下次真实工具的生效、VoiceOver／外接键盘初始拒绝焦点、真机 HealthKit 与签名后台行为需要本人设备及电脑配合；本包数据／请求与合成原生 UI 不替代这些验收。没有健康新指标或 HEALTH-5 字段改动，没有 Mac／Watch 页面改版、安卓或线上部署。

## 最终原生界面结果

主路浅／深批次 1/1 通过，构图补拍浅／深批次 1/1 通过，两批均 0 失败、0 跳过。最终 30 张接受截图；网格与五文件展开四张由补拍替换，断言内容完整落在导航栏和输入区之间。`ui-main-validation.json` 是第四次启动的主路结果，`ui-validation.json` 是第五次启动的构图结果；`host-report.json` 为最后构图批次的合成服务报告。

共启动 5 次，均为隔离 iPhone SE（第三代）、一个模拟器、无 Simulator.app 窗口。每次先查 GPU 报告与 uptime，结束关闭全部模拟器并冷却至少三分钟。本包 GPU／整机重启 0，新增 WeftMate 崩溃报告 0。一次临时 OCR 辅助进程读取失效图像后崩溃，随后改为捕获错误；原始诊断留在临时目录，不属于 App 崩溃。

| 场景 | 浅色 | 深色 |
|---|---|---|
| 流式正文 | [图](apple3-light-stream.png) | [图](apple3-dark-stream.png) |
| 最终正文 | [图](apple3-light-final.png) | [图](apple3-dark-final.png) |
| 一致意见 | [图](apple3-light-aligned.png) | [图](apple3-dark-aligned.png) |
| 提醒意见／拒绝主操作 | [图](apple3-light-warning.png) | [图](apple3-dark-warning.png) |
| 成果默认三行 | [图](apple3-light-files-collapsed.png) | [图](apple3-dark-files-collapsed.png) |
| 五文件完整展开 | [图](apple3-light-files-expanded.png) | [图](apple3-dark-files-expanded.png) |
| 中途重试后完成 | [图](apple3-light-recovered.png) | [图](apple3-dark-recovered.png) |
| 已中断 | [图](apple3-light-interrupted.png) | [图](apple3-dark-interrupted.png) |
| 整轮失败 | [图](apple3-light-failed.png) | [图](apple3-dark-failed.png) |
| 复核设置 | [图](apple3-light-permissions.png) | [图](apple3-dark-permissions.png) |
| 今日模型解读设置 | [图](apple3-light-health-settings.png) | [图](apple3-dark-health-settings.png) |
| 今日解读按钮与卡片 | [图](apple3-light-health-buttons.png) | [图](apple3-dark-health-buttons.png) |
| 完整两列分数网格 | [图](apple3-light-health-grid.png) | [图](apple3-dark-health-grid.png) |
| 详情分析关闭提示 | [图](apple3-light-health-analysis-off.png) | [图](apple3-dark-health-analysis-off.png) |
| 详情分析展开 | [图](apple3-light-health-analysis-expanded.png) | [图](apple3-dark-health-analysis-expanded.png) |

## 本人健康页补充

按本人最新意见，卡片／详情／趋势的声明已移除，电脑回执 disclaimer 不进入展示；只在设置两个模型开关旁保留一句。数字改用现有展示字号和粗体，状态词按范围内绿／偏高偏低琥珀，今日解释挪入详情的「依据」，分数卡使用带圆点的粗圆角范围条；详情曲线加粗并保留圆点。没有新增每指标配色、仪表弧或渐变主题，等待网页端设计令牌的另包。

新增 Swift 两项与固定展示测试 1/1、最新全包 475/475、回调 65 处／0 失败及无模拟器原生编译通过。**上面的健康截图在这次补充前拍摄；新的声明、数字、范围条与详情依据没有重拍。** 模拟器已用满五次，本次不再启动，新视觉需本人真机看。其它对话／审批／成果截图仍对应本包行为。

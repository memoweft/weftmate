# A8 · Apple 对话流、审批与输入区

iPhone / Mac 对齐 D35、UI-P4、UP-3 与 FG-2。工具步骤按原生事件顺序分组，与正文穿插，默认是灰字单行和箭头；当前步骤采用真实参数，结束按命令 / 文件 / 搜索计数。组和步骤展开状态在事件更新中保留，失败警示并展开失败步；停止与独立成果文件、读回核验保留。纯文字没有工具进展或旧的运行任务控件。

审批位于输入框正上方，一次显示一项与余数。标题从审批回执参数立即生成工具与对象，不等待异步详情；详情展示完整参数、影响范围及撤销说明。同类允许留在详情。有效回执后当前项立即移除，列表保留已批准 / 已拒绝；不确定回应保留原请求核对，即使后续读取失败也不生成新决定。Mac Return 仅在批准按钮拥有焦点时处理，详情按钮只展开。

消息在本机持久化 / 网络等待前显示发送中淡态；受理后转正式，原生领取后按 receiptId 合并，避免重复。草稿在确认前保留，回执丢失先核对原编号；明确未找到才用相同原体继续。运行中有文字或附件为发送，无文字为停止，空闲为发送。输入区不放发送方式选择；按 A8 派发边界固定排队，D36 设置接线留下一包。

贴底由功能层状态机管理，底部跟随文字、展开与输入区布局变化；上翻后保持阅读位置并提供回到底部。等待首行只使用宿主的加载 / 排队 / 思考阶段及计时，出字 / 工具后消失。上下文圆环只采用 contextUsage，80% 起警示，未知上限只显示已用标记。左侧附件和紧凑审批模式，右侧圆环、当前模型菜单、系统听写提示和主按钮；全部允许使用既有盾牌图标及警示色。

## 验证

- FG-2 承诺 / 建议 / 约定预览的 Swift 解码及显示断言通过，独立记忆列表与命令种类未扩展。
- Swift 定向 13/13：进展顺序、迟到更新、汇总、全局失败步号、停止、审批历史、等待消失、按钮三态、已知 / 未知上下文、贴底状态机、既有分页与成果接口。另有遗忘操作 SDK 15/15。
- 三组独立状态检查通过：AppleSendStateChecks（11 项，含即时消息、草稿、回执丢失、同编号同体重试与合并）、TaskInteractionChecks（11 项，含两项队列、回执消失、立即对象、不确定回应及读取失败）、AppleTimelineStateChecks（分页 / 空增量 / 过期回调 / 离线 / 来源标签页）。
- 设计令牌 4/4，审稿来源定向 4/4。修复主干命名间距令牌生成带连字符 Swift 属性的问题，修改生成器再生成，没有手改生成文件。
- iPhone 最终浅深各 1/1，零跳过。真实隔离 cloud main + 宿主，合成多步日志、夹正文、两项审批、失败和成果；断言等待三阶段、展开保留、批准 / 拒绝消失和历史、上下文 86% / 未知上限、历史阅读与回到底部、即时消息、运行中实际 queue、初次运行停止按钮可用、宿主确实收到 stop、真实终止文字和纯文字无旧控件。
- Mac 最终 Debug 构建通过；八个场景各浅深，自身窗口捕获。静止会话初次打开的停止可用性经窗口复验；该修复保留稳定的命令 / 审批观察生命周期，避免流式事件更新反复取消目录读取。
- 每次只开一个隔离 iPhone，所有 xcodebuild 串行 -jobs 2；UI 完成立即 shutdown all，不启动 Watch 模拟器。

## 证据与重跑

review-* 文件对应审稿页对话、审批、输出与来源、输入区 / 上下文四个场景，两端各浅深；同名 JSON 记录实际源码提交、UTC 时间、来源及合成声明。a8-* 为加载、展开、决定、失败、历史、排队发送、停止、纯文字与未知上限补充图。PNG 为实际 App 截图，没有裁切或图像加工；聚合结果见 validation-focused.json。

```sh
python3 apps/apple/Scripts/generate_project.py
swift test --package-path apps/apple/Packages/WeftMateCore --jobs 2 --filter 'ConversationFlowTests|fg2Forget|timeline'
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/A8-State --check AppleSendStateChecks --check TaskInteractionChecks --check AppleTimelineStateChecks
node --test tests/design-tokens.test.ts tests/integration/review-capture-evidence.mjs
node scripts/generate-tokens.mjs --check
```

构建 WeftMatePhone 的 build-for-testing 后，用 run_a5_ui.py 的 a8-light / a8-dark；Mac 用 WeftMateMac Debug、A5MacCapture.swift 与 run_a8_mac.py。审稿页使用 scripts/review-gallery/build.mjs；本包只补 Apple 既有场景，不改清单或 Windows 截图。

## 范围与边界

所有账号、消息、工具、文件、模型与记忆均合成；未读写本人日用数据，未使用付费模型、真实 LAN 模型或生产服务。cloud / 宿主 / 鉴权和 DSH 公开日志投影是真实代码；日志生产、模型响应与 Core 预览为确定性夹具，不宣称真实 DSH 执行、Core 物理遗忘或真机验收。FG-2 真正删除仍见 Windows / Core 的独立证据。

Mac 证据为真实 App 窗口与共享状态验证，未宣称已做 Mac 键盘 / 听写实机交互或系统辅助功能自动化。模型菜单沿用绑定模型和配置入口，当前 CLIENT_API 没有同一会话换模型路径；系统听写按钮聚焦输入并提供系统入口提示，没有新增录音权限。正式安装包、发布、日用升级、真机 / Watch 与长时稳定性均未做，PR 保持开放交 Claude 审查。

首轮 iPhone 因外层审批可访问性标识覆盖按钮而失败，修复容器后保留原断言重验。截图检查又补齐立即对象断言、移除过期排队行及重复停止控件。Mac 初次目录读取被事件重绘取消的失败通过独立 SDK 与窗口诊断定位，修复观察生命周期，并加强为按钮可用和宿主停止回执断言。最初构建期间修改源码造成混合对象链接失败，最终构建与 UI 均在稳定源码上串行完成；没有降低检查、添加已知失败基线或改写已推送历史。

## 审稿截图索引

| 场景 | iPhone 浅色 | iPhone 深色 | Mac 浅色 | Mac 深色 |
|---|---|---|---|---|
| 对话 / 单行进展 | [截图](review-iphone-conversation-light-20261009T073302Z.png) | [截图](review-iphone-conversation-dark-20261009T074143Z.png) | [截图](review-mac-conversation-light-20261009T072613Z.png) | [截图](review-mac-conversation-dark-20261009T072749Z.png) |
| 输入区审批 | [截图](review-iphone-approval-light-20261009T073302Z.png) | [截图](review-iphone-approval-dark-20261009T074143Z.png) | [截图](review-mac-approval-light-20261009T072625Z.png) | [截图](review-mac-approval-dark-20261009T072801Z.png) |
| 输出与来源 | [截图](review-iphone-outputs-sources-light-20261009T073302Z.png) | [截图](review-iphone-outputs-sources-dark-20261009T074143Z.png) | [截图](review-mac-outputs-sources-light-20261009T072637Z.png) | [截图](review-mac-outputs-sources-dark-20261009T072813Z.png) |
| 输入区 / 上下文 | [截图](review-iphone-composer-context-light-20261009T073302Z.png) | [截图](review-iphone-composer-context-dark-20261009T074143Z.png) | [截图](review-mac-composer-context-light-20261009T072601Z.png) | [截图](review-mac-composer-context-dark-20261009T072737Z.png) |

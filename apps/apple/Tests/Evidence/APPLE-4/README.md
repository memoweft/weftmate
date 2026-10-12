# APPLE-4 · iPhone 手机界面改版

生产原生视图、隔离合成账号和本机合成 HTTP 服务。未连接线上云端、本人电脑或真实模型，未读取真实 HealthKit 数据；系统状态栏没有改写。原始日志与 xcresult 只在临时目录，不进入证据。

## 七项实现

1. iPhone 专用圆形图标按钮、胶囊操作、软底圆角卡片；生成令牌决定颜色与尺寸，触控区至少 44pt。`check_phone_style.mjs` 已接入原有文案检查，防止界面源码直接使用系统蓝或系统强调色。
2. 主对话显示助手「小纬」，旁聊显示原标题，第二行使用现有连接状态；日期、搜索、用量和输出入口收在原生更多菜单。「本页 N 条」只在 Mac 保留；手机回到底部为圆形箭头，助手操作为灰色图标行。
3. 主对话和旁聊使用大圆角输入卡片、加号、模型／模式胶囊、系统听写入口与发送／停止圆形按钮；沿用焦点和原生键盘安全区，键盘出现时收起底部导航。
4. 审批说明与批准／拒绝始终同一行，说明可展开。次行复核意见与次级类别允许胶囊；意见全文仍供读屏与展开查看。继续使用原决策请求与回执。
5. 五项悬浮胶囊导航；侧栏上半入口、下半置顶／最近及项目列表，隐藏分隔线、放松行距，保留原生长按／滑动动作；底部胶囊搜索与圆形新建。
6. 头像直接进入设置。顶部账户卡片、图标＋名称＋灰色摘要／箭头的分组卡片，红字退出单列；原设置子页与确认流程保留。
7. 输出与来源、对话操作、自动删除、项目／新建／分组／删除／成果预览面板共用顶部标题、圆形关闭、系统拖动条与大圆角。设置沿同样的原生居中标题与圆形关闭。系统相机／照片／文件／分享控件沿平台呈现。

## 验证结论：界面验收未全绿

Swift 包全量 479/479（XCTest 13、Swift Testing 466），0 失败、0 跳过；新增呈现规则 4/4。相关 Node 门槛 20/20，包含设计令牌 5/5、回调隔离回归 5/5、文案与强调色检查；67 个回调点／0 失败，包含新增两个 `@Sendable` 键盘通知及显式 MainActor 更新。扫描 2,264 条当前文案、96 个界面源文件。最终源代码以 iOS Simulator 26.2 / x86_64 原生编译通过。

| 模拟器启动 | 原生 XCTest 结果 | 说明 |
|---|---|---|
| 1 | 0 通过／1 失败 | 侧栏搜索标识与头像进入设置失败；随后固定头像、移出入口列表、补容器可访问性边界。初次系统智能提示横幅保留在失败记录中。 |
| 2 | 1 通过／0 失败 | 浅／深主走查通过，30 张截图；此时部分原生 Menu 没有呈现圆形背景。 |
| 3 | 1 通过／1 失败 | 面板／旁聊补验通过；主走查在键盘聚焦后打开输出面板失败，保留失败。 |
| 4 | 2 通过／0 失败 | 主走查及面板／旁聊补验，均含浅／深；此时尚未修复原生 Menu 标签背景。 |
| 5 | 0 通过／2 失败 | 上下文圈可访问性框实测 20pt，两种主题各有宽／高断言失败；深色键盘聚焦后的菜单点击未弹出输出面板。浅色主路（含成果行 44pt 菜单）走通；不能将整批写成通过。 |

最终上下文圈已改为显式 44pt 圆形标签，旁聊模式胶囊去掉多余箭头并缩小横向留白，为模型名字留空间。**这两处最后修正只编译与静态检查，没有再启动模拟器。** 深色聚焦输入后「… → 输出与来源」的原生菜单交互也未获得稳定最终通过。**这些项没能在模拟器上验到，需要本人真机看。** 保留原 44pt 与面板断言，没有降低门槛。

总共启动 5 次，均为同一个隔离 iPhone SE（第三代），单模拟器、无 Simulator.app 窗口；每批前查 GPU 报告与 uptime，结束 shutdown all 并冷却至少三分钟。期间 GPU／整机重启 0，新增 WeftMate 崩溃报告 0。详细原生结果在各 `attempt-N/ui-validation.json`；最新失败与未复验项见 `latest-ui-validation.json`。不轮询云端 CI，交 Claude 审查。

## 展示截图与版本边界

共 37 张按批次标明的原生展示截图、13 张与 APPLE-3 的并排对照。**不是 37 张全部匹配最终源代码的已验收截图。** 第五批在深色主路中断；该批没有拍到的深色流式、审批、侧栏、设置与部分导航仍保留第四批图，属于菜单标签修正前。旁聊图在最后上下文圈与模式胶囊修正前；缺失的深色成果图明确留空。`screenshots.json` 按每张图记录来源与限制，原始截图保留不覆盖。

APPLE-3 没有空对话、聚焦输入、更多菜单、侧栏、设置首页／末尾、旁聊、输出面板、动态／目标／成果库导航的对应改前图；不拿其它场景冒充。健康并排仅用于看底部导航：APPLE-3 健康原图在它最后的本人反馈补充前，正文变化不能归因于 APPLE-4。

| 场景 | 浅色展示 | 深色展示 | APPLE-3 对照 |
| 有内容 | [第5批](apple4-light-content.png) | [第5批](apple4-dark-content.png) | [浅](pairs/light-content.png) / [深](pairs/dark-content.png) |
| 空对话 | [第5批](apple4-light-empty.png) | [第5批](apple4-dark-empty.png) | APPLE-3 缺对应场景 |
| 流式 | [第5批](apple4-light-stream.png) | [第4批](apple4-dark-stream.png) | [浅](pairs/light-stream.png) / [深](pairs/dark-stream.png) |
| 一致意见 | [第5批](apple4-light-aligned.png) | [第4批](apple4-dark-aligned.png) | [浅](pairs/light-aligned.png) / [深](pairs/dark-aligned.png) |
| 提醒意见 | [第5批](apple4-light-warning.png) | [第4批](apple4-dark-warning.png) | [浅](pairs/light-warning.png) / [深](pairs/dark-warning.png) |
| 输入聚焦 | [第5批](apple4-light-composer-focus.png) | [第5批](apple4-dark-composer-focus.png) | APPLE-3 缺对应场景 |
| 更多菜单 | [第5批](apple4-light-overflow-menu.png) | [第5批](apple4-dark-overflow-menu.png) | APPLE-3 缺对应场景 |
| 成果默认三行 | [第5批](apple4-light-files-collapsed.png) | 未拍到 | [浅](pairs/light-files-collapsed.png) |
| 侧栏 | [第5批](apple4-light-sidebar.png) | [第4批](apple4-dark-sidebar.png) | APPLE-3 缺对应场景 |
| 聊天导航 | [第5批](apple4-light-tab-chat.png) | [第4批](apple4-dark-tab-chat.png) | [浅](pairs/light-tab-chat.png) / [深](pairs/dark-tab-chat.png) |
| 动态导航 | [第5批](apple4-light-tab-activity.png) | [第5批](apple4-dark-tab-activity.png) | APPLE-3 缺对应场景 |
| 健康导航 | [第5批](apple4-light-tab-health.png) | [第4批](apple4-dark-tab-health.png) | [浅](pairs/light-tab-health.png) / [深](pairs/dark-tab-health.png) |
| 目标导航 | [第5批](apple4-light-tab-goals.png) | [第4批](apple4-dark-tab-goals.png) | APPLE-3 缺对应场景 |
| 成果库导航 | [第5批](apple4-light-tab-resources.png) | [第5批](apple4-dark-tab-resources.png) | APPLE-3 缺对应场景 |
| 设置首页 | [第5批](apple4-light-settings.png) | [第4批](apple4-dark-settings.png) | APPLE-3 缺对应场景 |
| 设置末尾／退出 | [第5批](apple4-light-settings-bottom.png) | [第5批](apple4-dark-settings-bottom.png) | APPLE-3 缺对应场景 |
| 输出面板 | [第5批](apple4-light-sheet.png) | [第5批](apple4-dark-sheet.png) | APPLE-3 缺对应场景 |
| 旁聊 | [第5批](apple4-light-side-chat.png) | [第5批](apple4-dark-side-chat.png) | APPLE-3 缺对应场景 |
| 旁聊输出面板 | [第5批](apple4-light-side-sheet.png) | [第5批](apple4-dark-side-sheet.png) | APPLE-3 缺对应场景 |

## 遗留与范围

- 真机复核：上下文圈的触控与 VoiceOver 框、旁聊模型胶囊在窄屏／大字体下的名称、深色聚焦输入后的更多菜单与输出面板、主力 iPhone 键盘／安全区与系统返回手势。
- 没有真实电脑、线上模型、云端账户或日用健康数据验收。动态、目标与成果库内容沿用原有实现；成果库仍是现有输出与来源，目标仍是原占位，不宣称完整功能交付。
- 未重做健康页或对齐健康新指标；未改 Mac／Watch／Android 界面。接口和业务模型不改；Mac 只保留原外观，新增手机样式按平台条件编译。

# A16 · Apple 主对话与临时对话

本包沿 CLIENT_API 9.1–9.7 / 第 10 节接入 iPhone、Mac 原生主对话与临时旁聊，Watch 只投影账户主对话中的审批与完成。仅合成账户 / 内容、回环随机端口、隔离数据目录；未访问日用宿主、真实模型、本人剪贴板或桌面。

Swift 模型按精确数字能力版本降级，逻辑 chatId 不替换原生 sessionId、同步 conversationId 或 MemoWeft 来源。主对话正文按 orderKey / eventId 维护最多 1,000 个事件的分页窗口；窗口内使用稳定的按天布局，不依赖 SwiftUI 逐行懒加载，万条原始历史仍留在宿主。历史与增量游标分开；账户时区分日、日期定位、搜索前后命中与高亮、来源引用、三类结果卡接入同一历史。409 / 内容修订先清正文、命中、资源与旧回调；源身份与像素位置独立保存，滚动不发布逐像素正文重绘。

发送和附件沿 chat.message / 同一逻辑暂存，原件与可读内容不传到两个执行段。旁聊创建先核对原请求受理，再转移输入草稿 / 附件；从消息创建只保存来源引用。原生任务、审批、问题和停止保持原 sessionId / taskId / receiptId。原生来源深链通过既有映射定位逻辑对话；活动时间和执行设备继续取原会话事实。

临时创建沿 POST /sessions/temporary；状态分别保存记忆、召回、期限、绝对到期和 hasTemporaryContent。菜单用原生勾选及期限单选；默认为 30 天，原生验收切换到 7 天并核对宿主确认。临时 / 混合历史与临时草稿不写离线缓存；404 丢弃本机显示、草稿和历史副本。之前形成的记忆、设置从新回合生效的说明保留。

## 验证与原件

- `validation.json`：原生四组浅深色、配对 Watch、源码 / 二进制摘要、定向测试计数及边界。
- `screenshots.json`：原始 PNG 尺寸与 SHA-256；截图均来自本 App 自有窗口或专用模拟器，未编辑。
- `screenshot-text.json` / `privacy-scan.json`：与截图同时取得的原生可访问名称 / 值；合成私有正文标记与合成模型密钥标记须 0 命中，Watch 临时正文须 0 命中。
- `mac-light/`、`mac-dark/`：A15 方式的 App 内原生 AX / 自有窗口事件运行器；明确不计为 Mac XCUITest。
- `iphone-light/`、`iphone-dark/`：真实 XCUITest，含日历、折叠、万条搜索、来源、结果、发送 / 附件、审批、临时菜单和原生滚动。
- 各组 `host-receipts.json`：真实个人 HTTP 接口与确定性原生日志替身；附件 PAPER-42 实际进入隔离执行回调，审批沿原受理身份。
- Mac `native-report.json`、iPhone `performance.json` / 宿主回执中的 `metrics`：万条宿主历史上的原生滚动；CADisplayLink 帧间隔与本 App 进程内存。iPhone 用 XCUITest 执行同样的 24 次手势，由 App 内采样帧间隔与进程内存；不再叠加 XCTest 的第二套滚动 / 内存采样器。没有把宿主冷日志读取、整机内存或 GPU 呈现延迟当作客户端成绩。
- `attempts/`：定位器 / 宿主替身终态 / Swift 几何闭包崩溃等失败原件，不计通过。续做确认 SwiftUI 几何偏好仍会在滚动时陷入布局循环，最终完全移除主对话 GeometryReader / PreferenceKey 测量：改为 AppKit / UIKit 原生位置观察，主线程异步交付纯坐标，跟随状态只做非发布的记账；消息行使用固有高度，读锚点不发布逐像素状态。搜索 / 日期跳转不再套用上一页的像素补偿。Mac 最终完成回执在临时菜单保持可见时保存，由父进程关闭隔离 App。原生菜单截图不重新激活父窗口，避免截图前把菜单关闭。

## 复跑

使用 `-jobs 2` 串行构建；iPhone 一个模拟器，Watch 阶段只开已有配对的一组。

```sh
python3 apps/apple/Scripts/generate_project.py
swift test --package-path apps/apple/Packages/WeftMateCore --scratch-path apps/apple/Build/A16Core --jobs 2 --filter 'a16|TaskCommandPageSDKTests|TaskReadSDKTests|TaskStopSDKTests'
python3 apps/apple/Scripts/run_state_checks.py --artifacts apps/apple/Build/A16State --core-build apps/apple/Build/A16Core --check A16ChatStateChecks --check AppleTimelineStateChecks
node --test tests/apple-ui-copy.test.ts tests/design-tokens.test.ts
# 先构建各目标及 test bundle；A5MacCapture 编译到本包私有临时目录。
python3 apps/apple/Tests/run_a16.py --platform mac --theme light --native-own-ax --app <Mac-Debug-executable> --capture <A5MacCapture> --result <unused-native-result-name>
python3 apps/apple/Tests/run_a16.py --platform iphone --theme light --xctestrun <Phone-xctestrun> --simulator <isolated-iPhone> --result <new-xcresult>
# 同样运行 dark；配对 Watch 使用 run_a16_watch.py。
python3 apps/apple/Tests/run_a16_launches.py --app <Mac-Debug-executable> --capture <A5MacCapture>
node apps/apple/Tests/verify_a16_evidence.mjs
xcrun simctl shutdown all
```

## 边界

HTTP 授权、回执、逻辑索引、临时策略与生命周期是正式宿主实现；DSH 日志 / 模型执行是确定性合成替身，未证明编译 DSH、真实 Core 形成、真模型、真机相机或生产中继。万条是合成原始公开消息，不是日用历史。Native 404 流程通过隔离生命周期删除触发同一不可用响应，状态程序直接验证到期 404 的显示 / 草稿清理；未等待真实 1–30 天浸泡。Mac 已知 automation-mode 限制未重试授权、未更改自动化 / 辅助功能 / 安全设置。没有新增服务端接口、系统权限或部署动作。

## A16 续做 / D49

- 接手时保留原实现与未提交修正：按天整行点击区域属于产品修复；到期自动刷新、精确返回路由和合成附件菜单选择属于测试修正。此前失败原件继续保存在 `attempts/`，不计通过。
- 已处理的本人消息不提供编辑 / 重发。Mac 悬停在气泡下方外侧右对齐显示时间和复制；iPhone 长按菜单显示时间与复制。排队编辑 / 撤回保持既有独立入口。
- 助手回复提供复制、有用 / 没用、重新生成、导出和引用。Mac 悬停 / 最后一条可见，iPhone 长按；反馈只保存本设备当前账户的消息身份、评分和时间，不存正文。主对话重新生成查找前一条真实用户输入并开旁聊；普通旁聊沿原生 message-branches，并使用宿主返回的 sendRequestId 与附件回执。
- 导出限所选回复，先预览常见凭据 / 本机路径脱敏后的 Markdown，再由系统保存面板确认；验证系统保存面板打开，Mac 指向新建的合成隔离目录并沿原生取消动作关闭；iPhone 专用模拟器的本机文件位置为空，远程文件服务的取消定位在此 SDK 不稳定，截图后重启同一隔离 App 继续全部业务断言，不把重启当作系统取消或实际文件落盘验收。没有导出整个万条主对话，也没有添加批量编辑入口。
- `composer-menu`、`user-message-menu`、`assistant-message-menu`、`export-preview`、`export-save-panel`、`resources`、`native-date-picker`、`temporary-menu`、`temporary-expiry` 是打开状态的原始截图；Mac 另含 `user-hover` 与最小支持窗口 `narrow-window`，iPhone 为 16e 小屏。
- `mac-launches.json` 核对最终 Mac 二进制的 20 次隔离启动；`crash-check.json` 记录接手基线、已知旧报告与新增数。不会删除旧崩溃报告来改变统计。
- 验证只覆盖合成 HTTP 宿主与确定性执行替身；不把 UI 菜单可见、SDK 回执单测冒充真实模型的重新生成质量或生产导出验收。

## 最终本机结果

61 项相关 Swift 单测（17 项 A16、44 项任务 SDK）、2 个状态程序、9 项文案 / 设计令牌检查通过。Mac 两组自有 AX、iPhone 16e 两组 XCUITest 与配对 Watch 结果见各目录 JSON；Mac 最终二进制 20 次启动及崩溃增量见 `mac-launches.json` / `crash-check.json`。最终 CI 由 Claude 按 PR 的最后 SHA 检查，本包不等待、不自动合并。

| 平台 / 主题 | 帧回调 p95 / 最大（ms） | 进程常驻内存起 / 终（MiB） | 样本数 | 正文事件窗口 |
|---|---:|---:|---:|---:|
| mac-light | 6.94 / 437.87 | 241.15 / 241.11 | 1414 | 102 |
| mac-dark | 6.94 / 163.96 | 203.75 / 202.71 | 1422 | 102 |
| iphone-light | 16.67 / 358.16 | 295.39 / 295.17 | 3485 | 102 |
| iphone-dark | 16.67 / 300.42 | 296.37 / 296.66 | 3569 | 102 |

每组宿主有 10,000 条合成历史。Mac 每组 600 次原生滚动更新，iPhone 每组 24 次 XCUITest 手势。数字是 CADisplayLink 回调间隔与当前 App 的常驻内存，不是 GPU 呈现耗时或宿主冷磁盘读取时间。正文最多保留 1,000 个事件，窗口内采用普通按天布局；没有把万条原始历史全部挂载。

前端已验与未验边界逐项见 `front-end-review.json`。应用内的消息 / 添加 / 日期 / 资源 / 导出预览 / 临时设置菜单截图齐全；macOS 远程系统保存面板的内容截图、iPhone 系统保存面板取消及实际文件落盘不计为已验证。未改变系统自动化、辅助功能或安全设置。

文案扫描保留原始 `screenshot-text.json`。XCTest 调试树会列出已经 accessibilityHidden 的图片资源名，`visible-copy-text.json` 只排除生成的 Icons.xcassets 中精确匹配的装饰图标标识符；清单在 `image-metadata-exclusions.json`。正文 / 密钥扫描始终使用未过滤的原始文本。

最后一次主干合并保留了新版 D49 计划条文。本包按分派时的 D49（悬停 / 长按时间与复制、已处理消息只读）验收；主干后来细化的键盘聚焦、账户时区的当天时间格式、手机轻点时间及本人消息引用，未纳入本次验收，不声称已经补齐。

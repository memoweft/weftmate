# A16 · Apple 主对话与临时对话

本包沿 CLIENT_API 9.1–9.7 / 第 10 节接入 iPhone、Mac 原生主对话与临时旁聊，Watch 只投影账户主对话中的审批与完成。仅合成账户 / 内容、回环随机端口、隔离数据目录；未访问日用宿主、真实模型、本人剪贴板或桌面。

Swift 模型按精确数字能力版本降级，逻辑 chatId 不替换原生 sessionId、同步 conversationId 或 MemoWeft 来源。主对话正文按 orderKey / eventId 维护有界窗口，历史与增量游标分开；账户时区分日、日期定位、搜索前后命中与高亮、来源引用、三类结果卡接入同一历史。409 / 内容修订先清正文、命中、资源与旧回调；源身份与像素位置独立保存，滚动不发布逐像素正文重绘。

发送和附件沿 chat.message / 同一逻辑暂存，原件与可读内容不传到两个执行段。旁聊创建先核对原请求受理，再转移输入草稿 / 附件；从消息创建只保存来源引用。原生任务、审批、问题和停止保持原 sessionId / taskId / receiptId。原生来源深链通过既有映射定位逻辑对话；活动时间和执行设备继续取原会话事实。

临时创建沿 POST /sessions/temporary；状态分别保存记忆、召回、期限、绝对到期和 hasTemporaryContent。菜单用原生勾选及期限单选；默认为 30 天，原生验收切换到 7 天并核对宿主确认。临时 / 混合历史与临时草稿不写离线缓存；404 丢弃本机显示、草稿和历史副本。之前形成的记忆、设置从新回合生效的说明保留。

## 验证与原件

- `validation.json`：原生四组浅深色、配对 Watch、源码 / 二进制摘要、定向测试计数及边界。
- `screenshots.json`：原始 PNG 尺寸与 SHA-256；截图均来自本 App 自有窗口或专用模拟器，未编辑。
- `screenshot-text.json` / `privacy-scan.json`：与截图同时取得的原生可访问名称 / 值；合成私有正文标记与合成模型密钥标记须 0 命中，Watch 临时正文须 0 命中。
- `mac-light/`、`mac-dark/`：A15 方式的 App 内原生 AX / 自有窗口事件运行器；明确不计为 Mac XCUITest。
- `iphone-light/`、`iphone-dark/`：真实 XCUITest，含日历、折叠、万条搜索、来源、结果、发送 / 附件、审批、临时菜单和原生滚动。
- 各组 `host-receipts.json`：真实个人 HTTP 接口与确定性原生日志替身；附件 PAPER-42 实际进入隔离执行回调，审批沿原受理身份。
- Mac `native-report.json`、iPhone `performance.json` / 宿主回执中的 `metrics`：万条宿主历史上的原生滚动；CADisplayLink 帧间隔与本 App 进程内存。iPhone 同时保留 XCTest 内存 / 滚动 signpost 指标。没有把宿主冷日志读取、整机内存或 GPU 呈现延迟当作客户端成绩。
- `attempts/`：定位器 / 宿主替身终态 / Swift 几何闭包崩溃等失败原件，不计通过。几何测量改为纯值、明确 nonisolated Sendable 闭包；读锚点不再驱动正文发布。Mac 最终完成回执在临时菜单保持可见时保存，由父进程关闭隔离 App，避免 SDK 的 AX sheet-close 动作退役测试任务。

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
node apps/apple/Tests/verify_a16_evidence.mjs
xcrun simctl shutdown all
```

## 边界

HTTP 授权、回执、逻辑索引、临时策略与生命周期是正式宿主实现；DSH 日志 / 模型执行是确定性合成替身，未证明编译 DSH、真实 Core 形成、真模型、真机相机或生产中继。万条是合成原始公开消息，不是日用历史。Native 404 流程通过隔离生命周期删除触发同一不可用响应，状态程序直接验证到期 404 的显示 / 草稿清理；未等待真实 1–30 天浸泡。Mac 已知 automation-mode 限制未重试授权、未更改自动化 / 辅助功能 / 安全设置。没有新增服务端接口、系统权限或部署动作。
